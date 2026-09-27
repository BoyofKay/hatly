import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DriverCashRemainderService } from './driver-cash-remainder.service';
import { DriverCashRemainderStatus } from './driver-cash-remainder-status.enum';
import { DriverCashRemainder } from './entities/driver-cash-remainder.entity';
import { WalletService } from '../wallet/wallet.service';

function buildHarness(params: {
  order?: any;
  delivery?: any;
  driver?: any;
  existingRemainder?: any;
} = {}) {
  const order = params.order ?? { id: 'order-1', customerId: 'customer-1', totalMinor: 30000, paymentMethod: 'COD', status: 'DELIVERED' };
  const delivery = params.delivery ?? { id: 'delivery-1', orderId: order.id, driverId: 'driver-1' };
  const driver = params.driver ?? { id: 'driver-1', userId: 'driver-user-1' };

  const remainderStore = new Map<string, any>();
  if (params.existingRemainder) {
    remainderStore.set(params.existingRemainder.id, params.existingRemainder);
  }
  const walletStore = new Map<string, any>();

  const remaindersRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      if (!entity.id && [...remainderStore.values()].some((r) => r.orderId === entity.orderId)) {
        const e: any = new Error('duplicate key value violates unique constraint "idx_driver_cash_remainders_order_unique"');
        e.code = '23505';
        throw e;
      }
      const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
      remainderStore.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => [...remainderStore.values()].filter((r) => r.status === opts.where.status),
    findOne: async (opts: any) => {
      if (opts.where.id) return remainderStore.get(opts.where.id) ?? null;
      if (opts.where.orderId) return [...remainderStore.values()].find((r) => r.orderId === opts.where.orderId) ?? null;
      return null;
    },
  };

  const driverAuthorizationService = {
    getDriverForUser: jest.fn(async (userId: string) => {
      if (userId !== driver.userId) throw new NotFoundException('Driver profile not found.');
      return driver;
    }),
    assertOwnsDelivery: jest.fn(async (driverId: string, deliveryId: string) => {
      if (deliveryId !== delivery.id || delivery.driverId !== driverId) {
        throw new NotFoundException('Delivery not found.');
      }
      return delivery;
    }),
  };

  const walletRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      if ([...walletStore.values()].some((w) => w.idempotencyKey === entity.idempotencyKey)) {
        const e: any = new Error('duplicate key value violates unique constraint');
        e.code = '23505';
        throw e;
      }
      const withId = { id: entity.id ?? randomUUID(), createdAt: new Date(), ...entity };
      walletStore.set(withId.id, withId);
      return withId;
    },
    find: async () => [...walletStore.values()],
  };
  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  const walletService = new WalletService(walletRepository as any, requestContextService as any);

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === DriverCashRemainder) return remainderStore.get(opts.where.id) ?? null;
      return null;
    },
    save: async (entity: any) => {
      remainderStore.set(entity.id, entity);
      return entity;
    },
    getRepository: (EntityClass: any) => {
      if (EntityClass.name === 'Order') return { findOne: async () => order };
      return walletRepository;
    },
  };
  const dataSource = {
    transaction: async (cb: any) => cb(manager),
    getRepository: (EntityClass: any) => {
      if (EntityClass.name === 'Order') return { findOne: async () => order };
      throw new Error('unhandled getRepository');
    },
  };

  const service = new DriverCashRemainderService(
    remaindersRepository as any,
    driverAuthorizationService as any,
    dataSource as any,
    walletService as any,
    requestContextService as any,
  );
  return { service, remainderStore, walletStore, order, delivery, driver, driverAuthorizationService };
}

describe('DriverCashRemainderService.submit', () => {
  it('a Driver can submit a valid remainder for their own assigned Delivery', async () => {
    const { service, remainderStore } = buildHarness();
    const remainder = await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 35000 });
    expect(remainder.remainderAmountMinor).toBe(5000);
    expect(remainder.status).toBe(DriverCashRemainderStatus.PENDING_REVIEW);
    expect(remainderStore.size).toBe(1);
  });

  it('CRITICAL: a Driver cannot submit for a Delivery that is not theirs', async () => {
    const { service } = buildHarness({ delivery: { id: 'delivery-1', orderId: 'order-1', driverId: 'some-other-driver' } });
    await expect(
      service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 35000 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('CRITICAL: customer identity always comes from the Order, never a client-supplied field (the DTO has no customerId at all)', async () => {
    const { service } = buildHarness();
    const remainder = await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 35000 });
    expect(remainder.customerId).toBe('customer-1');
  });

  it('zero remainder (cash received equals amount due) is rejected', async () => {
    const { service } = buildHarness();
    await expect(
      service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 30000 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('negative remainder (cash received less than amount due) is rejected', async () => {
    const { service } = buildHarness();
    await expect(
      service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 20000 }),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'CANCELLED', 'FAILED_DELIVERY'])(
    'refuses a remainder while the order is %s — cash cannot have changed hands (Group 8 regression)',
    async (status) => {
      const { service } = buildHarness({ order: { id: 'order-1', customerId: 'customer-1', totalMinor: 30000, paymentMethod: 'COD', status } });
      await expect(service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 50000 })).rejects.toMatchObject({
        response: { details: { code: 'ORDER_NOT_AT_HANDOVER', status } },
      });
    },
  );

  it.each(['ON_THE_WAY', 'DELIVERED'])('accepts a remainder while the order is %s (the driver is at the door / has handed over)', async (status) => {
    const { service } = buildHarness({ order: { id: 'order-1', customerId: 'customer-1', totalMinor: 30000, paymentMethod: 'COD', status } });
    const saved = await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 50000 });
    expect(saved.remainderAmountMinor).toBe(20000);
  });

  it('CRITICAL: the remainder is always derived from the Order\u2019s own totalMinor — never an independently-submitted, inconsistent value', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', customerId: 'customer-1', totalMinor: 12345, paymentMethod: 'COD', status: 'DELIVERED' } });
    const remainder = await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 15000 });
    expect(remainder.remainderAmountMinor).toBe(2655); // 15000 - 12345, never a value the driver could misreport independently
  });

  it('rejects a non-cash Order (ONLINE payment method)', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', customerId: 'customer-1', totalMinor: 30000, paymentMethod: 'ONLINE', status: 'DELIVERED' } });
    await expect(
      service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 35000 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('submission does NOT create a WalletTransaction', async () => {
    const { service, walletStore } = buildHarness();
    await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 35000 });
    expect(walletStore.size).toBe(0);
  });

  it('CRITICAL: idempotent — a second submission for the same Order returns the existing claim rather than duplicating', async () => {
    const { service, remainderStore } = buildHarness();
    const first = await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 35000 });
    const second = await service.submit({ driverUserId: 'driver-user-1', deliveryId: 'delivery-1', cashReceivedMinor: 40000 });
    expect(second.id).toBe(first.id);
    expect(remainderStore.size).toBe(1);
  });
});

describe('DriverCashRemainderService.approve/reject', () => {
  function makePendingRemainder(overrides: Partial<any> = {}) {
    return {
      id: 'remainder-1',
      orderId: 'order-1',
      deliveryId: 'delivery-1',
      driverId: 'driver-1',
      customerId: 'customer-1',
      remainderAmountMinor: 5000,
      status: DriverCashRemainderStatus.PENDING_REVIEW,
      submittedAt: new Date(),
      ...overrides,
    };
  }

  it('Admin can approve a pending remainder', async () => {
    const { service } = buildHarness({ existingRemainder: makePendingRemainder() });
    const result = await service.approve('remainder-1', 'admin-1');
    expect(result.status).toBe(DriverCashRemainderStatus.APPROVED);
  });

  it('CRITICAL: approval creates exactly one DRIVER_CASH_REMAINDER WalletTransaction with the correct customer/order/amount/admin', async () => {
    const { service, walletStore } = buildHarness({ existingRemainder: makePendingRemainder() });
    await service.approve('remainder-1', 'admin-1');
    expect(walletStore.size).toBe(1);
    const tx = [...walletStore.values()][0];
    expect(tx.type).toBe('DRIVER_CASH_REMAINDER');
    expect(tx.customerId).toBe('customer-1');
    expect(tx.orderId).toBe('order-1');
    expect(tx.amountDeltaMinor).toBe(5000);
    expect(tx.createdByUserId).toBe('admin-1');
  });

  it('approval marks the remainder APPROVED with reviewedAt/reviewedByUserId set', async () => {
    const { service } = buildHarness({ existingRemainder: makePendingRemainder() });
    const result = await service.approve('remainder-1', 'admin-1');
    expect(result.reviewedByUserId).toBe('admin-1');
    expect(result.reviewedAt).toBeInstanceOf(Date);
  });

  it('Admin rejection marks the remainder REJECTED and requires a reason', async () => {
    const { service } = buildHarness({ existingRemainder: makePendingRemainder() });
    const result = await service.reject('remainder-1', 'admin-1', 'Driver could not verify the amount.');
    expect(result.status).toBe(DriverCashRemainderStatus.REJECTED);
    expect(result.rejectionReason).toBe('Driver could not verify the amount.');
  });

  it('rejection without a reason is rejected', async () => {
    const { service } = buildHarness({ existingRemainder: makePendingRemainder() });
    await expect(service.reject('remainder-1', 'admin-1', '')).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejection creates no WalletTransaction', async () => {
    const { service, walletStore } = buildHarness({ existingRemainder: makePendingRemainder() });
    await service.reject('remainder-1', 'admin-1', 'reason');
    expect(walletStore.size).toBe(0);
  });

  it('CRITICAL: a REJECTED remainder cannot be approved', async () => {
    const { service } = buildHarness({ existingRemainder: makePendingRemainder({ status: DriverCashRemainderStatus.REJECTED }) });
    await expect(service.approve('remainder-1', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: an APPROVED remainder cannot be approved again', async () => {
    const { service, walletStore } = buildHarness({ existingRemainder: makePendingRemainder({ status: DriverCashRemainderStatus.APPROVED }) });
    await expect(service.approve('remainder-1', 'admin-1')).rejects.toThrow(BadRequestException);
    expect(walletStore.size).toBe(0); // no new credit created by the rejected re-approval attempt
  });

  it('CRITICAL: duplicate approval cannot create two WalletTransactions — idempotency via the deterministic key derived from the remainder id', async () => {
    const remainder = makePendingRemainder();
    const { service, walletStore, remainderStore } = buildHarness({ existingRemainder: remainder });
    await service.approve('remainder-1', 'admin-1');
    // Simulate a retried approval racing in before the status flip was
    // visible (defense-in-depth path): force status back to PENDING_REVIEW
    // to exercise the Wallet-side unique-key collision directly.
    remainderStore.get('remainder-1').status = DriverCashRemainderStatus.PENDING_REVIEW;
    await service.approve('remainder-1', 'admin-1');
    expect(walletStore.size).toBe(1); // still exactly one credit, never two
  });

  it('CRITICAL: failure during approval leaves the remainder pending and creates no WalletTransaction', async () => {
    const { service, remainderStore, walletStore } = buildHarness({ existingRemainder: makePendingRemainder() });
    // Force the wallet write itself to fail with a non-duplicate error.
    (service as any).walletService.recordTransaction = jest.fn(async () => {
      throw new Error('simulated failure');
    });
    await expect(service.approve('remainder-1', 'admin-1')).rejects.toThrow('simulated failure');
    expect(remainderStore.get('remainder-1').status).toBe(DriverCashRemainderStatus.PENDING_REVIEW);
    expect(walletStore.size).toBe(0);
  });

  it('customer Wallet balance increases only after approval, not after submission', async () => {
    const { service } = buildHarness({ existingRemainder: makePendingRemainder() });
    const walletService: WalletService = (service as any).walletService;
    expect(await walletService.getBalance('customer-1')).toBe(0);
    await service.approve('remainder-1', 'admin-1');
    expect(await walletService.getBalance('customer-1')).toBe(5000);
  });

  it('approving/rejecting a non-existent remainder throws NotFoundException', async () => {
    const { service } = buildHarness();
    await expect(service.approve('missing-id', 'admin-1')).rejects.toThrow(NotFoundException);
  });

  it('no update/delete method is exposed for a historical (APPROVED/REJECTED) remainder beyond approve/reject themselves', () => {
    const proto = Object.getOwnPropertyNames(DriverCashRemainderService.prototype);
    expect(proto).not.toContain('update');
    expect(proto).not.toContain('delete');
    expect(proto).not.toContain('edit');
  });
});

describe('DriverCashRemainderService.findByOrderId — Admin Order Detail View (Chunk 2a)', () => {
  it('returns the remainder(s) associated with the given order id, read-only', async () => {
    const remaindersRepository = {
      find: jest.fn(async (opts: any) => [{ id: 'remainder-1', orderId: 'order-1', status: 'PENDING_REVIEW' }].filter((r) => r.orderId === opts.where.orderId)),
    };
    const service = new DriverCashRemainderService(remaindersRepository as any, {} as any, {} as any, {} as any, { getCorrelationId: () => 'corr-test' } as any);

    const result = await service.findByOrderId('order-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('remainder-1');
  });

  it('returns an empty array when no remainder exists for the order', async () => {
    const remaindersRepository = { find: jest.fn(async () => []) };
    const service = new DriverCashRemainderService(remaindersRepository as any, {} as any, {} as any, {} as any, { getCorrelationId: () => 'corr-test' } as any);

    const result = await service.findByOrderId('order-with-none');

    expect(result).toEqual([]);
  });
});

describe('DriverCashRemainderService — structured business-event logging (Group 4)', () => {
  it('E/F: approve() logs driver_cash_remainder.approved and wallet.credit with safe identifiers and the integer minor-unit amount, post-commit', async () => {
    const existingRemainder = {
      id: 'remainder-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      driverId: 'driver-1',
      remainderAmountMinor: 750,
      status: DriverCashRemainderStatus.PENDING_REVIEW,
    };
    const { service } = buildHarness({ existingRemainder });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.approve('remainder-1', 'admin-1');

    const events = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    const approvedEvent = events.find((e) => e.event === 'driver_cash_remainder.approved');
    expect(approvedEvent).toEqual({
      event: 'driver_cash_remainder.approved',
      correlationId: 'corr-test',
      remainderId: 'remainder-1',
      orderId: 'order-1',
      customerId: 'customer-1',
      driverId: 'driver-1',
      amountMinor: 750,
      adminUserId: 'admin-1',
      walletIdempotencyConflict: false,
    });
    const creditEvent = events.find((e) => e.event === 'wallet.credit');
    expect(creditEvent).toMatchObject({ amountDeltaMinor: 750, customerId: 'customer-1' });
  });

  it('F: a benign concurrent wallet-write conflict during approval is reflected as walletIdempotencyConflict:true, and no wallet.credit is (falsely) logged', async () => {
    const existingRemainder = {
      id: 'remainder-2',
      orderId: 'order-2',
      customerId: 'customer-1',
      driverId: 'driver-1',
      remainderAmountMinor: 400,
      status: DriverCashRemainderStatus.PENDING_REVIEW,
    };
    const { service } = buildHarness({ existingRemainder });
    // Force the wallet write to collide, simulating the narrow concurrent-approval race this method's own comment documents.
    (service as any).walletService.recordTransaction = jest.fn(async () => {
      const e: any = new Error('duplicate key value violates unique constraint');
      e.code = '23505';
      throw e;
    });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    await service.approve('remainder-2', 'admin-1');

    const events = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    expect(events.find((e) => e.event === 'driver_cash_remainder.approved')).toMatchObject({ walletIdempotencyConflict: true });
    expect(events.find((e) => e.event === 'wallet.credit')).toBeUndefined();
  });
});
