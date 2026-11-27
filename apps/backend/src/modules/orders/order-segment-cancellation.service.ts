import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { DeliveryFeeCalculationService } from '../delivery-fee/delivery-fee-calculation.service';
import { ManualTransferRefundService } from '../payments/manual-transfer-refund.service';
import { OfferConsumptionService } from '../offers/offer-consumption.service';
import { OrderWalletRefundService } from './order-wallet-refund.service';

export interface PartialCancellationResult {
  subtotalMinor: number;
  deliveryFeeMinor: number | null;
  discountMinor: number;
  totalMinor: number | null;
  activeVendorCount: number;
  /** Newly recorded Manual Transfer refund caused by this cancellation (0 = none due / not a paid transfer). */
  refundMinor: number;
  /** The customer's pending refund entitlement on a not-yet-verified transfer after this cancellation (0 = none). */
  pendingRefundMinor: number;
}

/**
 * Financial consequences of a vendor cancelling ITS OWN segment while other vendors' segments stay active
 * (PD-002 / PD-003, approved rules):
 *
 *   subtotal  = sum of the ACTIVE segments' subtotals
 *   discount  = sum of the ACTIVE segments' offer discounts (segment-level + per-item flash-sale)
 *   delivery  = frozen base fee + additionalVendorFee * (activeVendors - 1)   (see DeliveryFeeCalculationService)
 *   total     = subtotal + delivery - discount
 *
 * Everything is derived on the server from amounts already frozen on the order — never from client input — and the
 * whole thing runs on the caller's transaction, under the caller's row lock on the order. The cancelled segment must
 * already be saved as CANCELLED, and at least one other segment must still be active (cancelling the LAST segment is
 * the whole-order cancellation, handled by OrderStateMachineService).
 */
@Injectable()
export class OrderSegmentCancellationService {
  constructor(
    private readonly deliveryFeeCalculationService: DeliveryFeeCalculationService,
    private readonly manualTransferRefundService: ManualTransferRefundService,
    private readonly offerConsumptionService: OfferConsumptionService,
    private readonly orderWalletRefundService: OrderWalletRefundService,
  ) {}

  async applyPartialCancellation(
    manager: EntityManager,
    params: { order: Order; cancelledSegment: OrderVendorSegment; actorUserId: string },
  ): Promise<PartialCancellationResult> {
    const { order, cancelledSegment } = params;

    const segments = await manager.find(OrderVendorSegment, { where: { orderId: order.id }, relations: { items: true } });
    const active = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED);
    const activeCatalog = active.filter((s) => s.groupType === CartGroupType.CATALOG && s.vendorBranchId);

    const subtotalMinor = active.reduce((sum, s) => sum + Number(s.subtotalMinor ?? 0), 0);
    const discountMinor = active.reduce(
      (sum, s) =>
        sum +
        Number(s.offerDiscountAmountMinor ?? 0) +
        (s.items ?? []).reduce((itemSum: number, i: OrderItem) => itemSum + Number(i.offerDiscountAmountMinor ?? 0), 0),
      0,
    );

    let deliveryFeeMinor: number | null = order.deliveryFeeMinor == null ? null : Number(order.deliveryFeeMinor);
    if (deliveryFeeMinor !== null && order.fulfillmentType === FulfillmentType.DELIVERY && activeCatalog.length > 0) {
      deliveryFeeMinor = this.deliveryFeeCalculationService.recalculateForRemainingVendors(
        order.deliveryFeeBreakdownSnapshot,
        activeCatalog.length,
      );
      // Hatly promotions (2026-11-27): the recalculated fee is before promotions — the fee discount stays (never below 0).
      if (deliveryFeeMinor !== null && Number(order.deliveryFeeDiscountMinor ?? 0) > 0) {
        order.deliveryFeeDiscountMinor = Math.min(Number(order.deliveryFeeDiscountMinor), deliveryFeeMinor);
        deliveryFeeMinor -= order.deliveryFeeDiscountMinor;
      }
    }
    // The Hatly item promotion stays, but never more than what is left of the items.
    const promotionMinor = Math.min(Number(order.promotionDiscountMinor ?? 0), Math.max(0, subtotalMinor - discountMinor));
    order.promotionDiscountMinor = promotionMinor;

    // `totalMinor` stays null exactly where it was null (unknown price) — never a fabricated partial total.
    const totalMinor = order.totalMinor == null ? null : subtotalMinor + (deliveryFeeMinor ?? 0) - discountMinor - promotionMinor;

    order.subtotalMinor = subtotalMinor;
    order.discountMinor = discountMinor + promotionMinor;
    order.deliveryFeeMinor = deliveryFeeMinor;
    order.totalMinor = totalMinor;

    // Wallet-paid money goes back to the WALLET: only the excess of what the wallet paid over what is still owed is credited
    // (the wallet keeps paying for the part that stands), and what remains due through the order's own method shrinks with it.
    if (totalMinor !== null) {
      await this.orderWalletRefundService.refundExcess(manager, {
        order,
        owedAfterMinor: totalMinor,
        idempotencyKey: `order-refund:${order.id}:segment:${cancelledSegment.id}`,
        reason: 'Vendor segment cancelled — wallet payment of the amount no longer owed returned to the wallet.',
        actorUserId: params.actorUserId,
      });
      const walletStillPaying = await this.orderWalletRefundService.effectiveWalletPaidMinor(manager, order);
      order.amountDueMinor = Math.max(0, totalMinor - walletStillPaying);
    }
    await manager.save(Order, order);

    // Give back only THIS segment's flash-sale allocation and subtotal-discount / coupon entitlement; the other vendors' allocations
    // stay consumed. (PD-014 supersedes the earlier "SUBTOTAL_DISCOUNT rows are never reversed" rule; the money side is unchanged — the
    // discount already left the order total above, so the refund is computed from the reduced total exactly as before.)
    const cancelledItemIds = (
      cancelledSegment.items ?? (await manager.find(OrderItem, { where: { orderVendorSegmentId: cancelledSegment.id } }))
    ).map((i: OrderItem) => i.id);
    await this.offerConsumptionService.reverseFlashSaleConsumptionForOrder(manager, order.id, cancelledItemIds);
    await this.offerConsumptionService.reverseSubtotalDiscountConsumptionForOrder(manager, order.id, [cancelledSegment.id]);

    let refundMinor = 0;
    let pendingRefundMinor = 0;
    if (totalMinor !== null) {
      // PAID transfer → refund the difference now. Unverified transfer (the customer may already have sent it) → NO refund
      // event yet, only a re-derived pending entitlement that is settled when the transfer is approved or rejected (PD-004).
      // `Payment.amountMinor` (the paid basis) is never rewritten here.
      const reconciled = await this.manualTransferRefundService.reconcileReducedTotal(
        {
          orderId: order.id,
          owedAfterMinor: totalMinor,
          segmentId: cancelledSegment.id,
          actorUserId: params.actorUserId,
          reason: 'Vendor segment cancelled — Manual Transfer refund of the amount no longer owed, recorded automatically.',
        },
        manager,
      );
      refundMinor = reconciled.refundedMinor;
      pendingRefundMinor = reconciled.pendingRefundMinor;
    }

    return { subtotalMinor, deliveryFeeMinor, discountMinor, totalMinor, activeVendorCount: activeCatalog.length, refundMinor, pendingRefundMinor };
  }
}
