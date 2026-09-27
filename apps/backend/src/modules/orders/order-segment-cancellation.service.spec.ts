import { ConflictException } from '@nestjs/common';
import { OrderSegmentCancellationService } from './order-segment-cancellation.service';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { Order } from './entities/order.entity';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { DeliveryFeeCalculationService } from '../delivery-fee/delivery-fee-calculation.service';

/**
 * PD-002/PD-003 arithmetic of a partial vendor cancellation, on a mocked transaction manager. The real formula lives in
 * DeliveryFeeCalculationService (used here for real, not mocked); refunds/flash-sale reversal are asserted as calls.
 * Real-database behaviour is covered end to end in test/e2e/62-partial-cancellation.e2e-spec.ts.
 */
const seg = (id: string, subtotal: number, extra: Partial<any> = {}, items: any[] = []) => ({
  id,
  orderId: 'order-1',
  groupType: CartGroupType.CATALOG,
  vendorBranchId: `branch-${id}`,
  status: OrderVendorSegmentStatus.PENDING,
  subtotalMinor: subtotal,
  offerDiscountAmountMinor: null,
  items,
  ...extra,
});

// Frozen at creation for N vendors: base 2000, +500 per additional vendor.
const breakdown = (vendors: number) => ({
  deliveryFeeMinor: 2000 + 500 * (vendors - 1),
  additionalVendorChargeMinor: 500 * (vendors - 1),
  additionalVendorFeeMinorUsed: 500,
});

function build(params: {
  order: Partial<any>;
  segments: any[];
  payments?: any[];
  refundMinor?: number;
  pendingRefundMinor?: number;
  walletStillPaying?: number;
}) {
  const order: any = {
    id: 'order-1',
    fulfillmentType: FulfillmentType.DELIVERY,
    subtotalMinor: 0,
    discountMinor: 0,
    deliveryFeeMinor: 0,
    totalMinor: 0,
    ...params.order,
  };
  const saved: any[] = [];
  const updates: any[] = [];
  const manager = {
    find: jest.fn(async (EntityClass: any) => (EntityClass === OrderVendorSegment ? params.segments : [])),
    save: jest.fn(async (EntityClass: any, entity: any) => {
      if (EntityClass === Order) saved.push({ ...entity });
      return entity;
    }),
    update: jest.fn(async (_E: any, where: any, set: any) => {
      updates.push({ where, set });
    }),
  };
  const offerConsumptionService = { reverseFlashSaleConsumptionForOrder: jest.fn(async () => undefined) };
  const manualTransferRefundService = {
    reconcileReducedTotal: jest.fn(async () => ({ refundedMinor: params.refundMinor ?? 0, pendingRefundMinor: params.pendingRefundMinor ?? 0 })),
  };
  const walletRefund = { refundExcess: jest.fn(async () => 0), effectiveWalletPaidMinor: jest.fn(async () => params.walletStillPaying ?? 0) };
  const service = new OrderSegmentCancellationService(
    new DeliveryFeeCalculationService({} as any, {} as any),
    manualTransferRefundService as any,
    offerConsumptionService as any,
    walletRefund as any,
  );
  const run = (cancelledId: string) => {
    const cancelledSegment = params.segments.find((s) => s.id === cancelledId);
    cancelledSegment.status = OrderVendorSegmentStatus.CANCELLED;
    return service.applyPartialCancellation(manager as any, { order, cancelledSegment, actorUserId: 'vendor-user' });
  };
  return { run, order, saved, updates, manager, offerConsumptionService, manualTransferRefundService, walletRefund };
}

describe('OrderSegmentCancellationService.applyPartialCancellation', () => {
  it('2 vendors: the cancelled vendor\'s merchandise and exactly ONE additional-vendor fee leave the order', async () => {
    // subtotal 10000 + 20000, fee 2500 (base 2000 + 500), no discount → total 32500
    const h = build({
      order: { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, deliveryFeeBreakdownSnapshot: breakdown(2) },
      segments: [seg('A', 10000), seg('B', 20000)],
    });
    const r = await h.run('B');
    expect(r).toMatchObject({ subtotalMinor: 10000, deliveryFeeMinor: 2000, discountMinor: 0, totalMinor: 12000, activeVendorCount: 1 });
    expect(h.order).toMatchObject({ subtotalMinor: 10000, deliveryFeeMinor: 2000, discountMinor: 0, totalMinor: 12000 });
  });

  it('3 vendors → 2: fee drops from base+2×addl (3000) to base+1×addl (2500)', async () => {
    const h = build({
      order: { subtotalMinor: 60000, deliveryFeeMinor: 3000, totalMinor: 63000, deliveryFeeBreakdownSnapshot: breakdown(3) },
      segments: [seg('A', 10000), seg('B', 20000), seg('C', 30000)],
    });
    const r = await h.run('C');
    expect(r).toMatchObject({ subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, activeVendorCount: 2 });
  });

  it('successive cancellations 3 → 2 → 1 always derive from the original frozen breakdown (3000 → 2500 → 2000)', async () => {
    const segments = [seg('A', 10000), seg('B', 20000), seg('C', 30000)];
    const h = build({
      order: { subtotalMinor: 60000, deliveryFeeMinor: 3000, totalMinor: 63000, deliveryFeeBreakdownSnapshot: breakdown(3) },
      segments,
    });
    expect((await h.run('C')).deliveryFeeMinor).toBe(2500);
    expect((await h.run('B')).deliveryFeeMinor).toBe(2000);
    expect(h.order.totalMinor).toBe(10000 + 2000);
  });

  it('discounts: the cancelled vendor\'s segment discount AND its flash-sale item discounts leave the order; the others stay', async () => {
    const A = seg('A', 10000, { offerDiscountAmountMinor: 1000 }, [{ id: 'iA', offerDiscountAmountMinor: null }]);
    const B = seg('B', 20000, { offerDiscountAmountMinor: 3000 }, [{ id: 'iB', offerDiscountAmountMinor: 500 }]);
    // discount at creation = 1000 + 3000 + 500 = 4500; total = 30000 + 2500 - 4500 = 28000
    const h = build({
      order: { subtotalMinor: 30000, discountMinor: 4500, deliveryFeeMinor: 2500, totalMinor: 28000, deliveryFeeBreakdownSnapshot: breakdown(2) },
      segments: [A, B],
    });
    const r = await h.run('B');
    expect(r).toMatchObject({ subtotalMinor: 10000, discountMinor: 1000, deliveryFeeMinor: 2000, totalMinor: 11000 });
  });

  it('the totals stay internally consistent: total = subtotal + deliveryFee - discount', async () => {
    const h = build({
      order: { subtotalMinor: 60000, discountMinor: 700, deliveryFeeMinor: 3000, totalMinor: 62300, deliveryFeeBreakdownSnapshot: breakdown(3) },
      segments: [seg('A', 10000, { offerDiscountAmountMinor: 200 }), seg('B', 20000), seg('C', 30000, { offerDiscountAmountMinor: 500 })],
    });
    const r = await h.run('A');
    expect(r.totalMinor).toBe(r.subtotalMinor + (r.deliveryFeeMinor ?? 0) - r.discountMinor);
  });

  it('an unknown (null) total stays null — never a fabricated partial total', async () => {
    const h = build({
      order: { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: null, deliveryFeeBreakdownSnapshot: breakdown(2) },
      segments: [seg('A', 10000), seg('B', 20000)],
    });
    const r = await h.run('B');
    expect(r.totalMinor).toBeNull();
    expect(h.manualTransferRefundService.reconcileReducedTotal).not.toHaveBeenCalled();
  });

  it('fails closed when the delivery-fee breakdown was never recorded', async () => {
    const h = build({
      order: { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, deliveryFeeBreakdownSnapshot: null },
      segments: [seg('A', 10000), seg('B', 20000)],
    });
    await expect(h.run('B')).rejects.toBeInstanceOf(ConflictException);
    expect(h.manager.save).not.toHaveBeenCalled();
  });

  it('flash-sale allocation is returned ONLY for the cancelled segment\'s items', async () => {
    const A = seg('A', 10000, {}, [{ id: 'iA' }]);
    const B = seg('B', 20000, {}, [{ id: 'iB1' }, { id: 'iB2' }]);
    const h = build({
      order: { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, deliveryFeeBreakdownSnapshot: breakdown(2) },
      segments: [A, B],
    });
    await h.run('B');
    expect(h.offerConsumptionService.reverseFlashSaleConsumptionForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1', ['iB1', 'iB2']);
  });

  it('refund: the SERVER-derived new total is what the refund service is asked to reconcile against (the client never supplies an amount)', async () => {
    const h = build({
      order: { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, deliveryFeeBreakdownSnapshot: breakdown(2) },
      segments: [seg('A', 10000), seg('B', 20000)],
      refundMinor: 20500,
    });
    const r = await h.run('B');
    expect(h.manualTransferRefundService.reconcileReducedTotal).toHaveBeenCalledWith(
      { orderId: 'order-1', owedAfterMinor: 12000, segmentId: 'B', actorUserId: 'vendor-user', reason: expect.any(String) },
      expect.anything(),
    );
    expect(r.refundMinor).toBe(20500);
  });

  it('an unverified transfer: Payment.amountMinor (what the customer may already have sent) is NEVER rewritten; the pending entitlement is reported back (PD-004)', async () => {
    const h = build({
      order: { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, deliveryFeeBreakdownSnapshot: breakdown(2) },
      segments: [seg('A', 10000), seg('B', 20000)],
      pendingRefundMinor: 20500,
    });
    const r = await h.run('B');
    expect(h.manager.update).not.toHaveBeenCalled(); // no payment write here at all
    expect(r).toMatchObject({ refundMinor: 0, pendingRefundMinor: 20500 });
  });

  it('a PICKUP order keeps its zero fee', async () => {
    const h = build({
      order: { fulfillmentType: FulfillmentType.PICKUP, subtotalMinor: 30000, deliveryFeeMinor: 0, totalMinor: 30000, deliveryFeeBreakdownSnapshot: null },
      segments: [seg('A', 10000), seg('B', 20000)],
    });
    const r = await h.run('B');
    expect(r).toMatchObject({ deliveryFeeMinor: 0, totalMinor: 10000 });
  });
});

describe('OrderSegmentCancellationService — wallet part (PD-006)', () => {
  const pair = () => [seg('A', 10000), seg('B', 20000)];
  const money = { subtotalMinor: 30000, deliveryFeeMinor: 2500, totalMinor: 32500, deliveryFeeBreakdownSnapshot: breakdown(2) };

  it('asks the wallet refund service to return the excess over the NEW total, keyed per cancelled segment, on the same manager', async () => {
    const h = build({ order: { ...money, walletAmountMinor: 32500 }, segments: pair() });
    await h.run('B');
    expect(h.walletRefund.refundExcess).toHaveBeenCalledWith(h.manager, expect.objectContaining({ owedAfterMinor: 12000, idempotencyKey: 'order-refund:order-1:segment:B', actorUserId: 'vendor-user' }));
  });

  it('what is still due through the order\'s own method = new total − what the wallet still pays (never negative)', async () => {
    const partial = build({ order: { ...money, walletAmountMinor: 5000 }, segments: pair(), walletStillPaying: 5000 });
    await partial.run('B');
    expect(partial.order.amountDueMinor).toBe(12000 - 5000);

    const full = build({ order: { ...money, walletAmountMinor: 32500 }, segments: pair(), walletStillPaying: 12000 });
    await full.run('B');
    expect(full.order.amountDueMinor).toBe(0);

    const over = build({ order: { ...money, walletAmountMinor: 32500 }, segments: pair(), walletStillPaying: 99999 });
    await over.run('B');
    expect(over.order.amountDueMinor).toBe(0);
  });

  it('an unknown (null) total never touches the wallet or the amount due', async () => {
    const h = build({ order: { ...money, totalMinor: null, walletAmountMinor: 0, amountDueMinor: null }, segments: pair() });
    await h.run('B');
    expect(h.walletRefund.refundExcess).not.toHaveBeenCalled();
    expect(h.order.amountDueMinor).toBeNull();
  });
});
