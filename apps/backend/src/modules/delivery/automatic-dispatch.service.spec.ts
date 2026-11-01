import { OrderNotAssignableException } from './delivery-assignment.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AutomaticDispatchService } from './automatic-dispatch.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/order-status.enum';

/**
 * Dispatch Hardening milestone. A realistic fake ConfigService: real callers read `env` (test-mode
 * gate for the interval) and the three `dispatch.*` technical constants (configuration.ts) — a
 * fake that only ever returns `'test'` for every key (the pre-hardening harness) would make
 * `sweepIntervalMs`/`sweepLockTtlMs`/`sweepBatchLimit` all resolve to the STRING `'test'`, silently
 * wrong for anything that actually uses them as numbers.
 */
function fakeConfigService(overrides: Partial<{ env: string; sweepIntervalMs: number; sweepLockTtlMs: number; sweepBatchLimit: number }> = {}) {
  const values: Record<string, unknown> = {
    env: overrides.env ?? 'test',
    'dispatch.sweepIntervalMs': overrides.sweepIntervalMs ?? 10_000,
    'dispatch.sweepLockTtlMs': overrides.sweepLockTtlMs ?? 20_000,
    'dispatch.sweepBatchLimit': overrides.sweepBatchLimit ?? 50,
  };
  return { get: jest.fn((key: string) => values[key]) };
}

function buildHarness(opts: {
  isAutomaticDispatchEnabled: boolean;
  order?: any;
  candidateDriverIds?: string[];
  assignDriverError?: Error;
}) {
  const alerts: any[] = [];
  // CRITICAL: `opts.order ?? default` would silently replace an
  // explicit `order: null` (the "order cannot be found" case) with the
  // default order, since `??` treats `null` the same as `undefined` —
  // only substitute the default when the caller genuinely omitted
  // `order` altogether.
  const ordersRepository = { findOne: jest.fn(async () => ('order' in opts ? opts.order : { id: 'order-1', status: 'READY_FOR_PICKUP', fulfillmentType: 'DELIVERY', segments: [] })) };
  // ONE open alert per (order, reason): the real service checks for an open one first (and the DB's partial unique index backs it up).
  const dispatchAlertsRepository = {
    create: jest.fn((data: any) => data),
    findOne: jest.fn(async ({ where }: any) => alerts.find((a) => a.orderId === where.orderId && a.reason === where.reason && !a.resolvedAt) ?? null),
    update: jest.fn(async (criteria: any, patch: any) => {
      const hit = alerts.find((a) => a.id === criteria.id);
      if (hit) Object.assign(hit, patch);
    }),
    save: jest.fn(async (row: any) => {
      const saved = { id: `alert-${alerts.length + 1}`, ...row };
      alerts.push(saved);
      return saved;
    }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = { update: () => qb, set: () => qb, where: () => qb, execute: async () => undefined };
      return qb;
    }),
  };
  const attempts: any[] = [];
  const dispatchAttemptsRepository = { insert: jest.fn(async (row: any) => void attempts.push(row)) };
  const driverRankingService = { rankCandidates: jest.fn(async () => opts.candidateDriverIds ?? []) };
  const deliveryAssignmentService = {
    assignDriver: jest.fn(async () => {
      if (opts.assignDriverError) throw opts.assignDriverError;
      return { id: 'delivery-1' };
    }),
  };
  const businessConfigService = {
    isAutomaticDispatchEnabled: jest.fn(async () => opts.isAutomaticDispatchEnabled),
  };

  const service = new AutomaticDispatchService(
    ordersRepository as any,
    dispatchAlertsRepository as any,
    dispatchAttemptsRepository as any,
    driverRankingService as any,
    deliveryAssignmentService as any,
    businessConfigService as any,
    { getCorrelationId: () => 'corr-test' } as any,
    // Timeout-driven reassignment milestone: unused by attemptAutomaticDispatch itself, so plain
    // never-called fakes are enough here — the dedicated harness below exercises them for real.
    { createQueryBuilder: jest.fn(), update: jest.fn(async () => undefined), manager: { transaction: jest.fn() } } as any,
    { transitionInTransaction: jest.fn() } as any,
    fakeConfigService() as any,
    { set: jest.fn(), del: jest.fn(), eval: jest.fn() } as any,
  );
  return { service, alerts, attempts, deliveryAssignmentService, driverRankingService };
}

/**
 * Timeout-driven reassignment milestone. A more elaborate harness, purpose-built for
 * `reassignTimedOutDeliveries()` — models just enough of `Delivery`/`Order`/`OrderStateMachineService`/
 * Redis to exercise the real per-delivery release → re-rank → reassign-or-alert flow, including the
 * concurrency/idempotency guards (the whole-sweep Redis lock, and the per-delivery
 * still-expired-under-lock re-check).
 */
function buildTimeoutHarness(opts: {
  isAutomaticDispatchEnabled?: boolean;
  /** Rows the initial "find expired" query returns — each `{ id }` is a Delivery id. */
  expiredDeliveryIds?: string[];
  /** Keyed by delivery id — what a fresh, LOCKED re-read of that Delivery row looks like at the moment it's processed. `undefined` = row vanished/already handled. */
  deliveriesById?: Record<string, { acceptDeadlineAt: Date | null; orderId: string; driverId: string | null; consecutiveUnanswered?: number }>;
  /** Keyed by order id — what `transitionInTransaction` does for that order: 'ok' (succeeds, matches existing rule), or an Error to throw (e.g. BadRequestException for "already progressed"). */
  transitionOutcomeByOrderId?: Record<string, 'ok' | Error>;
  /** Keyed by order id — candidate driver ids the (fake) ranking returns for it. */
  candidatesByOrderId?: Record<string, string[]>;
  /** Keyed by order id — if set, assignDriver() throws this for that order. */
  assignDriverErrorByOrderId?: Record<string, Error>;
  /** Simulates two overlapping sweep invocations: the SECOND `redis.set(...NX)` call fails to acquire the lock. */
  lockAlreadyHeld?: boolean;
  /** The lock key already holds THIS value when the sweep starts (simulates another instance's still-live lock, or a stale/foreign value) — `redis.set(...NX)` then correctly fails to acquire. */
  existingLockValue?: string;
  /** Simulates a Redis outage: `redis.set` (acquire) rejects. */
  redisSetThrows?: Error;
  /** Simulates a Redis outage exactly at release time: `redis.eval` rejects. */
  redisEvalThrows?: Error;
  configOverrides?: Partial<{ env: string; sweepIntervalMs: number; sweepLockTtlMs: number; sweepBatchLimit: number }>;
}) {
  const alerts: any[] = [];
  const afterCommitCalls: string[] = [];
  const assignDriverCalls: Array<{ orderId: string; candidateDriverIds: string[] }> = [];
  const transitionCalls: Array<{ orderId: string; to: string }> = [];

  const businessConfigService = { isAutomaticDispatchEnabled: jest.fn(async () => opts.isAutomaticDispatchEnabled ?? true) };
  const dispatchAlertsRepository = {
    create: jest.fn((data: any) => data),
    findOne: jest.fn(async ({ where }: any) => alerts.find((a) => a.orderId === where.orderId && a.reason === where.reason && !a.resolvedAt) ?? null),
    update: jest.fn(async (criteria: any, patch: any) => {
      const hit = alerts.find((a) => a.id === criteria.id);
      if (hit) Object.assign(hit, patch);
    }),
    save: jest.fn(async (row: any) => {
      const saved = { id: `alert-${alerts.length + 1}`, ...row };
      alerts.push(saved);
      return saved;
    }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = { update: () => qb, set: () => qb, where: () => qb, execute: async () => undefined };
      return qb;
    }),
  };
  const attempts: any[] = [];
  const dispatchAttemptsRepository = { insert: jest.fn(async (row: any) => void attempts.push(row)) };
  const driverRankingService = {
    rankCandidates: jest.fn(async (order: any) => opts.candidatesByOrderId?.[order.id] ?? []),
  };
  const deliveryAssignmentService = {
    assignDriver: jest.fn(async (params: { orderId: string; candidateDriverIds: string[] }) => {
      assignDriverCalls.push(params);
      const error = opts.assignDriverErrorByOrderId?.[params.orderId];
      if (error) throw error;
      return { id: `delivery-for-${params.orderId}` };
    }),
  };
  const ordersRepository = {
    findOne: jest.fn(async ({ where: { id } }: any) => ({ id, fulfillmentType: 'DELIVERY', segments: [] })),
  };
  const orderStateMachine = {
    transitionInTransaction: jest.fn(async (_manager: any, params: { orderId: string; to: string }) => {
      transitionCalls.push({ orderId: params.orderId, to: params.to });
      const outcome = opts.transitionOutcomeByOrderId?.[params.orderId] ?? 'ok';
      if (outcome instanceof Error) throw outcome;
      return { order: { id: params.orderId }, afterCommit: async () => void afterCommitCalls.push(params.orderId) };
    }),
  };
  const fakeManager = {
    findOne: jest.fn(async (EntityClass: any, opts2: any) => {
      if (EntityClass === Order) {
        // The method's own Order-status pre-check (locks Order before Delivery — see its own doc
        // comment on the lock-ordering fix). Modeled here as always "still ASSIGNED_TO_DRIVER" so
        // every existing test keeps simulating "already progressed" exactly as it always has: via
        // `transitionOutcomeByOrderId` throwing from the mocked `transitionInTransaction` below. Real
        // lock ordering under true concurrency is proven separately, under real Postgres, in the e2e
        // suite's Dispatch Hardening describe block.
        return { id: opts2.where.id, status: OrderStatus.ASSIGNED_TO_DRIVER };
      }
      return opts.deliveriesById?.[opts2.where.id] ?? null;
    }),
    save: jest.fn(async (row: any) => row),
  };
  const limitCalls: number[] = [];
  const deliveriesRepository = {
    createQueryBuilder: jest.fn(() => {
      const qb: any = {
        innerJoin: jest.fn(() => qb),
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        select: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        limit: jest.fn((n: number) => {
          limitCalls.push(n);
          return qb;
        }),
        getRawMany: jest.fn(async () => (opts.expiredDeliveryIds ?? []).map((id) => ({ id }))),
      };
      return qb;
    }),
    manager: { transaction: jest.fn(async (cb: any) => cb(fakeManager)) },
  };
  let lockCallCount = 0;
  // A real, minimal in-memory model of the lock key's current VALUE — lets `set(...NX)` and
  // `eval(CAS-delete)` behave exactly like real Redis would, so the CAS-release logic is genuinely
  // exercised, not just assumed to work.
  let lockValue: string | null = opts.existingLockValue ?? null;
  const redis = {
    set: jest.fn(async (_key: string, value: string, _px: string, _ttl: number, _nx: string) => {
      lockCallCount++;
      if (opts.redisSetThrows) throw opts.redisSetThrows;
      if (opts.lockAlreadyHeld && lockCallCount === 1) return null; // simulate a genuine concurrent loser
      if (lockValue !== null) return null; // NX semantics: key already has a value
      lockValue = value;
      return 'OK';
    }),
    eval: jest.fn(async (_script: string, _numKeys: number, _key: string, token: string) => {
      if (opts.redisEvalThrows) throw opts.redisEvalThrows;
      if (lockValue === token) {
        lockValue = null;
        return 1;
      }
      return 0;
    }),
    del: jest.fn(async () => {
      lockValue = null;
      return 1;
    }),
  };

  const service = new AutomaticDispatchService(
    ordersRepository as any,
    dispatchAlertsRepository as any,
    dispatchAttemptsRepository as any,
    driverRankingService as any,
    deliveryAssignmentService as any,
    businessConfigService as any,
    { getCorrelationId: () => 'corr-test' } as any,
    deliveriesRepository as any,
    orderStateMachine as any,
    fakeConfigService(opts.configOverrides) as any,
    redis as any,
  );

  return {
    service,
    attemptRows: attempts,
    fakeManager,
    alerts,
    afterCommitCalls,
    assignDriverCalls,
    transitionCalls,
    limitCalls,
    driverRankingService,
    deliveryAssignmentService,
    orderStateMachine,
    redis,
    getLockValue: () => lockValue,
    /** Test-only escape hatch: directly overwrites the in-memory lock value, simulating "meanwhile, a different instance's TTL-driven re-acquisition happened" without fighting this mock's own NX semantics. */
    setLockValueForTest: (value: string | null) => {
      lockValue = value;
    },
  };
}

describe('AutomaticDispatchService', () => {
  it('a PICKUP order is never dispatched and raises NO "no eligible driver" alert (the customer collects it)', async () => {
    const { service, deliveryAssignmentService, driverRankingService, alerts } = buildHarness({
      isAutomaticDispatchEnabled: true,
      order: { id: 'order-1', fulfillmentType: 'PICKUP', segments: [] },
      candidateDriverIds: ['driver-1'],
    });
    await service.attemptAutomaticDispatch('order-1');
    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
    expect(alerts).toEqual([]);
  });

  it('an order someone else already handled (OrderNotAssignableException) is a no-op — NOT a false "no eligible driver" alert', async () => {
    const { service, alerts } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: ['driver-1'],
      assignDriverError: new OrderNotAssignableException('already assigned', 'ORDER_NOT_ASSIGNABLE'),
    });
    await expect(service.attemptAutomaticDispatch('order-1')).resolves.toBeUndefined();
    expect(alerts).toEqual([]);
  });

  it('CONFIRMED RULE: does nothing at all when AUTOMATIC_DISPATCH_ENABLED is OFF — order stays available for manual Admin flow', async () => {
    const { service, deliveryAssignmentService, driverRankingService } = buildHarness({
      isAutomaticDispatchEnabled: false,
    });

    await service.attemptAutomaticDispatch('order-1');

    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
  });

  it('assigns the top-ranked candidate when automatic dispatch is ON and candidates exist', async () => {
    const { service, deliveryAssignmentService } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: ['driver-1', 'driver-2'],
    });

    await service.attemptAutomaticDispatch('order-1');

    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({
      orderId: 'order-1',
      candidateDriverIds: ['driver-1', 'driver-2'],
    });
  });

  it('CONFIRMED RULE (no driver available): raises a DispatchAlert when ranking returns no candidates, keeps the order as-is', async () => {
    const { service, alerts, deliveryAssignmentService } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: [],
    });

    await service.attemptAutomaticDispatch('order-1');

    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ orderId: 'order-1', reason: 'NO_ELIGIBLE_DRIVER' });
  });

  it('raises a DispatchAlert when every ranked candidate fails the assignment race (ConflictException)', async () => {
    const { service, alerts } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: ['driver-1'],
      assignDriverError: new ConflictException('No available driver could be assigned.'),
    });

    await service.attemptAutomaticDispatch('order-1');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].reason).toBe('NO_ELIGIBLE_DRIVER');
  });

  it('an unexpected assignment failure is NEVER thrown at the caller and NEVER silent: logged, an attempt row, ONE open ASSIGNMENT_ERROR alert (repeats refresh it)', async () => {
    const { service, alerts, attempts } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: ['driver-1'],
      assignDriverError: new Error('unexpected database failure'),
    });

    await expect(service.attemptAutomaticDispatch('order-1')).resolves.toBeUndefined();
    await service.attemptAutomaticDispatch('order-1');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ orderId: 'order-1', reason: 'ASSIGNMENT_ERROR' });
    expect(alerts[0].detail).toContain('unexpected database failure');
    expect(attempts.map((a) => a.outcome)).toEqual(['ASSIGNMENT_ERROR', 'ASSIGNMENT_ERROR']);
  });

  it('automatic assignment switched OFF: never silent — an open AUTO_ASSIGN_DISABLED alert (one, however often it is asked) and an attempt row; no driver is ranked', async () => {
    const { service, alerts, attempts, driverRankingService } = buildHarness({ isAutomaticDispatchEnabled: false });
    await service.attemptAutomaticDispatch('order-1');
    await service.attemptAutomaticDispatch('order-1');
    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
    expect(alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'AUTO_ASSIGN_DISABLED' })]);
    expect(attempts[0]).toMatchObject({ outcome: 'AUTO_ASSIGN_DISABLED' });
  });

  it('no eligible driver: an open NO_ELIGIBLE_DRIVER alert with a stable code and an attempt row; success records ASSIGNED', async () => {
    const none = buildHarness({ isAutomaticDispatchEnabled: true, candidateDriverIds: [] });
    await none.service.attemptAutomaticDispatch('order-1');
    expect(none.alerts).toEqual([expect.objectContaining({ reason: 'NO_ELIGIBLE_DRIVER' })]);
    expect(none.attempts[0]).toMatchObject({ outcome: 'NO_ELIGIBLE_DRIVER' });
    const ok = buildHarness({ isAutomaticDispatchEnabled: true, candidateDriverIds: ['driver-1'] });
    await ok.service.attemptAutomaticDispatch('order-1');
    expect(ok.alerts).toEqual([]);
    expect(ok.attempts[0]).toMatchObject({ outcome: 'ASSIGNED' });
  });

  it('an order that is not waiting for a driver (already assigned / cancelled) is left alone — no alert, no ranking', async () => {
    const { service, alerts, driverRankingService } = buildHarness({
      isAutomaticDispatchEnabled: false,
      order: { id: 'order-1', status: 'ASSIGNED_TO_DRIVER', fulfillmentType: 'DELIVERY', segments: [] },
    });
    await service.attemptAutomaticDispatch('order-1');
    expect(alerts).toEqual([]);
    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
  });

  it('does nothing when the order cannot be found', async () => {
    const { service, driverRankingService } = buildHarness({ isAutomaticDispatchEnabled: true, order: null });
    await service.attemptAutomaticDispatch('missing-order');
    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
  });
});

describe('AutomaticDispatchService — one redispatch after a DRIVER hand-back, excluding that driver (U3)', () => {
  it('the releasing driver is removed from the ranked candidates; the rest keep the unchanged ranking order', async () => {
    const { service, deliveryAssignmentService, driverRankingService } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: ['releaser', 'driver-b', 'driver-c'],
    });
    await service.redispatchAfterDriverRelease('order-1', 'releaser');
    expect(driverRankingService.rankCandidates).toHaveBeenCalledTimes(1); // the existing ranking, unchanged and called once
    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledTimes(1);
    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({ orderId: 'order-1', candidateDriverIds: ['driver-b', 'driver-c'] });
  });

  it('if the releasing driver was the only eligible one: NO assignment, the existing NO_ELIGIBLE_DRIVER alert is raised once', async () => {
    const { service, deliveryAssignmentService, alerts } = buildHarness({ isAutomaticDispatchEnabled: true, candidateDriverIds: ['releaser'] });
    await service.redispatchAfterDriverRelease('order-1', 'releaser');
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
    expect(alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'NO_ELIGIBLE_DRIVER' })]);
  });

  it('automatic dispatch OFF: nothing happens — the order waits for an admin (same switch as every automatic dispatch)', async () => {
    const { service, deliveryAssignmentService, driverRankingService, alerts } = buildHarness({ isAutomaticDispatchEnabled: false, candidateDriverIds: ['driver-b'] });
    await service.redispatchAfterDriverRelease('order-1', 'releaser');
    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
    expect(deliveryAssignmentService.assignDriver).not.toHaveBeenCalled();
    // Never silent: the order waits for an admin AND says so with one open alert.
    expect(alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'AUTO_ASSIGN_DISABLED' })]);
  });

  it('an admin assigned it meanwhile (ORDER_NOT_ASSIGNABLE): the attempt stops quietly — no alert, no error', async () => {
    const { service, alerts } = buildHarness({
      isAutomaticDispatchEnabled: true,
      candidateDriverIds: ['driver-b'],
      assignDriverError: new OrderNotAssignableException('assigned meanwhile', 'ORDER_NOT_ASSIGNABLE', OrderStatus.ASSIGNED_TO_DRIVER),
    });
    await expect(service.redispatchAfterDriverRelease('order-1', 'releaser')).resolves.toBeUndefined();
    expect(alerts).toHaveLength(0);
  });

  it('an unexpected failure (e.g. the assignment transaction failed) never fails the driver\'s release request — it is logged', async () => {
    const { service } = buildHarness({ isAutomaticDispatchEnabled: true, candidateDriverIds: ['driver-b'], assignDriverError: new Error('db down') });
    const logged = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.redispatchAfterDriverRelease('order-1', 'releaser')).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });

  it('a PICKUP order is never redispatched (it never has a driver to release, and is never dispatched)', async () => {
    const { service, driverRankingService, alerts } = buildHarness({
      isAutomaticDispatchEnabled: true,
      order: { id: 'order-1', fulfillmentType: 'PICKUP', segments: [] },
      candidateDriverIds: ['driver-b'],
    });
    await service.redispatchAfterDriverRelease('order-1', 'releaser');
    expect(driverRankingService.rankCandidates).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(0);
  });

  it('without exclusions attemptAutomaticDispatch is unchanged (every ranked candidate offered)', async () => {
    const { service, deliveryAssignmentService } = buildHarness({ isAutomaticDispatchEnabled: true, candidateDriverIds: ['a', 'b'] });
    await service.attemptAutomaticDispatch('order-1');
    expect(deliveryAssignmentService.assignDriver).toHaveBeenCalledWith({ orderId: 'order-1', candidateDriverIds: ['a', 'b'] });
  });
});

describe('AutomaticDispatchService.reassignTimedOutDeliveries (timeout-driven reassignment milestone)', () => {
  const expired = new Date(Date.now() - 5_000);
  const notYetExpired = new Date(Date.now() + 25_000);

  it('does nothing at all when AUTOMATIC_DISPATCH_ENABLED is OFF — same rule as attemptAutomaticDispatch', async () => {
    const h = buildTimeoutHarness({
      isAutomaticDispatchEnabled: false,
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 });
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
  });

  it('an assigned driver who times out is released (ASSIGNED_TO_DRIVER→READY_FOR_PICKUP) and reassigned to the next ranked candidate', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.transitionCalls).toEqual([{ orderId: 'order-1', to: 'READY_FOR_PICKUP' }]);
    expect(h.afterCommitCalls).toEqual(['order-1']); // consistent with AdminDispatchService.reassign()'s own plain transition()
    expect(h.assignDriverCalls).toEqual([{ orderId: 'order-1', candidateDriverIds: ['driver-2'] }]);
    expect(result).toEqual({ processed: 1, reassigned: 1, alerted: 0, skipped: 0 });
  });

  it('CONFIRMED: does NOT exclude the just-timed-out driver from the fresh ranking call — reuses ranking exactly as-is', async () => {
    // The driver who timed out (driver-1) is still the only eligible candidate the (fake) ranking
    // returns — this is a legitimate outcome (e.g. a solo-driver service area), not a bug.
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-1'] },
    });

    await h.service.reassignTimedOutDeliveries();

    expect(h.assignDriverCalls).toEqual([{ orderId: 'order-1', candidateDriverIds: ['driver-1'] }]);
  });

  it('the timed-out driver is naturally excluded once actually ineligible — ranking already filters (no new rule invented)', async () => {
    // The ranking fake below models "driver-1 went offline in the meantime": it is simply never
    // offered as a candidate — exactly what real DriverRankingService.rankCandidates would do.
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
    });

    await h.service.reassignTimedOutDeliveries();

    expect(h.assignDriverCalls[0].candidateDriverIds).not.toContain('driver-1');
  });

  it('no eligible driver at all: raises the EXISTING DispatchAlert (NO_ELIGIBLE_DRIVER), order stays retryable, never a new alert type', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': [] },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.assignDriverCalls).toEqual([]);
    expect(h.alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'NO_ELIGIBLE_DRIVER' })]);
    expect(result).toEqual({ processed: 1, reassigned: 0, alerted: 1, skipped: 0 });
  });

  it('every ranked candidate loses the assignment race (ConflictException): alerts the same way as "no candidates"', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
      assignDriverErrorByOrderId: { 'order-1': new ConflictException('No available driver could be assigned.') },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'NO_ELIGIBLE_DRIVER' })]);
    expect(result.alerted).toBe(1);
  });

  it('an already-progressed delivery (order left ASSIGNED_TO_DRIVER between the query and the lock) is never reassigned', async () => {
    // transitionInTransaction rejects because the order is no longer exactly ASSIGNED_TO_DRIVER —
    // the SAME BadRequestException OrderStateMachineService already throws for any invalid
    // (from, to) pair; nothing new is invented to detect this.
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      transitionOutcomeByOrderId: { 'order-1': new BadRequestException('Cannot transition order from PICKED_UP to READY_FOR_PICKUP.') },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.assignDriverCalls).toEqual([]);
    expect(h.alerts).toEqual([]);
    expect(result).toEqual({ processed: 1, reassigned: 0, alerted: 0, skipped: 1 });
  });

  it('idempotent: a delivery already refreshed (reassigned) since the outer query ran is silently skipped, never released twice', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      // The fresh, LOCKED re-read shows a deadline in the FUTURE now — someone else (an Admin, or a
      // previous tick) already handled this exact delivery.
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: notYetExpired, orderId: 'order-1', driverId: 'driver-2' } },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 1, reassigned: 0, alerted: 0, skipped: 1 });
  });

  it('idempotent: running the sweep twice in a row processes nothing the second time once nothing is left expired', async () => {
    const h = buildTimeoutHarness({ expiredDeliveryIds: [] });
    const first = await h.service.reassignTimedOutDeliveries();
    const second = await h.service.reassignTimedOutDeliveries();
    expect(first).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 });
    expect(second).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 });
  });

  it('CONCURRENCY: a sweep already in progress (whole-sweep Redis lock held) makes a second, overlapping invocation a clean no-op', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
      lockAlreadyHeld: true,
    });

    // Two "overlapping" invocations; our fake redis.set() denies the lock on the FIRST call only —
    // model this as two genuinely concurrent calls racing for the same lock.
    const [first, second] = await Promise.all([h.service.reassignTimedOutDeliveries(), h.service.reassignTimedOutDeliveries()]);
    const results = [first, second];
    expect(results.filter((r) => r.processed > 0)).toHaveLength(1); // exactly one of the two actually did the work
    expect(h.redis.eval).toHaveBeenCalledTimes(1); // only the one that acquired the lock ever releases it
  });

  it('an unexpected failure on one delivery is persisted as an ASSIGNMENT_ERROR alert and the sweep releases its lock — never stuck, never silent', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
      assignDriverErrorByOrderId: { 'order-1': new Error('unexpected database failure') },
    });

    await expect(h.service.reassignTimedOutDeliveries()).resolves.toBeDefined();
    expect(h.alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'ASSIGNMENT_ERROR' })]);
    expect(h.redis.eval).toHaveBeenCalledTimes(1);
  });

  it('multiple expired deliveries in one sweep are each processed independently', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1', 'delivery-2'],
      deliveriesById: {
        'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' },
        'delivery-2': { acceptDeadlineAt: expired, orderId: 'order-2', driverId: 'driver-3' },
      },
      candidatesByOrderId: { 'order-1': ['driver-2'], 'order-2': [] },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(result).toEqual({ processed: 2, reassigned: 1, alerted: 1, skipped: 0 });
    expect(h.assignDriverCalls).toEqual([{ orderId: 'order-1', candidateDriverIds: ['driver-2'] }]);
    expect(h.alerts).toEqual([expect.objectContaining({ orderId: 'order-2', reason: 'NO_ELIGIBLE_DRIVER' })]);
  });

  it('the THIRD consecutive unanswered offer stops the cycling: DRIVER_NOT_RESPONDING alert + attempt rows, no further ranking or assignment', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1', consecutiveUnanswered: 2 } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.assignDriverCalls).toEqual([]);
    expect(h.alerts).toEqual([expect.objectContaining({ orderId: 'order-1', reason: 'DRIVER_NOT_RESPONDING' })]);
    expect(h.alerts[0].detail).toMatch(/3 assignment offers in a row/);
    expect(result).toMatchObject({ processed: 1, reassigned: 0, alerted: 1 });
    expect(h.attemptRows.map((a: any) => a.outcome)).toEqual(['DRIVER_TIMED_OUT', 'DRIVER_NOT_RESPONDING']);
  });

  it('the FIRST and SECOND unanswered offers still reassign (the counter is saved with the release)', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1', consecutiveUnanswered: 1 } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(h.assignDriverCalls).toEqual([{ orderId: 'order-1', candidateDriverIds: ['driver-2'] }]);
    expect(h.alerts).toEqual([]);
    expect(result).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
    expect(h.fakeManager.save.mock.calls[0][0].consecutiveUnanswered).toBe(2);
  });

  it('the sweep query is BATCH-LIMITED using the configured technical constant — never an unbounded pass', async () => {
    const h = buildTimeoutHarness({ expiredDeliveryIds: [], configOverrides: { sweepBatchLimit: 7 } });
    await h.service.reassignTimedOutDeliveries();
    expect(h.limitCalls).toEqual([7]);
  });

  it('respects a different configured batch limit (e.g. the production default, 50)', async () => {
    const h = buildTimeoutHarness({ expiredDeliveryIds: [] });
    await h.service.reassignTimedOutDeliveries();
    expect(h.limitCalls).toEqual([50]);
  });
});

describe('AutomaticDispatchService — Dispatch Hardening milestone: multi-instance-safe lock', () => {
  const expired = new Date(Date.now() - 5_000);

  it('a lock already held by ANOTHER instance (a different value already at the key) is correctly NOT acquired', async () => {
    const h = buildTimeoutHarness({ expiredDeliveryIds: ['delivery-1'], existingLockValue: 'some-other-instance-token' });
    const result = await h.service.reassignTimedOutDeliveries();
    expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 }); // never even queried
  });

  it('CRITICAL (the bug this milestone fixes): releasing with a STALE/foreign token — because the TTL already expired and another instance re-acquired the lock under a NEW token — is correctly a no-op, never deletes the OTHER instance\'s active lock', async () => {
    // Exercise the private acquire/release pair directly (same convention this codebase already
    // uses for DeliveryAssignmentService's own lock — see redis.int-spec.ts) so the exact CAS
    // contract is proven, not just its net effect on one isolated sweep.
    const h = buildTimeoutHarness({});
    const svc = h.service as any;

    const myToken: string = await svc.acquireSweepLock();
    expect(myToken).toEqual(expect.any(String));

    // Simulate: my lock's TTL expired and a DIFFERENT instance has ALREADY re-acquired it under its
    // own, different token — i.e. the key's current value is no longer mine.
    const otherInstancesToken = 'other-instance-token';
    h.setLockValueForTest(otherInstancesToken);

    await svc.releaseSweepLock(myToken); // my (now-stale) release attempt
    expect(h.getLockValue()).toBe(otherInstancesToken); // the OTHER instance's lock survives untouched

    await svc.releaseSweepLock(otherInstancesToken); // the actual owner can still release its own
    expect(h.getLockValue()).toBeNull();
  });

  it('the lock key is empty again after a successful sweep — the SAME lock is acquirable by the next tick/instance', async () => {
    const h = buildTimeoutHarness({ expiredDeliveryIds: [] });
    await h.service.reassignTimedOutDeliveries();
    expect(h.getLockValue()).toBeNull();
    // A second, fully independent call (simulating the NEXT tick, or another instance) can acquire it again.
    const result = await h.service.reassignTimedOutDeliveries();
    expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 });
  });

  it('Redis unavailable at LOCK ACQUISITION: fails safely, returns a zeroed result, never throws, existing data untouched', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      redisSetThrows: new Error('ECONNREFUSED'),
    });

    const result = await h.service.reassignTimedOutDeliveries();

    expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 });
    expect(h.orderStateMachine.transitionInTransaction).not.toHaveBeenCalled(); // never even attempted
  });

  it('Redis unavailable at LOCK RELEASE (after real work already committed): the sweep result is still returned successfully — a release failure is degraded-but-recoverable (TTL self-heals), never surfaced as the sweep having failed', async () => {
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: expired, orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
      redisEvalThrows: new Error('ECONNRESET'),
    });

    const result = await h.service.reassignTimedOutDeliveries();

    // The actual dispatch work (the part that matters — real, authoritative state) still completed.
    expect(result).toEqual({ processed: 1, reassigned: 1, alerted: 0, skipped: 0 });
    expect(h.assignDriverCalls).toEqual([{ orderId: 'order-1', candidateDriverIds: ['driver-2'] }]);
  });
});

describe('AutomaticDispatchService — Dispatch Hardening milestone: lifecycle (start/stop/shutdown)', () => {
  it('does NOT start the periodic sweep under NODE_ENV=test — every other dispatch/order test in this codebase depends on no autonomous timer firing mid-test', () => {
    const h = buildTimeoutHarness({ configOverrides: { env: 'test' } });
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    h.service.onModuleInit();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('DOES start the periodic sweep outside test mode, using the configured interval', () => {
    const h = buildTimeoutHarness({ configOverrides: { env: 'production', sweepIntervalMs: 12_345 } });
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref: jest.fn() } as any);
    h.service.onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 12_345);
    setIntervalSpy.mockRestore();
    (h.service as any).onModuleDestroy?.();
  });

  it('onModuleDestroy clears the interval and never lets a queued tick start new work', async () => {
    const h = buildTimeoutHarness({ configOverrides: { env: 'production' } });
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    h.service.onModuleInit();
    await h.service.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it('onModuleDestroy AWAITS an in-flight sweep rather than abandoning it mid-transaction', async () => {
    let releaseBlocked = (_v?: unknown) => {};
    const blocker = new Promise((resolve) => (releaseBlocked = resolve));
    const h = buildTimeoutHarness({
      expiredDeliveryIds: ['delivery-1'],
      deliveriesById: { 'delivery-1': { acceptDeadlineAt: new Date(Date.now() - 1000), orderId: 'order-1', driverId: 'driver-1' } },
      candidatesByOrderId: { 'order-1': ['driver-2'] },
    });
    // Make the ranking call (mid-sweep) hang until we release it — simulates "still in flight".
    h.driverRankingService.rankCandidates.mockImplementation(async () => {
      await blocker;
      return ['driver-2'];
    });

    const sweepPromise = h.service.reassignTimedOutDeliveries();
    (h.service as any).inFlightSweep = sweepPromise;

    let destroyResolved = false;
    const destroyPromise = h.service.onModuleDestroy().then(() => (destroyResolved = true));

    await new Promise((r) => setTimeout(r, 20));
    expect(destroyResolved).toBe(false); // still waiting on the in-flight sweep

    releaseBlocked();
    await destroyPromise;
    expect(destroyResolved).toBe(true);
    await sweepPromise;
  });
});
