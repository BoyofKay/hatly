import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderStatus } from './order-status.enum';
import { Role } from '../../common/enums/role.enum';
import { OrderFinancialEventsService } from '../finance/order-financial-events.service';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { PricingUnit } from '../products/pricing-unit.enum';
import { Product } from '../products/entities/product.entity';
import { InventoryMode } from '../products/inventory-mode.enum';
import { BestSellingCacheService } from '../discovery/best-selling-cache.service';
import { Payment } from '../payments/entities/payment.entity';
import { Delivery } from '../delivery/entities/delivery.entity';
import { Driver } from '../delivery/entities/driver.entity';
import { restoreTrackedInventoryForSegments } from './tracked-inventory.util';
import { PaymentStatus } from '../payments/payment-status.enum';
import { ManualTransferRefundService } from '../payments/manual-transfer-refund.service';
import { PushNotificationService } from '../notifications/push-notification.service';
import { OrderPaymentGateService } from './order-payment-gate.service';
import { CUSTOMER_CANCELLABLE_ORDER_STATUSES } from './customer-cancellation-rule';
import { OrderStatusHistoryService } from './order-status-history.service';
import { OrderWalletRefundService } from './order-wallet-refund.service';
import { OfferConsumptionService } from '../offers/offer-consumption.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RequestContextService } from '../../common/request-context/request-context.service';
import { logBusinessEvent } from '../../common/logging/log-business-event';
import { BusinessEvent } from '../../common/logging/business-events';

/**
 * The order state machine.
 *
 * This is the ONLY place in the codebase permitted to change
 * `Order.status`. Controllers/other services must call
 * `transition()` — never assign `order.status = ...` directly.
 *
 * Rules encoded here:
 *  - Transitions are explicit and role-gated (spec section 12).
 *  - The server is the sole source of truth; the client only ever
 *    requests a transition, it never supplies the resulting state.
 *  - Every transition happens inside a DB transaction with a row lock
 *    on the order, so two concurrent requests (e.g. vendor accepts +
 *    customer cancels at the same instant) can't race each other.
 */

type TransitionRule = {
  from: OrderStatus;
  to: OrderStatus;
  allowedRoles: Role[];
};

const TRANSITIONS: TransitionRule[] = [
  // PHASE 4 DISPATCH CHANGE: Role.VENDOR/VENDOR_MANAGER removed from
  // the three "advance" transitions below (PENDING→CONFIRMED,
  // CONFIRMED→PREPARING, PREPARING→READY_FOR_PICKUP). Confirmed
  // technical defect found in the Phase D design review: these
  // Order-level transitions were a Phase 1 leftover from before the
  // Multi-Vendor segment model existed, and remained live and
  // completely unprotected (no ownership check) even after Phase B
  // built the correct, ownership-checked segment-level path
  // (OrderVendorSegmentStateMachineService) — any vendor could still
  // bypass the whole segment model via this generic endpoint. Vendor
  // accept/prepare/ready actions now exclusively use the segment-level
  // flow; these three transitions are SYSTEM-ONLY (Role.ADMIN),
  // matching the exact convention already established for
  // READY_FOR_PICKUP→ASSIGNED_TO_DRIVER below ("system/assignment
  // service also uses this") — OrderReadinessService (Phase 4) calls
  // these with actorRole=ADMIN once all segments are ready, never a
  // real vendor request.
  { from: OrderStatus.PENDING, to: OrderStatus.CONFIRMED, allowedRoles: [Role.ADMIN] },
  // PHASE 3 STEP 4 CHANGE: Role.CUSTOMER removed from this transition.
  // Confirmed business rule: a customer cannot self-cancel a submitted
  // order — cancellation goes through Support, who acts via ADMIN (or
  // the vendor, for their own segment's portion) using this same
  // transition. No new cancellation-request subsystem was introduced,
  // per the approved instruction — this one-line removal is the whole
  // change.
  { from: OrderStatus.PENDING, to: OrderStatus.CANCELLED, allowedRoles: [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN] },

  { from: OrderStatus.CONFIRMED, to: OrderStatus.PREPARING, allowedRoles: [Role.ADMIN] },
  { from: OrderStatus.CONFIRMED, to: OrderStatus.CANCELLED, allowedRoles: [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN] },

  { from: OrderStatus.PREPARING, to: OrderStatus.READY_FOR_PICKUP, allowedRoles: [Role.ADMIN] },
  { from: OrderStatus.PREPARING, to: OrderStatus.CANCELLED, allowedRoles: [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN] },

  { from: OrderStatus.READY_FOR_PICKUP, to: OrderStatus.ASSIGNED_TO_DRIVER, allowedRoles: [Role.ADMIN, Role.SUPER_ADMIN] }, // system/assignment service also uses this
  // CONFIRMED BUSINESS DECISION: Vendor/Vendor Manager may cancel an
  // order at READY_FOR_PICKUP too — previously ADMIN-only at this one
  // stage, an asymmetry with every earlier stage (PENDING/CONFIRMED/
  // PREPARING already permit VENDOR/VENDOR_MANAGER). This is the only
  // transition changed by that decision — the ASSIGNED_TO_DRIVER
  // transition directly below is untouched (dispatch/assignment
  // authority is a separate concern from cancellation authority).
  { from: OrderStatus.READY_FOR_PICKUP, to: OrderStatus.CANCELLED, allowedRoles: [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN] },

  { from: OrderStatus.ASSIGNED_TO_DRIVER, to: OrderStatus.PICKED_UP, allowedRoles: [Role.DRIVER] },
  { from: OrderStatus.ASSIGNED_TO_DRIVER, to: OrderStatus.READY_FOR_PICKUP, allowedRoles: [Role.DRIVER, Role.ADMIN] }, // driver rejects / reassignment

  { from: OrderStatus.PICKED_UP, to: OrderStatus.ON_THE_WAY, allowedRoles: [Role.DRIVER] },
  // PHASE F addition. CONFIRMED: FAILED_DELIVERY is distinct from
  // CANCELLED. Permitted from the two stages where a driver physically
  // holds the order (PICKED_UP, ON_THE_WAY) — a technical choice of
  // WHICH states can reach it (not specified in the approved rules),
  // flagged here rather than silently assumed. Terminal — no
  // transition is defined out of FAILED_DELIVERY, same shape as
  // DELIVERED/CANCELLED.
  { from: OrderStatus.PICKED_UP, to: OrderStatus.FAILED_DELIVERY, allowedRoles: [Role.DRIVER, Role.ADMIN] },
  { from: OrderStatus.ON_THE_WAY, to: OrderStatus.FAILED_DELIVERY, allowedRoles: [Role.DRIVER, Role.ADMIN] },

  { from: OrderStatus.ON_THE_WAY, to: OrderStatus.DELIVERED, allowedRoles: [Role.DRIVER] },
];

/**
 * SUPER_ADMIN is a strict superset of ADMIN everywhere else in the system (PermissionsGuard
 * bypasses every permission for it). The transition table lists ADMIN for the operational
 * transitions but only named SUPER_ADMIN once (READY_FOR_PICKUP→ASSIGNED_TO_DRIVER), so the most
 * privileged role was refused ("Role SUPER_ADMIN is not allowed to perform this transition")
 * for an order cancellation that any ADMIN could perform — found by the Group 8 journeys.
 */
function roleMayUseRule(rule: TransitionRule, role: Role): boolean {
  return rule.allowedRoles.includes(role) || (role === Role.SUPER_ADMIN && rule.allowedRoles.includes(Role.ADMIN));
}

/**
 * Approved customer-cancellation rule (PD-005): a customer may cancel their own order only while it is PENDING or
 * CONFIRMED — never once it is PREPARING or later.
 */
export const CUSTOMER_CANCELLABLE_STATUSES = CUSTOMER_CANCELLABLE_ORDER_STATUSES;

export type OrderTransitionParams = {
    orderId: string;
    /**
     * Set ONLY by CustomerOrderCancellationService. The customer role has no rule in TRANSITIONS, so a customer can never
     * move an order through the generic `PATCH /orders/:id/status`; this flag is the one door, and it opens only for
     * PENDING/CONFIRMED → CANCELLED (re-checked here, under the order lock, as the last line of defence).
     */
    customerCancellation?: boolean;
    to: OrderStatus;
    actorRole: Role;
    cancellationReason?: string;
    /**
     * Atomic Manual Transfer Refund on Order Cancellation (Chunk B2).
     * Optional and purely additive — every pre-existing caller that
     * omits it (e.g. `transitionIfPossible`'s own internal retry path)
     * continues to work exactly as before. The ONLY current use is as
     * the refund event's real actor identity when a PAID Manual
     * Transfer must be refunded during cancellation — CONFIRMED never
     * a fake/system actor, since it's threaded straight from the
     * already-authenticated user who triggered this transition
     * (`orders.controller.ts`'s own `@CurrentUser()`), not invented
     * here.
     */
    actorUserId?: string;
    /**
     * Failed Delivery Metadata (Chunk 1). Optional and purely additive
     * — every existing caller that omits it continues to work exactly
     * as before. Only meaningful when `to === FAILED_DELIVERY`; stored
     * as `null` when omitted, never validated/required here.
     */
    failureReason?: string;
  };

@Injectable()
export class OrderStateMachineService {
  private readonly logger = new Logger(OrderStateMachineService.name);

  constructor(
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly dataSource: DataSource,
    private readonly orderFinancialEventsService: OrderFinancialEventsService,
    private readonly bestSellingCacheService: BestSellingCacheService,
    private readonly offerConsumptionService: OfferConsumptionService,
    private readonly loyaltyService: LoyaltyService,
    private readonly manualTransferRefundService: ManualTransferRefundService,
    // Customer Push Notifications (Chunk A).
    private readonly pushNotificationService: PushNotificationService,
    private readonly requestContextService: RequestContextService,
    private readonly orderPaymentGateService: OrderPaymentGateService,
    private readonly orderStatusHistoryService: OrderStatusHistoryService,
    private readonly orderWalletRefundService: OrderWalletRefundService,
  ) {}

  /**
   * Runs the transition in its own transaction, then the post-commit side effects (business log, financial events,
   * best-selling cache, push notification).
   */
  async transition(params: OrderTransitionParams): Promise<Order> {
    let applied: { order: Order; fromStatus: OrderStatus } | undefined;
    await this.dataSource.transaction(async (manager) => {
      applied = await this.applyTransition(manager, params);
    });
    await this.runAfterCommit(applied!.order, applied!.fromStatus, params);
    return applied!.order;
  }

  /**
   * Same transition, but on a transaction the CALLER owns (used when cancelling the last vendor segment must cancel
   * the order atomically with it). Nothing is emitted here: the caller MUST invoke `afterCommit()` once its
   * transaction has committed — and never if it rolled back.
   */
  async transitionInTransaction(
    manager: EntityManager,
    params: OrderTransitionParams,
  ): Promise<{ order: Order; afterCommit: () => Promise<void> }> {
    const applied = await this.applyTransition(manager, params);
    return { order: applied.order, afterCommit: () => this.runAfterCommit(applied.order, applied.fromStatus, params) };
  }

  private async applyTransition(
    manager: EntityManager,
    params: OrderTransitionParams,
  ): Promise<{ order: Order; fromStatus: OrderStatus }> {
    let fromStatus: OrderStatus | undefined;
    // Row-level lock: any concurrent transition attempt on this order
    // blocks here until this transaction commits or rolls back.
    const order = await manager.findOne(Order, {
      where: { id: params.orderId },
      lock: { mode: 'pessimistic_write' },
    });

    if (!order) {
      throw new NotFoundException('Order not found.');
    }

    const rule = TRANSITIONS.find(
      (t) => t.from === order.status && t.to === params.to,
    );

    if (!rule) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${params.to}.`,
      );
    }

    const customerMayCancel =
      params.customerCancellation === true &&
      params.actorRole === Role.CUSTOMER &&
      params.to === OrderStatus.CANCELLED &&
      CUSTOMER_CANCELLABLE_STATUSES.includes(order.status);

    if (!roleMayUseRule(rule, params.actorRole) && !customerMayCancel) {
      throw new BadRequestException(
        `Role ${params.actorRole} is not allowed to perform this transition.`,
      );
    }

    // PAYMENT GATING (PD-006): a MANUAL_TRANSFER order cannot be prepared or dispatched before its payment is approved. Enforced
    // here, under the order lock, so no client (app, vendor, admin, dispatch) can bypass it.
    if (params.to === OrderStatus.PREPARING || params.to === OrderStatus.ASSIGNED_TO_DRIVER) {
      await this.orderPaymentGateService.assertFulfilmentMayProceed(manager, order);
    }

    // PHASE G addition (Weighted Products, decision 10 — CLOSED, do
    // not reopen): actual weight must be recorded "before the order
    // is finally treated as picked up." Gated here, inside the same
    // locked transaction, so no concurrent path can slip past it.
    // Only WEIGHT items are checked — a PIECE item (pricingUnitSnapshot
    // null or PIECE) is never blocked. Non-cancelled segments only —
    // a cancelled segment's items were never going to be picked up.
    if (params.to === OrderStatus.PICKED_UP) {
      const segments = await manager.find(OrderVendorSegment, { where: { orderId: order.id } });
      const activeSegmentIds = segments
        .filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED)
        .map((s) => s.id);

      if (activeSegmentIds.length > 0) {
        const items = await manager
          .createQueryBuilder(OrderItem, 'item')
          .where('item.order_vendor_segment_id IN (:...segmentIds)', { segmentIds: activeSegmentIds })
          .getMany();

        const missingWeight = items.some(
          (i) => i.pricingUnitSnapshot === PricingUnit.WEIGHT && i.actualWeightGrams == null,
        );
        if (missingWeight) {
          throw new BadRequestException({
            message:
              'All weighed items must have their actual weight recorded before the order can be marked picked up.',
            details: { code: 'WEIGHT_NOT_RECORDED' },
          });
        }
      }
    }

    fromStatus = order.status;
    order.status = params.to;

    // Failed Delivery Metadata (Chunk 1). CONFIRMED per the approved
    // Design Review: FAILED_DELIVERY uses a controlled Admin-
    // resolution model, not automatic reversal — this block is
    // deliberately ONLY metadata (why/when), with no inventory
    // restoration, no Flash Sale reversal, no Manual Transfer
    // refund, no Wallet/Loyalty side effect, no financial event.
    // `failedAt` is always `new Date()` — the actual transition-
    // execution time, never a client-supplied value.
    if (params.to === OrderStatus.FAILED_DELIVERY) {
      order.failureReason = params.failureReason ?? null;
      order.failedAt = new Date();
    }

    if (params.to === OrderStatus.CANCELLED) {
      order.cancellationReason = params.cancellationReason ?? null;
      order.cancelledByRole = params.actorRole;

      // Inventory Restoration on Order Cancellation. Inside this
      // SAME locked transaction — CONFIRMED, same atomic boundary as
      // everything else in this CANCELLED block; no second/eventually-
      // consistent job introduced. Runs BEFORE the Flash Sale
      // reversal below, matching the approved ordering, though the
      // two are independent of each other (inventory vs. promotional
      // allocation are separate systems, same as the decrement side).
      await this.restoreTrackedInventory(manager, order.id);

      // Atomic Manual Transfer Refund on Order Cancellation (Chunk
      // B2). Inside this SAME locked transaction — CONFIRMED, both
      // the Payment lookup and the resulting FinancialEvent write go
      // through `manager` (via Chunk B1's additive
      // FinancialEventService.record(params, manager) and this
      // chunk's equally additive ManualTransferRefundService.
      // recordRefund(params, manager)) — never a second, independent
      // transaction. Refund amount is ALWAYS `Payment.amountMinor`
      // (the amount actually transferred and Admin-verified), NEVER
      // `Order.totalMinor` — CONFIRMED intentional even when a
      // Custom Request's later-recorded price has since grown the
      // Order's total, since that growth was never collected via
      // this Manual Transfer at all. No new business rule is
      // introduced by this check — a PAID payment with
      // `hasPendingAdHocPricing = true` was already possible before
      // this chunk (Manual Transfer approval never enforced pricing
      // completion); this chunk only decides what to refund, not
      // when a transfer may be marked PAID.
      const manualTransferPayment = await manager.getRepository(Payment).findOne({ where: { orderId: order.id } });
      // amountMinor can still be null here (PAID never backfills it —
      // see Payment.amountMinor's own comment): skip the automatic
      // refund rather than fabricating an amount, same "never invent a
      // number" discipline used everywhere else in this codebase.
      //
      // PD-002: earlier PARTIAL vendor cancellations may already have refunded part of the payment (one refund event
      // per cancelled segment). The whole-order refund is therefore "what was paid, minus what was already
      // refunded" — the full paid amount when there were no partial refunds (exactly the previous behaviour), the
      // remainder otherwise — so the customer is never refunded the same money twice.
      if (
        manualTransferPayment &&
        manualTransferPayment.status === PaymentStatus.PAID &&
        manualTransferPayment.amountMinor != null
      ) {
        await this.manualTransferRefundService.recordRemainingRefund(
          {
            paymentId: manualTransferPayment.id,
            actorUserId: params.actorUserId ?? params.actorRole,
            reason: 'Order cancelled — Manual Transfer refund recorded automatically.',
          },
          manager,
        );
      }
      // PD-004: a transfer nobody has verified yet (PENDING / CLAIMED / UNDER_REVIEW) may still be approved — the customer
      // may already have sent the money. No refund event now; the WHOLE amount becomes the customer's pending refund
      // entitlement, settled when the transfer is approved (→ refund) or rejected (→ nothing).
      else if (
        manualTransferPayment &&
        manualTransferPayment.status !== PaymentStatus.PAID &&
        manualTransferPayment.status !== PaymentStatus.REJECTED
      ) {
        await this.manualTransferRefundService.recordPendingRefundForCancelledOrder(order.id, manager);
      }

      // Wallet-paid money goes back to the WALLET (one idempotent ORDER_REFUND credit; PAID transfers refund as above).
      await this.orderWalletRefundService.refundExcess(manager, {
        order,
        owedAfterMinor: 0,
        idempotencyKey: `order-refund:${order.id}:cancel`,
        reason: 'Order cancelled — wallet payment returned to the wallet.',
        actorUserId: params.actorUserId ?? null,
      });

      // PD-002: once the whole order is cancelled nothing is owed any more — the delivery fee is 0 and the order's
      // effective totals are zeroed, so `total = subtotal + deliveryFee - discount` still holds. (Segments and items
      // keep their own frozen amounts as the historical record, and Payment.amountMinor stays the amount paid.)
      order.subtotalMinor = 0;
      order.discountMinor = 0;
      order.deliveryFeeMinor = order.deliveryFeeMinor == null ? null : 0;
      order.totalMinor = order.totalMinor == null ? null : 0;
      order.amountDueMinor = order.amountDueMinor == null ? null : 0;

      // Offers Final System — Flash Sale cancellation reversal
      // (FINAL approved rule). Inside this SAME locked transaction —
      // CONFIRMED "transaction-safe," no second transaction
      // introduced. Reuses the existing state machine's own
      // CANCELLED transition as the trigger, per the explicit
      // instruction not to invent a new cancellation state.
      await this.offerConsumptionService.reverseFlashSaleConsumptionForOrder(manager, order.id);
    }

    // Loyalty Earning (Chunk C). Inside this SAME locked transaction
    // — CONFIRMED, unlike BestSellingCacheService/
    // OrderFinancialEventsService's own "outside, logged not
    // re-thrown" convention below: Loyalty earning is itself a real
    // financial ledger write, so it must commit together with the
    // DELIVERED status change or not exist at all. See
    // LoyaltyService.awardOrderEarning's own comment for the full
    // eligible-spending calculation and duplicate-earning
    // protection.
    if (params.to === OrderStatus.DELIVERED) {
      await this.loyaltyService.awardOrderEarning(manager, order.id);
    }

    // The delivery's own timestamps (exposed to the driver app as pickedUpAt/deliveredAt) were
    // never written by anything, so they stayed null for every delivery — found by the Group 8
    // journeys. Recorded in the same transaction as the status change; an order with no
    // delivery row (e.g. an admin-moved order) simply matches zero rows.
    if (params.to === OrderStatus.PICKED_UP || params.to === OrderStatus.DELIVERED) {
      await manager
        .createQueryBuilder()
        .update(Delivery)
        .set(params.to === OrderStatus.PICKED_UP ? { pickedUpAt: new Date() } : { deliveredAt: new Date() })
        .where('order_id = :orderId', { orderId: order.id })
        .execute();
    }

    // Assignment marks the driver unavailable (DeliveryAssignmentService) but nothing ever marked
    // them available again, so after ONE delivery a driver could never be dispatched again — the
    // second order of the day sat at READY_FOR_PICKUP forever (found by the Group 8 journeys).
    // A driver is single-delivery today (vehicle_types.max_active_deliveries is not read anywhere),
    // so they are free again as soon as their delivery ends or is handed back.
    const releasesDriver =
      params.to === OrderStatus.DELIVERED ||
      params.to === OrderStatus.FAILED_DELIVERY ||
      params.to === OrderStatus.CANCELLED ||
      (fromStatus === OrderStatus.ASSIGNED_TO_DRIVER && params.to === OrderStatus.READY_FOR_PICKUP);
    if (releasesDriver) {
      await manager
        .createQueryBuilder()
        .update(Driver)
        .set({ isAvailable: true })
        .where('id IN (SELECT driver_id FROM deliveries WHERE order_id = :orderId)', { orderId: order.id })
        .execute();
    }

    const saved = await manager.save(order);
    // The timeline row is written in the SAME transaction as the status change, so history can never disagree with the status.
    await this.orderStatusHistoryService.record(manager, {
      orderId: order.id,
      from: fromStatus!,
      to: params.to,
      actorRole: params.actorRole,
      actorUserId: params.actorUserId ?? null,
    });
    return { order: saved, fromStatus: fromStatus! };
  }

  private async runAfterCommit(updatedOrder: Order, fromStatus: OrderStatus, params: OrderTransitionParams): Promise<void> {
    // Business-event log (Group 4). Fired ONLY after the status-change
    // transaction above has actually committed — `updatedOrder` at this
    // point reflects real, durable state, never a value that could
    // still be rolled back. This is the single chokepoint for every
    // `Order.status` write in the codebase, so it's also the single
    // place a `order.state_transition` event is ever emitted — no
    // duplicate logging at any of this method's many callers.
    // Ordinary rejected-transition attempts (invalid rule, wrong role,
    // WEIGHT_NOT_RECORDED, etc.) are deliberately NOT logged as a
    // business event here — they never reach this line at all (the
    // transaction throws first), and they're already visible via the
    // standard HTTP 4xx request log (LoggingInterceptor) without adding
    // ERROR-level noise for routine business rejections.
    logBusinessEvent(this.logger, 'log', BusinessEvent.ORDER_STATE_TRANSITION, () => this.requestContextService.getCorrelationId(), {
      orderId: updatedOrder.id,
      from: fromStatus,
      to: params.to,
      actorRole: params.actorRole,
      actorUserId: params.actorUserId ?? null,
    });

    // Outside the status-change transaction, deliberately — the
    // status change above has already committed and succeeded
    // regardless of what happens next. Financial-event recognition is
    // a separate, system-driven concern with its own idempotency
    // (FinancialEventService.record()) — never allowed to roll back
    // the actual status transition. Mirrors the established pattern
    // from OrderVendorSegmentStateMachineService's post-transition
    // readiness/dispatch hook (Phase D).
    //
    // PHASE F CORRECTION (handoff review): the try/catch below is
    // required, not optional — without it, a failure inside
    // handleTransition() (e.g. a transient DB error while writing a
    // FinancialEvent) would propagate out of transition() itself,
    // meaning the CALLER (e.g. a driver marking an order picked up)
    // would receive an error response for an action that had, in
    // fact, already succeeded. That contradicted the documented
    // contract ("financial-event recognition must never block the
    // actual status transition") even though it never rolled back the
    // DB write. Logged, never re-thrown — mirrors the existing
    // GoogleMapsProvider.logger.error() convention. Nothing is lost:
    // a later successful call recognizes exactly what this one would
    // have, never a duplicate, thanks to that same idempotency.
    try {
      await this.orderFinancialEventsService.handleTransition(updatedOrder, params.to);
    } catch (error) {
      this.logger.error(
        `Financial event recognition failed for order ${params.orderId} (status now ${params.to}): ${(error as Error).message}`,
      );
    }

    // PHASE G addition (Discovery & Ranking — Best Selling). Same
    // "outside the transaction, logged not re-thrown" convention as
    // the financial-event call directly above — a derived cache
    // update must never block or roll back the driver's actual
    // DELIVERED action. See BestSellingCacheService's own comment for
    // why this is guaranteed to run at most once per order.
    if (params.to === OrderStatus.DELIVERED) {
      try {
        await this.bestSellingCacheService.recordDeliveredSales(updatedOrder.id);
      } catch (error) {
        this.logger.error(
          `Best Selling cache update failed for order ${params.orderId}: ${(error as Error).message}`,
        );
      }
    }

    // Customer Push Notifications (Chunk A). Same "outside the
    // transaction, logged not re-thrown" convention as the two hooks
    // directly above — the status change has already committed
    // regardless of what happens here. PushNotificationService's own
    // methods already never rethrow (see that service's own
    // comments), so this try/catch is an extra, deliberate layer of
    // safety, not a substitute for it. Only the five approved MVP
    // events (Product Scope Review) trigger a send; every other
    // transition (PREPARING, READY_FOR_PICKUP, ASSIGNED_TO_DRIVER,
    // PICKED_UP, and the ASSIGNED_TO_DRIVER→READY_FOR_PICKUP
    // reassignment/reversion) intentionally sends nothing.
    try {
      switch (params.to) {
        case OrderStatus.CONFIRMED:
          await this.pushNotificationService.sendOrderConfirmedNotification(
            updatedOrder.customerId,
            updatedOrder.id,
          );
          break;
        case OrderStatus.CANCELLED:
          await this.pushNotificationService.sendOrderCancelledNotification(
            updatedOrder.customerId,
            updatedOrder.id,
          );
          break;
        case OrderStatus.ON_THE_WAY:
          await this.pushNotificationService.sendOrderOnTheWayNotification(
            updatedOrder.customerId,
            updatedOrder.id,
          );
          break;
        case OrderStatus.DELIVERED:
          await this.pushNotificationService.sendOrderDeliveredNotification(
            updatedOrder.customerId,
            updatedOrder.id,
          );
          break;
        case OrderStatus.FAILED_DELIVERY:
          await this.pushNotificationService.sendOrderFailedDeliveryNotification(
            updatedOrder.customerId,
            updatedOrder.id,
          );
          break;
        default:
          break;
      }
    } catch (error) {
      this.logger.error(
        `Customer push notification failed for order ${params.orderId} (status now ${params.to}): ${(error as Error).message}`,
      );
    }

  }

  /** Exposed for UI hints (e.g. which action buttons to show) — never used to bypass the transition() check itself. */
  getAllowedNextStatuses(current: OrderStatus, role: Role): OrderStatus[] {
    return TRANSITIONS.filter((t) => t.from === current && roleMayUseRule(t, role)).map(
      (t) => t.to,
    );
  }

  /**
   * PHASE 4 addition. A non-throwing variant of transition() — returns
   * the current Order (unchanged) instead of throwing when the rule
   * doesn't match, i.e. the order isn't at the expected `from` status.
   * Exists specifically for OrderReadinessService, which needs to
   * attempt a sequential chain of system-driven transitions without
   * knowing in advance which one the order currently needs (and must
   * stay safe/idempotent if called again after an earlier call already
   * advanced the order — a real possibility when multiple segments
   * reach READY_FOR_PICKUP near-simultaneously). Uses the exact same
   * transition() method underneath — no duplicated locking/rule logic.
   */
  async transitionIfPossible(params: {
    orderId: string;
    to: OrderStatus;
    actorRole: Role;
  }): Promise<Order | null> {
    try {
      return await this.transition(params);
    } catch (error) {
      if (error instanceof BadRequestException) {
        const order = await this.ordersRepository.findOne({ where: { id: params.orderId } });
        return order ?? null;
      }
      throw error;
    }
  }

  /**
   * Inventory Restoration on Order Cancellation. Restores TRACKED
   * catalog inventory decremented at order creation
   * (`OrderCreationService.enforceAndDecrementInventory`) — the exact
   * mirror-image atomic update, never a read-modify-write. Uses the
   * SAME `requestedAmount` formula that method used to decrement in
   * the first place (`requestedWeightGrams` for a WEIGHT item,
   * `quantity` for a PIECE item) — CONFIRMED this is the exact
   * quantity that was actually decremented, since `OrderItem.
   * requestedWeightGrams`/`quantity`/`pricingUnitSnapshot` are frozen
   * snapshots taken at that same order-creation moment, never
   * recalculated from `actualWeightGrams`/`finalAmountMinor` (which
   * reflect a LATER, separate weighing event that never affected the
   * original decrement).
   *
   * Custom items (`productId === null`) are skipped entirely — never
   * inferred from freeTextDescription/imageUrls/actualAmountMinor/
   * AdHocPurchaseRecord, since none of those ever affected inventory
   * in the first place.
   *
   * Checks the product's CURRENT `inventoryMode === TRACKED` before
   * restoring — the same live condition
   * `enforceAndDecrementInventory` itself checks (symmetric
   * behavior: whatever the live inventory-mode check permits on the
   * way in is exactly what's checked on the way back out).
   *
   * IDEMPOTENCY: relies entirely on the existing state-machine
   * guarantee — CONFIRMED, no new column/migration. This method is
   * only ever reached from inside the CANCELLED block of
   * `transition()`, which itself only runs after the Order row is
   * locked (`pessimistic_write`) AND a valid transition rule is found
   * in `ORDER_TRANSITIONS`. No rule exists with `from: CANCELLED`
   * anywhere in that table, so a second attempt to cancel an
   * already-CANCELLED order (concurrent or retried) fails the rule
   * lookup and throws `BadRequestException` before this method is
   * ever called a second time for the same order — the row lock
   * ensures a concurrent second attempt blocks until the first
   * commits, then observes the already-CANCELLED status and fails
   * the same way.
   */
  private async restoreTrackedInventory(manager: EntityManager, orderId: string): Promise<void> {
    const segments = await manager.find(OrderVendorSegment, { where: { orderId } });
    // A segment the vendor already cancelled on its own had its stock restored at that moment
    // (OrderVendorSegmentStateMachineService); restoring it again here would double-count.
    const segmentIds = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED).map((s) => s.id);
    await restoreTrackedInventoryForSegments(manager, segmentIds);
  }
}
