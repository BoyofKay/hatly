import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FailedDeliveryResolutionService } from './failed-delivery-resolution.service';
import { FailedDeliveryOutcome } from './failed-delivery-outcome.enum';
import { FailedDeliveryResolution } from './entities/failed-delivery-resolution.entity';
import { Order } from '../orders/entities/order.entity';
import { Payment } from '../payments/entities/payment.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { User } from '../users/entities/user.entity';

function buildHarness(seed: {
  order?: any;
  existingResolution?: any;
  payments?: any[];
  deliveries?: any[];
  drivers?: any[];
  users?: any[];
}) {
  const orderStore = new Map<string, any>();
  if (seed.order) orderStore.set(seed.order.id, { ...seed.order });
  const resolutionStore = new Map<string, any>();
  if (seed.existingResolution) resolutionStore.set(seed.existingResolution.id ?? 'existing', { ...seed.existingResolution });

  function makeQb(rows: any[], filterField: string) {
    let filterValues: string[] = [];
    const qb: any = {
      leftJoin: () => qb,
      where: (_sql: string, params: any) => {
        if (params?.status) filterValues = ['STATUS_FILTER:' + params.status];
        if (params?.orderIds) filterValues = params.orderIds;
        if (params?.customerIds) filterValues = params.customerIds;
        if (params?.driverIds) filterValues = params.driverIds;
        return qb;
      },
      andWhere: () => qb,
      orderBy: () => qb,
      addOrderBy: () => qb,
      getMany: async () => {
        if (filterValues[0]?.toString().startsWith('STATUS_FILTER:')) {
          const status = filterValues[0].toString().replace('STATUS_FILTER:', '');
          return rows.filter((r) => r.status === status && ![...resolutionStore.values()].some((res) => res.orderId === r.id));
        }
        return rows.filter((r) => filterValues.includes(r[filterField]));
      },
    };
    return qb;
  }

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === Order) return orderStore.get(opts.where.id) ?? null;
      if (EntityClass === FailedDeliveryResolution) {
        return [...resolutionStore.values()].find((r) => r.orderId === opts.where.orderId) ?? null;
      }
      throw new Error('unhandled findOne');
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === FailedDeliveryResolution) resolutionStore.set(withId.id, withId);
      return withId;
    },
    createQueryBuilder: (EntityClass: any, _alias: string) => {
      if (EntityClass === Order) return makeQb([...orderStore.values()], 'id');
      if (EntityClass === Payment) return makeQb(seed.payments ?? [], 'orderId');
      if (EntityClass === Delivery) return makeQb(seed.deliveries ?? [], 'orderId');
      if (EntityClass === Driver) return makeQb(seed.drivers ?? [], 'id');
      if (EntityClass === User) return makeQb(seed.users ?? [], 'id');
      throw new Error(`unhandled createQueryBuilder ${EntityClass.name}`);
    },
  };
  const dataSource = { manager, transaction: async (cb: any) => cb(manager) };
  const manualTransferRefundService = { recordRefund: jest.fn(async () => undefined) };
  const financialEventService = { findByOrderId: jest.fn(async () => []) };
  const service = new FailedDeliveryResolutionService(dataSource as any, manualTransferRefundService as any, financialEventService as any, { getCorrelationId: () => 'corr-test' } as any, {} as any);
  return { service, orderStore, resolutionStore };
}

describe('FailedDeliveryResolutionService.resolve — validation', () => {
  it('RESOLVED_NO_REFUND with null refund amount succeeds', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const resolution = await service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1');
    expect(resolution.refundAmountMinor).toBeNull();
  });

  it('RESOLVED_NO_REFUND with a refund amount is rejected', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    await expect(
      service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND, refundAmountMinor: 100 }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('REFUND_CUSTOMER with a positive refund amount succeeds', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const resolution = await service.resolve('order-1', { outcome: FailedDeliveryOutcome.REFUND_CUSTOMER, refundAmountMinor: 5000 }, 'admin-1');
    expect(resolution.refundAmountMinor).toBe(5000);
  });

  it('B (Group 4): a successful resolve() logs failed_delivery.resolved with safe identifiers, post-commit', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

    const resolution = await service.resolve(
      'order-1',
      { outcome: FailedDeliveryOutcome.REFUND_CUSTOMER, refundAmountMinor: 5000 },
      'admin-1',
    );

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toEqual({
      event: 'failed_delivery.resolved',
      correlationId: 'corr-test',
      resolutionId: resolution.id,
      orderId: 'order-1',
      outcome: FailedDeliveryOutcome.REFUND_CUSTOMER,
      refundAmountMinor: 5000,
      resolvedByUserId: 'admin-1',
    });
  });

  it('REFUND_CUSTOMER without a refund amount is rejected', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    await expect(service.resolve('order-1', { outcome: FailedDeliveryOutcome.REFUND_CUSTOMER }, 'admin-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('REFUND_CUSTOMER with zero is rejected', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    await expect(
      service.resolve('order-1', { outcome: FailedDeliveryOutcome.REFUND_CUSTOMER, refundAmountMinor: 0 }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('REFUND_CUSTOMER with a negative amount is rejected', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    await expect(
      service.resolve('order-1', { outcome: FailedDeliveryOutcome.REFUND_CUSTOMER, refundAmountMinor: -100 }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('FailedDeliveryResolutionService.resolve — resolution lifecycle', () => {
  it('cannot resolve a non-existent Order', async () => {
    const { service } = buildHarness({});
    await expect(
      service.resolve('missing-order', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('CRITICAL: cannot resolve an Order unless status is FAILED_DELIVERY', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'DELIVERED' } });
    await expect(
      service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('can resolve a FAILED_DELIVERY order successfully', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const resolution = await service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1');
    expect(resolution.orderId).toBe('order-1');
  });

  it('CRITICAL: a second resolution for the same Order is rejected', async () => {
    const { service } = buildHarness({
      order: { id: 'order-1', status: 'FAILED_DELIVERY' },
      existingResolution: { id: 'res-1', orderId: 'order-1', outcome: 'RESOLVED_NO_REFUND' },
    });
    await expect(
      service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('stores resolvedByUserId and resolvedAt', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const resolution = await service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-42');
    expect(resolution.resolvedByUserId).toBe('admin-42');
    expect(resolution.resolvedAt).toBeInstanceOf(Date);
  });

  it('stores driverReviewNeeded/driverReviewNotes correctly', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const resolution = await service.resolve(
      'order-1',
      { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND, driverReviewNeeded: true, driverReviewNotes: 'Check driver conduct' },
      'admin-1',
    );
    expect(resolution.driverReviewNeeded).toBe(true);
    expect(resolution.driverReviewNotes).toBe('Check driver conduct');
  });

  it('stores general notes correctly', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const resolution = await service.resolve(
      'order-1',
      { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND, notes: 'Customer contacted via phone' },
      'admin-1',
    );
    expect(resolution.notes).toBe('Customer contacted via phone');
  });

  it('CRITICAL: does not modify Order.status', async () => {
    const { service, orderStore } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    await service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1');
    expect(orderStore.get('order-1').status).toBe('FAILED_DELIVERY');
  });

  it('CRITICAL: resolve() itself never calls the refund/financial-event dependencies — only executeManualTransferRefund() does', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY' } });
    const manualTransferRefundService = (service as any).manualTransferRefundService;
    const financialEventService = (service as any).financialEventService;
    await service.resolve('order-1', { outcome: FailedDeliveryOutcome.RESOLVED_NO_REFUND }, 'admin-1');
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
    expect(financialEventService.findByOrderId).not.toHaveBeenCalled();
  });
});

describe('FailedDeliveryResolutionService.listQueue', () => {
  it('a FAILED_DELIVERY order without a resolution appears in the queue', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'FAILED_DELIVERY', paymentMethod: 'COD' } });
    const queue = await service.listQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].orderId).toBe('order-1');
  });

  it('a FAILED_DELIVERY order WITH a resolution does not appear', async () => {
    const { service } = buildHarness({
      order: { id: 'order-1', status: 'FAILED_DELIVERY', paymentMethod: 'COD' },
      existingResolution: { id: 'res-1', orderId: 'order-1', outcome: 'RESOLVED_NO_REFUND' },
    });
    const queue = await service.listQueue();
    expect(queue).toHaveLength(0);
  });

  it('a non-FAILED_DELIVERY order does not appear', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', status: 'DELIVERED', paymentMethod: 'COD' } });
    const queue = await service.listQueue();
    expect(queue).toHaveLength(0);
  });

  it('the queue returns only the lightweight projection fields', async () => {
    const { service } = buildHarness({ order: { id: 'order-1', orderNumber: 'HT-100001', status: 'FAILED_DELIVERY', paymentMethod: 'COD', failureReason: 'x', failedAt: new Date(), customerId: 'customer-1', totalMinor: 5000 } });
    const queue = await service.listQueue();
    expect(Object.keys(queue[0]).sort()).toEqual(
      ['orderId', 'orderNumber', 'failedAt', 'failureReason', 'customerId', 'customerName', 'driverId', 'driverName', 'totalMinor', 'paymentMethod', 'paymentStatus', 'createdAt'].sort(),
    );
    expect(queue[0].orderNumber).toBe('HT-100001');
  });
});

describe('FailedDeliveryResolutionService.executeManualTransferRefund (Chunk 2c)', () => {
  function buildExecutionHarness(seed: {
    order?: any;
    resolution?: any;
    payment?: any;
    existingFinancialEvents?: any[];
    /** Wallet ledger rows already written for this order (ORDER_REFUND), by idempotency key. */
    walletRefunds?: Array<{ idempotencyKey: string; amountDeltaMinor: number }>;
  }) {
    const order = seed.order ?? { id: 'order-1', status: 'FAILED_DELIVERY' };
    const resolution = seed.resolution;
    const payment = seed.payment;

    const paymentRepository = {
      createQueryBuilder: (_alias: string) => {
        const qb: any = {
          where: () => qb,
          setLock: () => qb,
          getOne: async () => (payment ? { ...payment } : null),
        };
        return qb;
      },
    };
    const manager = {
      findOne: async (EntityClass: any, opts: any) => {
        if (EntityClass.name === 'Order') return opts.where.id === order.id ? order : null;
        if (EntityClass.name === 'FailedDeliveryResolution') return resolution ?? null;
        throw new Error('unhandled findOne');
      },
      getRepository: (EntityClass: any) => {
        if (EntityClass.name === 'Payment') return paymentRepository;
        throw new Error(`unhandled getRepository ${EntityClass.name}`);
      },
    };
    const dataSource = { transaction: async (cb: any) => cb(manager) };
    const manualTransferRefundService = {
      recordRefund: jest.fn(
        async (_params: { paymentId: string; amountMinor: number; reason?: string; actorUserId: string }, _manager?: unknown) =>
          undefined,
      ),
    };
    const financialEventService = { findByOrderId: jest.fn(async () => seed.existingFinancialEvents ?? []) };
    const walletRefunds = [...(seed.walletRefunds ?? [])];
    const walletService = {
      findByIdempotencyKey: jest.fn(async (key: string) => walletRefunds.find((r) => r.idempotencyKey === key) ?? null),
      getRefundedForOrderMinor: jest.fn(async () => walletRefunds.reduce((sum, r) => sum + r.amountDeltaMinor, 0)),
      // Mirrors WalletService.refundOrderPayment's contract (cap + idempotency) so the waterfall's wallet leg is observable.
      refundOrderPayment: jest.fn(async (_m: unknown, p: { walletPaidMinor: number; amountMinor: number; idempotencyKey: string }) => {
        const refunded = walletRefunds.reduce((sum, r) => sum + r.amountDeltaMinor, 0);
        if (p.amountMinor > p.walletPaidMinor - refunded) throw new BadRequestException({ details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' } });
        walletRefunds.push({ idempotencyKey: p.idempotencyKey, amountDeltaMinor: p.amountMinor });
        return p.amountMinor;
      }),
    };

    const service = new FailedDeliveryResolutionService(dataSource as any, manualTransferRefundService as any, financialEventService as any, { getCorrelationId: () => 'corr-test' } as any, walletService as any);
    return { service, manualTransferRefundService, financialEventService, walletService, walletRefunds };
  }

  function makeResolution(overrides: Partial<any> = {}) {
    return { id: 'resolution-1', orderId: 'order-1', outcome: 'REFUND_CUSTOMER', refundAmountMinor: 5000, ...overrides };
  }
  function makePayment(overrides: Partial<any> = {}) {
    return { id: 'payment-1', orderId: 'order-1', method: 'MANUAL_TRANSFER', status: 'PAID', amountMinor: 10000, ...overrides };
  }

  it('CRITICAL: a valid REFUND_CUSTOMER + MANUAL_TRANSFER + PAID resolution executes and creates the refund', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({ resolution: makeResolution(), payment: makePayment() });
    const result = await service.executeManualTransferRefund('order-1', 'admin-1');
    expect(result.status).toBe('REFUNDED');
    expect(manualTransferRefundService.recordRefund).toHaveBeenCalledTimes(1);
    const [params, manager] = manualTransferRefundService.recordRefund.mock.calls[0];
    expect(params.paymentId).toBe('payment-1');
    expect(params.amountMinor).toBe(5000);
    expect(params.actorUserId).toBe('admin-1');
    expect(params.reason).toContain('resolution-1');
    expect(manager).toBeTruthy();
  });

  it('a missing Resolution rejects', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({ resolution: undefined, payment: makePayment() });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(NotFoundException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('a RESOLVED_NO_REFUND resolution rejects', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({
      resolution: makeResolution({ outcome: 'RESOLVED_NO_REFUND', refundAmountMinor: null }),
      payment: makePayment(),
    });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(BadRequestException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('CRITICAL: a missing Payment rejects (COD case) — no event created', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({ resolution: makeResolution(), payment: undefined });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(BadRequestException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('CRITICAL: a non-Manual-Transfer payment method rejects', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({
      resolution: makeResolution(),
      payment: makePayment({ method: 'COD' }),
    });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(BadRequestException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('a Payment status of UNDER_REVIEW rejects', async () => {
    const { service } = buildExecutionHarness({ resolution: makeResolution(), payment: makePayment({ status: 'UNDER_REVIEW' }) });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('a Payment status of REJECTED rejects', async () => {
    const { service } = buildExecutionHarness({ resolution: makeResolution(), payment: makePayment({ status: 'REJECTED' }) });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: a refund amount exceeding Payment.amountMinor rejects', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({
      resolution: makeResolution({ refundAmountMinor: 20000 }),
      payment: makePayment({ amountMinor: 10000 }),
    });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(BadRequestException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('a refund amount EQUAL to Payment.amountMinor succeeds (full refund)', async () => {
    const { service } = buildExecutionHarness({
      resolution: makeResolution({ refundAmountMinor: 10000 }),
      payment: makePayment({ amountMinor: 10000 }),
    });
    const result = await service.executeManualTransferRefund('order-1', 'admin-1');
    expect(result.status).toBe('REFUNDED');
  });

  it('a refund amount LESS THAN Payment.amountMinor succeeds (partial refund)', async () => {
    const { service } = buildExecutionHarness({
      resolution: makeResolution({ refundAmountMinor: 3000 }),
      payment: makePayment({ amountMinor: 10000 }),
    });
    const result = await service.executeManualTransferRefund('order-1', 'admin-1');
    expect(result.status).toBe('REFUNDED');
    expect(result.refundAmountMinor).toBe(3000);
  });

  it('CRITICAL: repeated execution with the same amount returns idempotent ALREADY_REFUNDED without creating a second event', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({
      resolution: makeResolution({ refundAmountMinor: 5000 }),
      payment: makePayment(),
      existingFinancialEvents: [{ type: 'MANUAL_TRANSFER_REFUND_RECORDED', paymentId: 'payment-1', amountMinor: 5000 }],
    });
    const result = await service.executeManualTransferRefund('order-1', 'admin-1');
    expect(result.status).toBe('ALREADY_REFUNDED');
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('CRITICAL: an existing refund event with a DIFFERENT amount is treated as a conflict, never silently accepted', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({
      resolution: makeResolution({ refundAmountMinor: 5000 }),
      payment: makePayment(),
      existingFinancialEvents: [{ type: 'MANUAL_TRANSFER_REFUND_RECORDED', paymentId: 'payment-1', amountMinor: 4000 }],
    });
    await expect(service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(ConflictException);
    expect(manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
  });

  it('does not create a refund event for an unrelated payment\u2019s existing event (matches by paymentId)', async () => {
    const { service, manualTransferRefundService } = buildExecutionHarness({
      resolution: makeResolution({ refundAmountMinor: 5000 }),
      payment: makePayment({ id: 'payment-1' }),
      existingFinancialEvents: [{ type: 'MANUAL_TRANSFER_REFUND_RECORDED', paymentId: 'some-other-payment', amountMinor: 5000 }],
    });
    const result = await service.executeManualTransferRefund('order-1', 'admin-1');
    expect(result.status).toBe('REFUNDED');
    expect(manualTransferRefundService.recordRefund).toHaveBeenCalledTimes(1);
  });

  describe('WALLET component (PD-001): EXTERNAL PAYMENT FIRST → WALLET SECOND, never more than was paid', () => {
    const walletOrder = (walletAmountMinor: number, extra: Partial<any> = {}) => ({
      id: 'order-1',
      customerId: 'cust-1',
      status: 'FAILED_DELIVERY',
      walletAmountMinor,
      ...extra,
    });

    it('FULL WALLET (no Payment row): the whole refund returns to the wallet — nothing goes to a transfer', async () => {
      const h = buildExecutionHarness({ order: walletOrder(10000), resolution: makeResolution({ refundAmountMinor: 10000 }), payment: undefined });
      const r = await h.service.executeManualTransferRefund('order-1', 'admin-1');
      expect(r).toMatchObject({ status: 'REFUNDED', paymentId: null, transferRefundedMinor: 0, walletRefundedMinor: 10000 });
      expect(h.manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
      expect(h.walletRefunds).toEqual([{ idempotencyKey: 'order-refund:order-1:failed-delivery', amountDeltaMinor: 10000 }]);
    });

    it('WALLET + COD / PAY_AT_DELIVERY (no Payment row): only the wallet-paid part is refundable — the unpaid cash never is', async () => {
      const ok = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 3000 }), payment: undefined });
      await expect(ok.service.executeManualTransferRefund('order-1', 'admin-1')).resolves.toMatchObject({ walletRefundedMinor: 3000, transferRefundedMinor: 0 });

      const tooMuch = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 3001 }), payment: undefined });
      await expect(tooMuch.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' } } });
      expect(tooMuch.walletRefunds).toEqual([]);
    });

    it('COD only (no wallet, no Payment) still rejects — no fictitious refund', async () => {
      const h = buildExecutionHarness({ order: walletOrder(0), resolution: makeResolution(), payment: undefined });
      await expect(h.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'NO_MANUAL_TRANSFER_PAYMENT' } } });
    });

    it('WALLET + PAID TRANSFER (total 100 = wallet 30 + transfer 70): refunding 80 returns the 70 transfer FIRST, then 10 to the wallet', async () => {
      const h = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 8000 }), payment: makePayment({ amountMinor: 7000 }) });
      const r = await h.service.executeManualTransferRefund('order-1', 'admin-1');
      expect(r).toMatchObject({ status: 'REFUNDED', transferRefundedMinor: 7000, walletRefundedMinor: 1000 });
      expect(h.manualTransferRefundService.recordRefund.mock.calls[0][0]).toMatchObject({ paymentId: 'payment-1', amountMinor: 7000 });
      expect(h.walletRefunds[0].amountDeltaMinor).toBe(1000);
    });

    it('a refund that fits inside the transfer never touches the wallet', async () => {
      const h = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 4000 }), payment: makePayment({ amountMinor: 7000 }) });
      const r = await h.service.executeManualTransferRefund('order-1', 'admin-1');
      expect(r).toMatchObject({ transferRefundedMinor: 4000, walletRefundedMinor: 0 });
      expect(h.walletService.refundOrderPayment).not.toHaveBeenCalled();
    });

    it('cannot refund more than transfer + wallet paid (100), and an earlier segment refund is deducted from what is left', async () => {
      const over = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 10001 }), payment: makePayment({ amountMinor: 7000 }) });
      await expect(over.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' } } });

      // 40 of the transfer already came back through a vendor-segment cancellation: only 30 + 30 = 60 remains refundable.
      const seg = [{ type: 'MANUAL_TRANSFER_REFUND_RECORDED', paymentId: 'payment-1', amountMinor: 4000, idempotencyKey: 'manual-transfer-refund:payment-1:segment:s1' }];
      const partial = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 6000 }), payment: makePayment({ amountMinor: 7000 }), existingFinancialEvents: seg });
      await expect(partial.service.executeManualTransferRefund('order-1', 'admin-1')).resolves.toMatchObject({ transferRefundedMinor: 3000, walletRefundedMinor: 3000 });
      const tooMuch = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 6001 }), payment: makePayment({ amountMinor: 7000 }), existingFinancialEvents: seg });
      await expect(tooMuch.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' } } });
    });

    it('wallet money already returned (segment cancel) is not refunded twice', async () => {
      const h = buildExecutionHarness({
        order: walletOrder(3000),
        resolution: makeResolution({ refundAmountMinor: 2000 }),
        payment: undefined,
        walletRefunds: [{ idempotencyKey: 'order-refund:order-1:segment:s1', amountDeltaMinor: 2000 }],
      });
      await expect(h.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' } } });
      expect(h.walletRefunds).toHaveLength(1);
    });

    it('a wallet + transfer order whose transfer is NOT paid: the wallet part is still refundable, the unpaid transfer never is', async () => {
      const h = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 3000 }), payment: makePayment({ status: 'UNDER_REVIEW', amountMinor: 7000 }) });
      await expect(h.service.executeManualTransferRefund('order-1', 'admin-1')).resolves.toMatchObject({ transferRefundedMinor: 0, walletRefundedMinor: 3000 });
      const over = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 3001 }), payment: makePayment({ status: 'UNDER_REVIEW', amountMinor: 7000 }) });
      await expect(over.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toMatchObject({ response: { details: { code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' } } });
    });

    it('IDEMPOTENT: replaying after both components were refunded returns ALREADY_REFUNDED and moves no money; a different amount is a conflict', async () => {
      const events = [{ type: 'MANUAL_TRANSFER_REFUND_RECORDED', paymentId: 'payment-1', amountMinor: 7000, idempotencyKey: 'manual-transfer-refund:payment-1' }];
      const wallet = [{ idempotencyKey: 'order-refund:order-1:failed-delivery', amountDeltaMinor: 1000 }];
      const h = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 8000 }), payment: makePayment({ amountMinor: 7000 }), existingFinancialEvents: events, walletRefunds: wallet });
      await expect(h.service.executeManualTransferRefund('order-1', 'admin-1')).resolves.toMatchObject({ status: 'ALREADY_REFUNDED', transferRefundedMinor: 7000, walletRefundedMinor: 1000 });
      expect(h.manualTransferRefundService.recordRefund).not.toHaveBeenCalled();
      expect(h.walletService.refundOrderPayment).not.toHaveBeenCalled();

      const diff = buildExecutionHarness({ order: walletOrder(3000), resolution: makeResolution({ refundAmountMinor: 9000 }), payment: makePayment({ amountMinor: 7000 }), existingFinancialEvents: events, walletRefunds: wallet });
      await expect(diff.service.executeManualTransferRefund('order-1', 'admin-1')).rejects.toThrow(ConflictException);
    });

    it('a wallet-only replay is idempotent as well', async () => {
      const h = buildExecutionHarness({
        order: walletOrder(5000),
        resolution: makeResolution({ refundAmountMinor: 5000 }),
        payment: undefined,
        walletRefunds: [{ idempotencyKey: 'order-refund:order-1:failed-delivery', amountDeltaMinor: 5000 }],
      });
      await expect(h.service.executeManualTransferRefund('order-1', 'admin-1')).resolves.toMatchObject({ status: 'ALREADY_REFUNDED', walletRefundedMinor: 5000 });
    });
  });

  describe('structured business-event logging (Group 4)', () => {
    it('D: a genuine refund execution logs failed_delivery.refund_executed with only safe identifiers and the integer minor-unit amount, post-commit', async () => {
      const { service } = buildExecutionHarness({ resolution: makeResolution(), payment: makePayment() });
      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);

      await service.executeManualTransferRefund('order-1', 'admin-1');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(logged).toEqual({
        event: 'failed_delivery.refund_executed',
        correlationId: 'corr-test',
        orderId: 'order-1',
        resolutionId: 'resolution-1',
        paymentId: 'payment-1',
        refundAmountMinor: 5000,
        actorUserId: 'admin-1',
      });
    });

    it('F: an idempotent replay logs failed_delivery.refund_already_recorded at WARN instead, distinguishing it from a genuine failure', async () => {
      const { service } = buildExecutionHarness({
        resolution: makeResolution({ refundAmountMinor: 5000 }),
        payment: makePayment(),
        existingFinancialEvents: [{ type: 'MANUAL_TRANSFER_REFUND_RECORDED', paymentId: 'payment-1', amountMinor: 5000 }],
      });
      const logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await service.executeManualTransferRefund('order-1', 'admin-1');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
      expect(logged).toMatchObject({ event: 'failed_delivery.refund_already_recorded', orderId: 'order-1', paymentId: 'payment-1' });
    });
  });
});
