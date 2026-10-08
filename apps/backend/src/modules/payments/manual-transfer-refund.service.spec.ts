import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ManualTransferRefundService } from './manual-transfer-refund.service';
import { PaymentStatus } from './payment-status.enum';

/**
 * Consolidated customer-commerce milestone: `ManualTransferRefundService` now also depends on
 * `LoyaltyService` (post-DELIVERED refund reversal — see that method's own doc comment) and
 * `DataSource` (to open its own transaction for the no-manager call shape). Every harness below
 * passes a no-op `loyaltyService` mock — the reversal logic itself is unit-tested directly in
 * `loyalty.service.spec.ts`, not re-tested here — and a `dataSource` mock whose `transaction()` just
 * invokes the callback with a dummy manager, matching how every OTHER `this.dataSource.transaction`
 * caller in this codebase is mocked (e.g. WalletService's own spec).
 */
function makeLoyaltyServiceMock() {
  return { reverseEarningForRefund: jest.fn(async () => undefined) };
}
function makeDataSourceMock() {
  return { transaction: jest.fn(async (cb: any) => cb({})) };
}

function buildHarness(payment: any | null) {
  const paymentsRepository = {
    findOne: jest.fn(async () => (payment ? { ...payment } : null)),
    save: jest.fn(), // never expected to be called — see the test asserting this
  };
  const recordedEvents: any[] = [];
  const financialEventService = {
    record: jest.fn(async (params: any) => {
      const event = { id: 'event-1', ...params };
      recordedEvents.push(event);
      return event;
    }),
  };
  const service = new ManualTransferRefundService(
    paymentsRepository as any,
    financialEventService as any,
    makeLoyaltyServiceMock() as any,
    makeDataSourceMock() as any,
  );
  return { service, paymentsRepository, recordedEvents };
}

describe('ManualTransferRefundService', () => {
  it('records a refund FinancialEvent for an already-PAID payment', async () => {
    const { service, recordedEvents } = buildHarness({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.PAID,
    });

    await service.recordRefund({ paymentId: 'payment-1', amountMinor: 5000, actorUserId: 'admin-1' });

    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({ amountMinor: 5000, paymentId: 'payment-1', orderId: 'order-1' });
  });

  it('CONFIRMED RULE: never writes to the Payment row itself — PAID stays PAID', async () => {
    const { service, paymentsRepository } = buildHarness({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.PAID,
    });

    await service.recordRefund({ paymentId: 'payment-1', amountMinor: 5000, actorUserId: 'admin-1' });

    expect(paymentsRepository.save).not.toHaveBeenCalled();
  });

  it('rejects refunding a payment that is not PAID (e.g. still UNDER_REVIEW)', async () => {
    const { service } = buildHarness({ id: 'payment-1', orderId: 'order-1', status: PaymentStatus.UNDER_REVIEW });

    await expect(
      service.recordRefund({ paymentId: 'payment-1', amountMinor: 5000, actorUserId: 'admin-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException for a non-existent payment', async () => {
    const { service } = buildHarness(null);
    await expect(
      service.recordRefund({ paymentId: 'missing', amountMinor: 5000, actorUserId: 'admin-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ManualTransferRefundService.recordRefund — manager path (Chunk B2 prerequisite)', () => {
  function buildManagerHarness(payment: any | null) {
    const recordedEvents: any[] = [];
    const managerPaymentRepository = {
      findOne: jest.fn(async () => (payment ? { ...payment } : null)),
    };
    const manager = {
      getRepository: jest.fn(() => managerPaymentRepository),
    };
    const financialEventService = {
      record: jest.fn(async (params: any, passedManager?: any) => {
        const event = { id: 'event-1', ...params };
        recordedEvents.push({ event, passedManager });
        return event;
      }),
    };
    const injectedPaymentsRepository = { findOne: jest.fn(async () => null), save: jest.fn() };
    const service = new ManualTransferRefundService(
      injectedPaymentsRepository as any,
      financialEventService as any,
      makeLoyaltyServiceMock() as any,
      makeDataSourceMock() as any,
    );
    return { service, manager, managerPaymentRepository, injectedPaymentsRepository, recordedEvents };
  }

  it('CRITICAL: when a manager is supplied, the Payment lookup uses manager.getRepository(Payment), never the injected repository', async () => {
    const { service, manager, injectedPaymentsRepository } = buildManagerHarness({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.PAID,
    });

    await service.recordRefund({ paymentId: 'payment-1', amountMinor: 5000, actorUserId: 'admin-1' }, manager as any);

    expect(manager.getRepository).toHaveBeenCalled();
    expect(injectedPaymentsRepository.findOne).not.toHaveBeenCalled();
  });

  it('CRITICAL: when a manager is supplied, FinancialEventService.record is called WITH that same manager', async () => {
    const { service, manager, recordedEvents } = buildManagerHarness({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.PAID,
    });

    await service.recordRefund({ paymentId: 'payment-1', amountMinor: 5000, actorUserId: 'admin-1' }, manager as any);

    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0].passedManager).toBe(manager);
  });

  it('rejects a not-PAID payment on the manager path too, without ever recording a refund', async () => {
    const { service, manager, recordedEvents } = buildManagerHarness({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.UNDER_REVIEW,
    });

    await expect(
      service.recordRefund({ paymentId: 'payment-1', amountMinor: 5000, actorUserId: 'admin-1' }, manager as any),
    ).rejects.toThrow(BadRequestException);
    expect(recordedEvents).toHaveLength(0);
  });
});

/**
 * PD-002 — partial vendor cancellation refunds. The amount is server-derived from (paid - owed - already refunded),
 * per-segment idempotent, and never recorded for anything but a PAID Manual Transfer.
 */
describe('ManualTransferRefundService — partial cancellation refunds (PD-002)', () => {
  function harness(payment: any | null, existingEvents: any[] = []) {
    const events = [...existingEvents];
    const financialEventService = {
      record: jest.fn(async (params: any) => {
        const e = { id: `event-${events.length + 1}`, ...params };
        events.push(e);
        return e;
      }),
    };
    const manager = {
      getRepository: (Entity: any) => {
        if (Entity.name === 'Payment') {
          const qb: any = { where: () => qb, setLock: () => qb, getOne: async () => (payment ? { ...payment } : null) };
          return { createQueryBuilder: () => qb, findOne: async () => (payment ? { ...payment } : null) };
        }
        return {
          find: async ({ where }: any) => events.filter((e) => e.paymentId === where.paymentId && e.type === where.type),
          findOne: async ({ where }: any) => events.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
        };
      },
    };
    const service = new ManualTransferRefundService({} as any, financialEventService as any, makeLoyaltyServiceMock() as any, makeDataSourceMock() as any);
    return { service, manager, events, financialEventService };
  }
  const paid = { id: 'pay-1', orderId: 'order-1', status: PaymentStatus.PAID, amountMinor: 32500 };
  const params = (owedAfterMinor: number, segmentId = 'seg-B') => ({ orderId: 'order-1', owedAfterMinor, segmentId, actorUserId: 'v1', reason: 'r' });

  it('refunds exactly paid - owed: 32500 paid, 12000 still owed → 20500', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(params(12000), h.manager as any)).resolves.toBe(20500);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      amountMinor: 20500,
      paymentId: 'pay-1',
      orderVendorSegmentId: 'seg-B',
      idempotencyKey: 'manual-transfer-refund:pay-1:segment:seg-B',
      direction: 'PAYABLE',
    });
    expect(h.financialEventService.record).toHaveBeenCalledWith(expect.anything(), h.manager); // same transaction
  });

  it('a second cancellation refunds only the NEW difference (3 → 2 → 1 vendors), never the same money twice', async () => {
    const h = harness({ ...paid, amountMinor: 63000 });
    await expect(h.service.recordRefundForReducedTotal(params(32500, 'C'), h.manager as any)).resolves.toBe(30500);
    await expect(h.service.recordRefundForReducedTotal(params(12000, 'B'), h.manager as any)).resolves.toBe(20500);
    expect(h.events.map((e) => e.amountMinor)).toEqual([30500, 20500]);
    expect(h.events.reduce((s, e) => s + e.amountMinor, 0)).toBe(63000 - 12000);
  });

  it('idempotent: the same segment can never be refunded twice', async () => {
    const h = harness(paid);
    await h.service.recordRefundForReducedTotal(params(12000), h.manager as any);
    await expect(h.service.recordRefundForReducedTotal(params(12000), h.manager as any)).resolves.toBe(0);
    expect(h.events).toHaveLength(1);
  });

  it.each([[PaymentStatus.PENDING], [PaymentStatus.CUSTOMER_CLAIMED_TRANSFER], [PaymentStatus.UNDER_REVIEW], [PaymentStatus.REJECTED]])(
    'a %s payment is never refunded (nothing was verified as paid)',
    async (status) => {
      const h = harness({ ...paid, status });
      await expect(h.service.recordRefundForReducedTotal(params(12000), h.manager as any)).resolves.toBe(0);
      expect(h.events).toHaveLength(0);
    },
  );

  it('COD / PAY_AT_DELIVERY (no Payment row at all) → no refund record, no cash refund', async () => {
    const h = harness(null);
    await expect(h.service.recordRefundForReducedTotal(params(12000), h.manager as any)).resolves.toBe(0);
    expect(h.events).toHaveLength(0);
  });

  it('nothing is refunded when the new total is not below what was paid', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(params(32500), h.manager as any)).resolves.toBe(0);
    await expect(h.service.recordRefundForReducedTotal(params(40000), h.manager as any)).resolves.toBe(0);
  });

  it('the refund can never exceed what was paid (owed can\'t go below 0)', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(params(-5000), h.manager as any)).resolves.toBe(32500);
  });

  describe('recordRemainingRefund (whole-order cancellation)', () => {
    it('no earlier partial refunds → refunds the FULL paid amount under the unchanged whole-payment key', async () => {
      const h = harness(paid);
      await expect(h.service.recordRemainingRefund({ paymentId: 'pay-1', actorUserId: 'a', reason: 'r' }, h.manager as any)).resolves.toBe(32500);
      expect(h.events[0]).toMatchObject({ amountMinor: 32500, idempotencyKey: 'manual-transfer-refund:pay-1' });
    });

    it('after partial refunds → refunds only the remainder, so paid is refunded exactly once in total', async () => {
      const h = harness(paid);
      await h.service.recordRefundForReducedTotal(params(12000), h.manager as any); // 20500 already back
      await expect(h.service.recordRemainingRefund({ paymentId: 'pay-1', actorUserId: 'a', reason: 'r' }, h.manager as any)).resolves.toBe(12000);
      expect(h.events.reduce((s, e) => s + e.amountMinor, 0)).toBe(32500);
    });

    it('already fully refunded → nothing more; a repeat call is a no-op', async () => {
      const h = harness(paid);
      await h.service.recordRemainingRefund({ paymentId: 'pay-1', actorUserId: 'a', reason: 'r' }, h.manager as any);
      await expect(h.service.recordRemainingRefund({ paymentId: 'pay-1', actorUserId: 'a', reason: 'r' }, h.manager as any)).resolves.toBe(0);
      expect(h.events).toHaveLength(1);
    });

    it('an unpaid payment records nothing', async () => {
      const h = harness({ ...paid, status: PaymentStatus.PENDING });
      await expect(h.service.recordRemainingRefund({ paymentId: 'pay-1', actorUserId: 'a', reason: 'r' }, h.manager as any)).resolves.toBe(0);
    });
  });
});

/**
 * PD-004 — pending refund entitlement for a Manual Transfer that is not yet verified.
 * (Real-database lifecycle, including concurrency: test/e2e/63-pending-refund.e2e-spec.ts.)
 */
describe('ManualTransferRefundService — pending refund entitlement (PD-004)', () => {
  function harness(payment: any | null, order: any = { id: 'order-1', status: 'PENDING', totalMinor: 12000 }, existingEvents: any[] = []) {
    const stored = payment ? { pendingRefundMinor: 0, pendingRefundStatus: 'NONE', pendingRefundResolvedAt: null, ...payment } : null;
    const events = [...existingEvents];
    const financialEventService = {
      record: jest.fn(async (params: any) => {
        const existing = events.find((e) => e.idempotencyKey === params.idempotencyKey);
        if (existing) return existing;
        const e = { id: `event-${events.length + 1}`, ...params };
        events.push(e);
        return e;
      }),
    };
    const manager: any = {
      save: jest.fn(async (_E: any, entity: any) => {
        Object.assign(stored, entity);
        return entity;
      }),
      findOne: jest.fn(async () => order),
      getRepository: (Entity: any) => {
        if (Entity.name === 'Payment') {
          const qb: any = { where: () => qb, setLock: () => qb, getOne: async () => (stored ? stored : null) };
          return { createQueryBuilder: () => qb, findOne: async () => stored };
        }
        return {
          find: async ({ where }: any) => events.filter((e) => e.paymentId === where.paymentId && e.type === where.type),
          findOne: async ({ where }: any) => events.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
        };
      },
    };
    return { service: new ManualTransferRefundService({} as any, financialEventService as any, makeLoyaltyServiceMock() as any, makeDataSourceMock() as any), manager, stored, events };
  }
  const base = { id: 'pay-1', orderId: 'order-1', amountMinor: 32500 };
  const reduce = (owedAfterMinor: number, segmentId = 'seg-B') => ({ orderId: 'order-1', owedAfterMinor, segmentId, actorUserId: 'v1', reason: 'r' });

  describe('reconcileReducedTotal (a segment was cancelled)', () => {
    it.each([[PaymentStatus.PENDING], [PaymentStatus.CUSTOMER_CLAIMED_TRANSFER], [PaymentStatus.UNDER_REVIEW]])(
      '%s: records the pending entitlement (paid − owed) and NO refund event; Payment.amountMinor is untouched',
      async (status) => {
        const h = harness({ ...base, status });
        await expect(h.service.reconcileReducedTotal(reduce(12000), h.manager)).resolves.toEqual({ refundedMinor: 0, pendingRefundMinor: 20500 });
        expect(h.stored).toMatchObject({ pendingRefundMinor: 20500, pendingRefundStatus: 'PENDING', amountMinor: 32500, status });
        expect(h.events).toEqual([]);
      },
    );

    it('several cancellations: the entitlement is RE-DERIVED from the final amount owed, never accumulated (3 → 2 → 1 vendors)', async () => {
      const h = harness({ ...base, amountMinor: 63000, status: PaymentStatus.UNDER_REVIEW });
      await h.service.reconcileReducedTotal(reduce(32500, 'C'), h.manager);
      expect(h.stored.pendingRefundMinor).toBe(30500);
      await h.service.reconcileReducedTotal(reduce(12000, 'B'), h.manager);
      expect(h.stored.pendingRefundMinor).toBe(51000); // exactly paid − final owed, not 30500 + 20500 stacked on stale data
      expect(h.events).toEqual([]);
    });

    it('idempotent: repeating the same reconciliation leaves exactly the same entitlement', async () => {
      const h = harness({ ...base, status: PaymentStatus.PENDING });
      await h.service.reconcileReducedTotal(reduce(12000), h.manager);
      await h.service.reconcileReducedTotal(reduce(12000), h.manager);
      expect(h.stored.pendingRefundMinor).toBe(20500);
    });

    it('the entitlement can never exceed what was paid, nor go negative', async () => {
      const h = harness({ ...base, status: PaymentStatus.PENDING });
      await h.service.reconcileReducedTotal(reduce(-999), h.manager);
      expect(h.stored.pendingRefundMinor).toBe(32500);
      await h.service.reconcileReducedTotal(reduce(99999), h.manager);
      expect(h.stored).toMatchObject({ pendingRefundMinor: 0, pendingRefundStatus: 'NONE' });
    });

    it('PAID keeps the existing IMMEDIATE refund behaviour (a real refund event, no entitlement)', async () => {
      const h = harness({ ...base, status: PaymentStatus.PAID });
      await expect(h.service.reconcileReducedTotal(reduce(12000), h.manager)).resolves.toEqual({ refundedMinor: 20500, pendingRefundMinor: 0 });
      expect(h.events).toHaveLength(1);
      expect(h.stored.pendingRefundStatus).toBe('NONE');
    });

    it('REJECTED and COD / PAY_AT_DELIVERY (no payment row): nothing at all', async () => {
      const rejected = harness({ ...base, status: PaymentStatus.REJECTED });
      await expect(rejected.service.reconcileReducedTotal(reduce(12000), rejected.manager)).resolves.toEqual({ refundedMinor: 0, pendingRefundMinor: 0 });
      expect(rejected.stored.pendingRefundStatus).toBe('NONE');
      const none = harness(null);
      await expect(none.service.reconcileReducedTotal(reduce(12000), none.manager)).resolves.toEqual({ refundedMinor: 0, pendingRefundMinor: 0 });
      expect(none.events).toEqual([]);
    });

    it('a payment with no known amount records nothing', async () => {
      const h = harness({ ...base, amountMinor: null, status: PaymentStatus.PENDING });
      await expect(h.service.reconcileReducedTotal(reduce(12000), h.manager)).resolves.toEqual({ refundedMinor: 0, pendingRefundMinor: 0 });
    });
  });

  describe('recordPendingRefundForCancelledOrder (whole order cancelled)', () => {
    it('unverified transfer: the WHOLE amount becomes the entitlement, no event', async () => {
      const h = harness({ ...base, status: PaymentStatus.CUSTOMER_CLAIMED_TRANSFER });
      await expect(h.service.recordPendingRefundForCancelledOrder('order-1', h.manager)).resolves.toBe(32500);
      expect(h.stored).toMatchObject({ pendingRefundMinor: 32500, pendingRefundStatus: 'PENDING' });
      expect(h.events).toEqual([]);
    });

    it.each([[PaymentStatus.PAID], [PaymentStatus.REJECTED]])('%s: nothing', async (status) => {
      const h = harness({ ...base, status });
      await expect(h.service.recordPendingRefundForCancelledOrder('order-1', h.manager)).resolves.toBe(0);
      expect(h.stored.pendingRefundStatus).toBe('NONE');
    });
  });

  describe('convertPendingRefund (transfer verified PAID)', () => {
    const pending = (extra: any = {}) => ({ ...base, status: PaymentStatus.PAID, pendingRefundStatus: 'PENDING', pendingRefundMinor: 20500, ...extra });

    it('converts into exactly ONE refund payable of paid − owed NOW, under the pending-conversion key, and marks it CONVERTED', async () => {
      const h = harness(pending());
      await expect(h.service.convertPendingRefund(h.stored, 'admin-1', h.manager)).resolves.toBe(20500);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]).toMatchObject({
        type: 'MANUAL_TRANSFER_REFUND_RECORDED',
        direction: 'PAYABLE',
        amountMinor: 20500,
        paymentId: 'pay-1',
        idempotencyKey: 'manual-transfer-refund:pay-1:pending-conversion',
        actorUserId: 'admin-1',
      });
      expect(h.stored).toMatchObject({ pendingRefundStatus: 'CONVERTED', pendingRefundMinor: 20500 });
      expect(h.stored.pendingRefundResolvedAt).toBeInstanceOf(Date);
    });

    it('the amount is re-derived from the order, never trusted from the stored entitlement', async () => {
      const h = harness(pending({ pendingRefundMinor: 999999 }), { id: 'order-1', status: 'PENDING', totalMinor: 12000 });
      await h.service.convertPendingRefund(h.stored, 'admin-1', h.manager);
      expect(h.events[0].amountMinor).toBe(20500);
    });

    it('a cancelled order owes nothing: the FULL paid amount is refunded', async () => {
      const h = harness(pending({ pendingRefundMinor: 32500 }), { id: 'order-1', status: 'CANCELLED', totalMinor: 0 });
      await expect(h.service.convertPendingRefund(h.stored, 'admin-1', h.manager)).resolves.toBe(32500);
    });

    it('idempotent: a second conversion is a no-op (terminal state) and never a second event', async () => {
      const h = harness(pending());
      await h.service.convertPendingRefund(h.stored, 'admin-1', h.manager);
      await expect(h.service.convertPendingRefund(h.stored, 'admin-1', h.manager)).resolves.toBe(0);
      expect(h.events).toHaveLength(1);
    });

    it('nothing overpaid any more (the order total came back up): no event, entitlement cleared', async () => {
      const h = harness(pending(), { id: 'order-1', status: 'PENDING', totalMinor: 32500 });
      await expect(h.service.convertPendingRefund(h.stored, 'admin-1', h.manager)).resolves.toBe(0);
      expect(h.events).toEqual([]);
      expect(h.stored).toMatchObject({ pendingRefundStatus: 'NONE', pendingRefundMinor: 0 });
    });

    it('a payment with NO pending entitlement is left alone (an ordinary approval never refunds)', async () => {
      const h = harness({ ...base, status: PaymentStatus.PAID });
      await expect(h.service.convertPendingRefund(h.stored, 'admin-1', h.manager)).resolves.toBe(0);
      expect(h.events).toEqual([]);
    });

    it('an unknown order total is not guessed: the entitlement stays PENDING', async () => {
      const h = harness(pending(), { id: 'order-1', status: 'PENDING', totalMinor: null });
      await expect(h.service.convertPendingRefund(h.stored, 'admin-1', h.manager)).resolves.toBe(0);
      expect(h.stored.pendingRefundStatus).toBe('PENDING');
    });

    it('refunds already recorded for this payment are subtracted (never refunded twice)', async () => {
      const earlier = [{ paymentId: 'pay-1', type: 'MANUAL_TRANSFER_REFUND_RECORDED', amountMinor: 5000, idempotencyKey: 'manual-transfer-refund:pay-1' }];
      const h = harness(pending(), { id: 'order-1', status: 'PENDING', totalMinor: 12000 }, earlier);
      await h.service.convertPendingRefund(h.stored, 'admin-1', h.manager);
      expect(h.events[1].amountMinor).toBe(15500);
    });
  });

  describe('voidPendingRefund (transfer REJECTED)', () => {
    it('voids the entitlement and records NO refund payable', async () => {
      const h = harness({ ...base, status: PaymentStatus.REJECTED, pendingRefundStatus: 'PENDING', pendingRefundMinor: 20500 });
      await h.service.voidPendingRefund(h.stored, h.manager);
      expect(h.stored).toMatchObject({ pendingRefundStatus: 'VOIDED', pendingRefundMinor: 20500 }); // kept for the audit trail
      expect(h.stored.pendingRefundResolvedAt).toBeInstanceOf(Date);
      expect(h.events).toEqual([]);
    });

    it('idempotent and inert when there was no entitlement', async () => {
      const h = harness({ ...base, status: PaymentStatus.REJECTED });
      await h.service.voidPendingRefund(h.stored, h.manager);
      expect(h.stored.pendingRefundStatus).toBe('NONE');
      const again = harness({ ...base, status: PaymentStatus.REJECTED, pendingRefundStatus: 'PENDING', pendingRefundMinor: 1 });
      await again.service.voidPendingRefund(again.stored, again.manager);
      await again.service.voidPendingRefund(again.stored, again.manager);
      expect(again.stored.pendingRefundStatus).toBe('VOIDED');
    });
  });
});

/**
 * WALLET + MANUAL TRANSFER (PD-001). Order total 10000 = wallet 3000 (pays FIRST) + transfer 7000.
 * Refund waterfall: EXTERNAL PAYMENT FIRST → WALLET SECOND. The transfer is compared with what is left owed AFTER the wallet's
 * share (`owed − wallet`), never with the whole order total (that under-refunded the customer by the wallet amount).
 */
describe('ManualTransferRefundService — wallet + Manual Transfer waterfall (PD-001)', () => {
  const W = 3000;
  const E = 7000;

  function harness(payment: any, order: any = { id: 'order-1', status: 'PENDING', totalMinor: 10000, walletAmountMinor: W }, existingEvents: any[] = []) {
    const stored = { pendingRefundMinor: 0, pendingRefundStatus: 'NONE', pendingRefundResolvedAt: null, ...payment };
    const events = [...existingEvents];
    const financialEventService = {
      record: jest.fn(async (params: any) => {
        const existing = events.find((e) => e.idempotencyKey === params.idempotencyKey);
        if (existing) return existing;
        const e = { id: `event-${events.length + 1}`, ...params };
        events.push(e);
        return e;
      }),
    };
    const manager: any = {
      save: jest.fn(async (_E: any, entity: any) => {
        Object.assign(stored, entity);
        return entity;
      }),
      findOne: jest.fn(async () => order),
      getRepository: (Entity: any) => {
        if (Entity.name === 'Payment') {
          const qb: any = { where: () => qb, setLock: () => qb, getOne: async () => stored };
          return { createQueryBuilder: () => qb, findOne: async () => stored };
        }
        if (Entity.name === 'Order') return { findOne: async () => order };
        return {
          find: async ({ where }: any) => events.filter((e) => e.paymentId === where.paymentId && e.type === where.type),
          findOne: async ({ where }: any) => events.find((e) => e.idempotencyKey === where.idempotencyKey) ?? null,
        };
      },
    };
    return { service: new ManualTransferRefundService({} as any, financialEventService as any, makeLoyaltyServiceMock() as any, makeDataSourceMock() as any), manager, stored, events };
  }
  const paid = { id: 'pay-1', orderId: 'order-1', status: PaymentStatus.PAID, amountMinor: E };
  const cancel = (owedAfterMinor: number, segmentId = 'seg-A') => ({ orderId: 'order-1', owedAfterMinor, segmentId, actorUserId: 'v1', reason: 'r' });

  it('externalOwedAfter: the wallet covers the FIRST part of what is owed; the transfer only the rest', () => {
    expect(ManualTransferRefundService.externalOwedAfter(10000, 3000)).toBe(7000);
    expect(ManualTransferRefundService.externalOwedAfter(6000, 3000)).toBe(3000);
    expect(ManualTransferRefundService.externalOwedAfter(2000, 3000)).toBe(0);
    expect(ManualTransferRefundService.externalOwedAfter(0, 3000)).toBe(0);
    expect(ManualTransferRefundService.externalOwedAfter(6000, 0)).toBe(6000); // no wallet: unchanged behaviour
  });

  it('total 100 → 60 owed: 40 goes back through the TRANSFER (the old paid − owed gave 10, keeping 30 of the customer\'s money); wallet refunds 0', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(cancel(6000), h.manager)).resolves.toBe(4000);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ amountMinor: 4000, paymentId: 'pay-1' });
  });

  it('total 100 → 20 owed: the WHOLE transfer (70) is refunded first; the wallet then refunds its 10 (wallet leg: OrderWalletRefundService)', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(cancel(2000), h.manager)).resolves.toBe(7000);
  });

  it('two cancellations 100 → 60 → 20: refunds are cumulative and total exactly the transfer (40 + 30 = 70), never twice', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(cancel(6000, 'seg-A'), h.manager)).resolves.toBe(4000);
    await expect(h.service.recordRefundForReducedTotal(cancel(2000, 'seg-B'), h.manager)).resolves.toBe(3000);
    expect(h.events.reduce((s, e) => s + e.amountMinor, 0)).toBe(E);
    // idempotent per segment
    await expect(h.service.recordRefundForReducedTotal(cancel(2000, 'seg-B'), h.manager)).resolves.toBe(0);
    expect(h.events).toHaveLength(2);
  });

  it('owed still above the wallet share of the transfer (owed 100): nothing to refund', async () => {
    const h = harness(paid);
    await expect(h.service.recordRefundForReducedTotal(cancel(10000), h.manager)).resolves.toBe(0);
  });

  describe('unverified transfer (pending entitlement)', () => {
    const pendingPayment = { id: 'pay-1', orderId: 'order-1', status: PaymentStatus.UNDER_REVIEW, amountMinor: E };

    it('segment cancelled (owed 60): the entitlement is 40 — the transfer minus what the wallet already covers of the owed amount — and never above the transfer', async () => {
      const h = harness(pendingPayment);
      await expect(h.service.reconcileReducedTotal(cancel(6000), h.manager)).resolves.toEqual({ refundedMinor: 0, pendingRefundMinor: 4000 });
      expect(h.stored).toMatchObject({ pendingRefundMinor: 4000, pendingRefundStatus: 'PENDING', amountMinor: E });
      expect(h.events).toEqual([]);
      // owed 20 → the whole transfer
      await expect(h.service.reconcileReducedTotal(cancel(2000, 'seg-B'), h.manager)).resolves.toEqual({ refundedMinor: 0, pendingRefundMinor: 7000 });
    });

    it('whole order cancelled before approval: the entitlement is exactly the transfer (70) — the wallet\'s 30 goes back to the wallet separately', async () => {
      const h = harness(pendingPayment);
      await expect(h.service.recordPendingRefundForCancelledOrder('order-1', h.manager)).resolves.toBe(7000);
      expect(h.stored).toMatchObject({ pendingRefundMinor: 7000, pendingRefundStatus: 'PENDING' });
    });

    it('approved LATER after a cancellation to 60: converts into exactly ONE refund payable of 40, under the pending-conversion key', async () => {
      const h = harness({ ...pendingPayment, status: PaymentStatus.PAID, pendingRefundStatus: 'PENDING', pendingRefundMinor: 4000 }, { id: 'order-1', status: 'PENDING', totalMinor: 6000, walletAmountMinor: W });
      await expect(h.service.convertPendingRefund(h.stored as any, 'admin-1', h.manager)).resolves.toBe(4000);
      expect(h.events).toHaveLength(1);
      expect(h.events[0]).toMatchObject({ amountMinor: 4000, idempotencyKey: 'manual-transfer-refund:pay-1:pending-conversion' });
      await expect(h.service.convertPendingRefund(h.stored as any, 'admin-1', h.manager)).resolves.toBe(0); // terminal: never twice
      expect(h.events).toHaveLength(1);
    });

    it('approved after the order was CANCELLED: the whole transfer (70) is refunded once — never the wallet\'s part', async () => {
      const h = harness({ ...pendingPayment, status: PaymentStatus.PAID, pendingRefundStatus: 'PENDING', pendingRefundMinor: 7000 }, { id: 'order-1', status: 'CANCELLED', totalMinor: 0, walletAmountMinor: W });
      await expect(h.service.convertPendingRefund(h.stored as any, 'admin-1', h.manager)).resolves.toBe(7000);
    });

    it('approved with the order still owing 100: nothing is overpaid → no refund, entitlement cleared', async () => {
      const h = harness({ ...pendingPayment, status: PaymentStatus.PAID, pendingRefundStatus: 'PENDING', pendingRefundMinor: 4000 }, { id: 'order-1', status: 'PENDING', totalMinor: 10000, walletAmountMinor: W });
      await expect(h.service.convertPendingRefund(h.stored as any, 'admin-1', h.manager)).resolves.toBe(0);
      expect(h.events).toEqual([]);
    });

    it('REJECTED transfer: the entitlement is voided and NO refund is ever recorded', async () => {
      const h = harness({ ...pendingPayment, status: PaymentStatus.REJECTED, pendingRefundStatus: 'PENDING', pendingRefundMinor: 4000 });
      await h.service.voidPendingRefund(h.stored as any, h.manager);
      expect(h.stored.pendingRefundStatus).toBe('VOIDED');
      expect(h.events).toEqual([]);
    });
  });
});
