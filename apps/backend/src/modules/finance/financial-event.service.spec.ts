import { FinancialEventService } from './financial-event.service';
import { FinancialEventDirection, FinancialEventType } from './financial-event-type.enum';
import { FinancialEvent } from './entities/financial-event.entity';

function buildHarness() {
  const rows: any[] = [];
  const financialEventsRepository = {
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (entity: any) => {
      const withId = { id: `event-${rows.length + 1}`, ...entity };
      rows.push(withId);
      return withId;
    }),
    find: jest.fn(async ({ where }: any) => rows.filter((r) => r.orderId === where.orderId)),
  };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  const service = new FinancialEventService(financialEventsRepository as any, requestContextService as any);
  return { service, rows };
}

describe('FinancialEventService', () => {
  it('records a new event when no row exists for the idempotency key', async () => {
    const { service, rows } = buildHarness();

    const event = await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'vendor-commission:seg-1',
      amountMinor: 100,
    });

    expect(rows).toHaveLength(1);
    expect(event.amountMinor).toBe(100);
  });

  it('CONFIRMED RULE: is idempotent — a second call with the same key returns the existing row, never creates a duplicate', async () => {
    const { service, rows } = buildHarness();

    const first = await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'vendor-commission:seg-1',
      amountMinor: 100,
    });
    const second = await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'vendor-commission:seg-1',
      amountMinor: 999, // different amount — must be ignored, the original stands
    });

    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.amountMinor).toBe(100); // unchanged — never overwritten
  });

  it("recovers from a concurrent-race unique-constraint violation the same way PermissionsService.grant() does", async () => {
    const rows: any[] = [];
    let saveCallCount = 0;
    const financialEventsRepository = {
      findOne: jest.fn(async ({ where }: any) => {
        return rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
      }),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async () => {
        saveCallCount++;
        if (saveCallCount === 1) {
          // Simulate a concurrent insert winning the race first.
          rows.push({ id: 'event-1', idempotencyKey: 'driver-commission:order-1', amountMinor: 50 });
          throw new Error('duplicate key value violates unique constraint');
        }
        throw new Error('should not be called again');
      }),
    };
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
    const service = new FinancialEventService(financialEventsRepository as any, requestContextService as any);

    const result = await service.record({
      type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'driver-commission:order-1',
      amountMinor: 50,
    });

    expect(result.id).toBe('event-1');
  });

  it('findByOrderId returns only events for that order', async () => {
    const { service } = buildHarness();
    await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'a',
      orderId: 'order-1',
    });
    await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'b',
      orderId: 'order-2',
    });

    const events = await service.findByOrderId('order-1');
    expect(events).toHaveLength(1);
    expect(events[0].orderId).toBe('order-1');
  });
});

describe('FinancialEventService.record — Transaction-Compatible Financial Event Recording (Chunk B1)', () => {
  it('an existing call with NO manager behaves exactly as before (uses the injected repository)', async () => {
    const { service, rows } = buildHarness();

    const event = await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'no-manager-key',
      amountMinor: 250,
    });

    expect(rows).toHaveLength(1);
    expect(event.amountMinor).toBe(250);
  });

  it('CRITICAL: a call WITH a manager writes through manager.getRepository(FinancialEvent), never the injected repository', async () => {
    const { service, rows: injectedRepoRows } = buildHarness();
    const managerRows: any[] = [];
    const managerRepository = {
      findOne: jest.fn(async ({ where }: any) => managerRows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async (entity: any) => {
        const withId = { id: `managed-event-${managerRows.length + 1}`, ...entity };
        managerRows.push(withId);
        return withId;
      }),
    };
    const manager = { getRepository: jest.fn(() => managerRepository) };

    const event = await service.record(
      {
        type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
        direction: FinancialEventDirection.RECEIVABLE,
        idempotencyKey: 'with-manager-key',
        amountMinor: 500,
      },
      manager as any,
    );

    expect(manager.getRepository).toHaveBeenCalledWith(FinancialEvent);
    expect(managerRows).toHaveLength(1);
    expect(event.amountMinor).toBe(500);
    // Never touched the injected repository's own store at all.
    expect(injectedRepoRows).toHaveLength(0);
  });

  it('CRITICAL: idempotency is preserved on the manager path — a second call with the same key returns the existing row via the manager\u2019s own repository, never a duplicate', async () => {
    const { service } = buildHarness();
    const managerRows: any[] = [];
    const managerRepository = {
      findOne: jest.fn(async ({ where }: any) => managerRows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async (entity: any) => {
        const withId = { id: `managed-event-${managerRows.length + 1}`, ...entity };
        managerRows.push(withId);
        return withId;
      }),
    };
    const manager = { getRepository: jest.fn(() => managerRepository) };

    const first = await service.record(
      {
        type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
        direction: FinancialEventDirection.RECEIVABLE,
        idempotencyKey: 'shared-key',
        amountMinor: 100,
      },
      manager as any,
    );
    const second = await service.record(
      {
        type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
        direction: FinancialEventDirection.RECEIVABLE,
        idempotencyKey: 'shared-key',
        amountMinor: 999,
      },
      manager as any,
    );

    expect(managerRows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.amountMinor).toBe(100);
  });

  it('existing validation/error behavior is unchanged on the manager path — a real save error still propagates once no existing row is found', async () => {
    const managerRows: any[] = [];
    let saveCallCount = 0;
    const managerRepository = {
      findOne: jest.fn(async () => managerRows.find(() => false) ?? null),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async () => {
        saveCallCount++;
        throw new Error('a genuine, non-duplicate database error');
      }),
    };
    const manager = { getRepository: jest.fn(() => managerRepository) };
    const { service } = buildHarness();

    await expect(
      service.record(
        {
          type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
          direction: FinancialEventDirection.RECEIVABLE,
          idempotencyKey: 'will-fail',
          amountMinor: 10,
        },
        manager as any,
      ),
    ).rejects.toThrow('a genuine, non-duplicate database error');
    expect(saveCallCount).toBe(1);
  });

  it('on the manager path a failed save rethrows the ORIGINAL error and does not query again (the caller\'s transaction is already aborted) — Group 8 regression', async () => {
    const findOne = jest.fn(async () => null);
    const managerRepository = {
      findOne,
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async () => {
        throw new Error('duplicate key value violates unique constraint "idx_financial_events_idempotency_key"');
      }),
    };
    const manager = { getRepository: jest.fn(() => managerRepository) };
    const { service } = buildHarness();

    await expect(
      service.record(
        { type: FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED, direction: FinancialEventDirection.PAYABLE, idempotencyKey: 'k', amountMinor: 1 },
        manager as any,
      ),
    ).rejects.toThrow('duplicate key value violates unique constraint');
    expect(findOne).toHaveBeenCalledTimes(1); // only the pre-check; no re-query inside the aborted transaction
  });

  it('existing callers requiring no changes: calling record() with a single argument still type-checks and runs (manager defaults to undefined)', async () => {
    const { service, rows } = buildHarness();
    // Exactly the same call shape every pre-existing caller already uses.
    await service.record({
      type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'single-arg-call',
    });
    expect(rows).toHaveLength(1);
  });
});

describe('FinancialEventService — structured business-event logging (Group 4)', () => {
  function buildLoggingHarness() {
    const rows: any[] = [];
    const financialEventsRepository = {
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null),
      create: jest.fn((data: any) => ({ ...data })),
      save: jest.fn(async (entity: any) => {
        const withId = { id: `event-${rows.length + 1}`, ...entity };
        rows.push(withId);
        return withId;
      }),
    };
    const requestContextService = { getCorrelationId: jest.fn(() => 'corr-fe') };
    const service = new FinancialEventService(financialEventsRepository as any, requestContextService as any);
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return { service, logSpy, warnSpy };
  }

  it('B/D: a newly-recorded event (no manager) logs financial_event.recorded with only safe identifiers/amount — never a reason string or actor free text beyond what was already safe', async () => {
    const { service, logSpy } = buildLoggingHarness();

    await service.record({
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'vendor-commission:seg-1',
      amountMinor: 12345,
      orderId: 'order-1',
      vendorBranchId: 'branch-1',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'financial_event.recorded',
      correlationId: 'corr-fe',
      financialEventId: 'event-1',
      type: FinancialEventType.VENDOR_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      amountMinor: 12345,
      orderId: 'order-1',
      orderVendorSegmentId: null,
      deliveryId: null,
      paymentId: null,
      vendorBranchId: 'branch-1',
      driverId: null,
    });
  });

  it('F: a duplicate/idempotent replay logs financial_event.duplicate at WARN, distinguishing it from a genuine failure', async () => {
    const { service, logSpy, warnSpy } = buildLoggingHarness();
    const params = {
      type: FinancialEventType.DRIVER_COMMISSION_RECOGNIZED,
      direction: FinancialEventDirection.RECEIVABLE,
      idempotencyKey: 'driver-commission:order-1',
      amountMinor: 500,
      orderId: 'order-1',
    };
    await service.record(params);
    logSpy.mockClear();

    await service.record(params);

    expect(logSpy).not.toHaveBeenCalled(); // no second "recorded" event for a no-op replay
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ event: 'financial_event.duplicate', correlationId: 'corr-fe', idempotencyKey: 'driver-commission:order-1' });
  });

  it('CRITICAL (transaction semantics): a write joining a caller-owned transaction (manager provided) is NOT logged as recorded here — the transaction owner logs post-commit instead', async () => {
    const { service, logSpy } = buildLoggingHarness();
    const managerRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((d: any) => d),
      save: jest.fn(async (entity: any) => ({ id: 'event-mid-tx', ...entity })),
    };
    const manager = { getRepository: jest.fn(() => managerRepository) };

    await service.record(
      {
        type: FinancialEventType.MANUAL_TRANSFER_REFUND_RECORDED,
        direction: FinancialEventDirection.PAYABLE,
        idempotencyKey: 'manual-transfer-refund:payment-1',
        amountMinor: 1000,
      },
      manager as any,
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});
