import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { OrderVendorSegment } from '../entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from '../order-vendor-segment-status.enum';
import { applyOrderItemAmountDelta } from '../apply-order-item-amount-delta.util';
import { OrderWalletRefundService } from '../order-wallet-refund.service';
import { OfferConsumptionService } from '../../offers/offer-consumption.service';
import { ManualTransferRefundService } from '../../payments/manual-transfer-refund.service';
import { Payment } from '../../payments/entities/payment.entity';
import { PaymentStatus } from '../../payments/payment-status.enum';
import { FinancialEvent } from '../../finance/entities/financial-event.entity';
import { PricingUnit } from '../../products/pricing-unit.enum';
import { CartGroupType } from '../../cart/cart-group-type.enum';
import { ITEM_REMOVAL_ORDER_STATUSES, IsolationCode } from './order-exceptions.types';

const n = (v: unknown): number => (v == null ? 0 : Number(v));

/**
 * The gross amount an item contributes to its segment's subtotal — the same definition the cart and order creation use
 * (`CartPricingService`: unit price incl. options × quantity, or the weighed amount). `null` = unknown, which is never guessed.
 * Only catalogue items qualify: custom and Hatly-Service items are priced by other rules (Vendor/Driver deferred pricing).
 */
export function orderItemGrossAmountMinor(item: OrderItem): number | null {
  if (item.productId == null) return null;
  if (item.pricingUnitSnapshot === PricingUnit.WEIGHT) {
    const amount = item.finalAmountMinor ?? item.estimatedAmountMinor;
    return amount == null ? null : Number(amount);
  }
  if (item.unitPriceMinor == null) return null;
  return Number(item.unitPriceMinor) * item.quantity;
}

export type RemovalOutcome =
  | { ok: true; removedMinor: number; newTotalMinor: number | null; walletRefundedMinor: number; transferRefundedMinor: number; transferPendingRefundMinor: number; flashSaleItemsReversed: number }
  | { ok: false; code: IsolationCode; message: string };

/**
 * "Continue the order without the unavailable item(s)" — the money side (PD-016 C5). It adds NO rule of its own:
 *  - the item's amount leaves the segment and the order through the existing correction path (`applyOrderItemAmountDelta`);
 *  - the delivery fee is untouched (PD-003) and the vendor count does not change, so the additional-vendor charge does not either;
 *  - what the customer paid in advance goes back exactly as for a rejected vendor part: wallet money through `refundExcess`, a Manual
 *    Transfer through `reconcileReducedTotal` (PD-004), cash/pay-at-delivery by a smaller `amountDueMinor`;
 *  - an item-level flash-sale discount leaves with its item (the same release a rejected part triggers);
 *  - commission is recognised later from `segment.subtotalMinor`, so the corrected subtotal flows through without new code.
 * Anything those rules do not resolve is ISOLATED (returned as `{ ok: false }`, nothing written) for a person to decide.
 * Must run inside the caller's transaction with the order and segment rows already locked.
 */
@Injectable()
export class OrderItemRemovalService {
  constructor(
    private readonly walletRefundService: OrderWalletRefundService,
    private readonly transferRefundService: ManualTransferRefundService,
    private readonly offerConsumptionService: OfferConsumptionService,
  ) {}

  async removeItems(
    manager: EntityManager,
    params: { order: Order; segment: OrderVendorSegment; items: OrderItem[]; exceptionId: string; actorUserId: string | null },
  ): Promise<RemovalOutcome> {
    const { order, segment, items, exceptionId } = params;
    const isolate = (code: IsolationCode, message: string): RemovalOutcome => ({ ok: false, code, message });

    if (!ITEM_REMOVAL_ORDER_STATUSES.includes(order.status) || segment.status === OrderVendorSegmentStatus.CANCELLED) {
      return isolate('ORDER_NOT_EDITABLE', 'The order can no longer be changed.');
    }
    if (segment.groupType !== CartGroupType.CATALOG) {
      return isolate('ITEM_AMOUNT_UNKNOWN', 'Only catalogue items of a vendor part can be removed.');
    }

    const amounts = items.map((i) => orderItemGrossAmountMinor(i));
    if (amounts.some((a) => a == null)) return isolate('ITEM_AMOUNT_UNKNOWN', 'The amount of an item is not known, so it is not guessed.');
    const removedGrossMinor = (amounts as number[]).reduce((a, b) => a + b, 0);

    // Never offer "continue" when nothing would be left (PD-016 C5): the order is cancelled through the existing path instead. A vendor part that
    // would end up empty is a rejected part, which has its own approved rules (PD-002) — not decided here.
    const removingIds = new Set(items.map((i) => i.id));
    const segments = await manager.find(OrderVendorSegment, { where: { orderId: order.id } });
    const activeSegmentIds = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED).map((s) => s.id);
    const liveItems = await manager
      .createQueryBuilder(OrderItem, 'item')
      .where('item.order_vendor_segment_id IN (:...ids)', { ids: activeSegmentIds })
      .andWhere('item.removed_at IS NULL')
      .getMany();
    const remainingInSegment = liveItems.filter((i) => i.orderVendorSegmentId === segment.id && !removingIds.has(i.id)).length;
    const remainingInOrder = liveItems.filter((i) => !removingIds.has(i.id)).length;
    if (remainingInOrder === 0) return isolate('ORDER_WOULD_BE_EMPTY', 'Removing these items would leave the order empty; the order has to be cancelled instead.');
    if (remainingInSegment === 0) return isolate('SEGMENT_WOULD_BE_EMPTY', "Removing these items would leave this vendor's part empty; that is a rejected part, which has its own rules.");

    // A segment-level discount or coupon depends on the whole segment's subtotal. No approved rule says how it changes when items leave, and
    // none is invented here.
    if (n(segment.offerDiscountAmountMinor) > 0 || segment.appliedOfferId != null) {
      return isolate('DISCOUNT_RECALCULATION_NOT_DEFINED', 'This vendor part has an order-level discount or coupon; no approved rule recalculates it when items leave.');
    }

    // The Manual Transfer refund event is keyed by (payment, segment): a second reduction on a segment that already produced one would be
    // silently skipped by the existing mechanism. That case is isolated rather than under-refunded.
    const payment = await manager.findOne(Payment, { where: { orderId: order.id } });
    if (payment && payment.status === PaymentStatus.PAID) {
      const key = ManualTransferRefundService.segmentKey(payment.id, segment.id);
      const prior = await manager.getRepository(FinancialEvent).findOne({ where: { idempotencyKey: key } });
      if (prior) return isolate('SECOND_REFUND_ON_SEGMENT_REQUIRES_REVIEW', 'A refund was already recorded for this vendor part; a second reduction needs a person to review it.');
    }

    // ---- apply -----------------------------------------------------------------------------------------------------------------------
    const now = new Date();
    let flashSaleItemsReversed = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.removedAt = now;
      item.removedAmountMinor = amounts[i] as number;
      item.removalExceptionId = exceptionId;
      await manager.save(OrderItem, item);
      await manager.query(`UPDATE order_exception_items SET removed_amount_minor = $3 WHERE exception_id = $1 AND order_item_id = $2`, [exceptionId, item.id, amounts[i]]);
      if (n(item.offerDiscountAmountMinor) > 0) flashSaleItemsReversed++;
    }

    await applyOrderItemAmountDelta(manager, segment, order, -removedGrossMinor);

    // Same recomputation as a rejected part (OrderSegmentCancellationService): the discount of items that remain, the fixed delivery fee, no new formula.
    const stillLive = liveItems.filter((i) => !removingIds.has(i.id));
    const discountMinor =
      segments
        .filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED)
        .reduce((sum, s) => sum + n(s.offerDiscountAmountMinor), 0) + stillLive.reduce((sum, i) => sum + n(i.offerDiscountAmountMinor), 0);
    const deliveryFeeMinor = order.deliveryFeeMinor == null ? 0 : Number(order.deliveryFeeMinor);
    order.discountMinor = discountMinor;
    order.totalMinor = order.totalMinor == null ? null : Number(order.subtotalMinor) + deliveryFeeMinor - discountMinor;

    let walletRefundedMinor = 0;
    let transferRefundedMinor = 0;
    let transferPendingRefundMinor = 0;
    if (order.totalMinor !== null) {
      walletRefundedMinor = await this.walletRefundService.refundExcess(manager, {
        order,
        owedAfterMinor: order.totalMinor,
        idempotencyKey: `order-refund:${order.id}:exception:${exceptionId}`,
        reason: 'Unavailable item removed from the order — wallet payment of the amount no longer owed returned to the wallet.',
        actorUserId: params.actorUserId,
      });
      const walletStillPaying = await this.walletRefundService.effectiveWalletPaidMinor(manager, order);
      order.amountDueMinor = Math.max(0, order.totalMinor - walletStillPaying);
    }
    await manager.save(Order, order);

    if (flashSaleItemsReversed > 0) {
      await this.offerConsumptionService.reverseFlashSaleConsumptionForOrder(
        manager,
        order.id,
        items.filter((i) => n(i.offerDiscountAmountMinor) > 0).map((i) => i.id),
      );
    }

    if (order.totalMinor !== null) {
      const reconciled = await this.transferRefundService.reconcileReducedTotal(
        {
          orderId: order.id,
          owedAfterMinor: order.totalMinor,
          segmentId: segment.id,
          actorUserId: params.actorUserId ?? order.customerId,
          reason: 'Unavailable item removed from the order — Manual Transfer refund of the amount no longer owed, recorded automatically.',
        },
        manager,
      );
      transferRefundedMinor = reconciled.refundedMinor;
      transferPendingRefundMinor = reconciled.pendingRefundMinor;
    }

    return { ok: true, removedMinor: removedGrossMinor, newTotalMinor: order.totalMinor, walletRefundedMinor, transferRefundedMinor, transferPendingRefundMinor, flashSaleItemsReversed };
  }
}

