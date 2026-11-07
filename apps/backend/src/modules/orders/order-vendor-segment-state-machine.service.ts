import { Payment } from '../payments/entities/payment.entity';
import { isOrderVisibleToVendor } from './vendor-order-visibility';
import { BadRequestException, ConflictException, ForbiddenException, forwardRef, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { CustomerNotificationType, recordOrderNotification } from '../notifications/customer-notification-events';
import { DataSource } from 'typeorm';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrderStatus } from './order-status.enum';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { restoreTrackedInventoryForSegments } from './tracked-inventory.util';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { Role } from '../../common/enums/role.enum';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { OrderReadinessService } from './order-readiness.service';
import { AutomaticDispatchService } from '../delivery/automatic-dispatch.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderSegmentCancellationService } from './order-segment-cancellation.service';
import { OrderPaymentGateService } from './order-payment-gate.service';
import { recordSegmentEvent } from './segment-events.util';
import { RequestContextService } from '../../common/request-context/request-context.service';

/**
 * The segment-level state machine — mirrors OrderStateMachineService's
 * exact pattern (explicit transition table, DB row lock, role gating)
 * with ONE addition required by the Phase B design review: an
 * ownership check via VendorStaffAuthorizationService. The generic
 * order-level endpoint has no such check today (a live gap, not fixed
 * by this file — that endpoint is untouched, per instruction).
 *
 * CONFIRMED BUSINESS RULE: this service NEVER writes to `Order.status`
 * — that remains OrderStateMachineService's exclusive concern,
 * eventually driven by the Dispatch flow (not built yet). A vendor
 * confirming/preparing/readying their own segment has zero effect on
 * the order-level status field.
 *
 * PENDING/CONFIRMED/PREPARING/READY_FOR_PICKUP -> CANCELLED are all
 * permitted for VENDOR/VENDOR_MANAGER, mirroring the already-confirmed
 * order-level rule (a vendor may back out even at the last prep
 * stage) applied to its now-correct scope — the segment, not the
 * whole order. PICKED_UP is deliberately NOT a target here — that's
 * the driver's action (Phase C), not built in this phase.
 */

type SegmentTransitionRule = {
  from: OrderVendorSegmentStatus;
  to: OrderVendorSegmentStatus;
  allowedRoles: Role[];
};

/**
 * Who may move a segment: the branch's own vendor staff, and Hatly operations ON THE VENDOR'S BEHALF (the HTTP layer additionally requires
 * the MANAGE_ORDER_FULFILMENT permission for operations; the event history records the actor and the on-behalf flag). One table, one implementation.
 */
const SEGMENT_ACTORS: Role[] = [Role.VENDOR, Role.VENDOR_MANAGER, Role.ADMIN, Role.SUPER_ADMIN];
const OPERATIONS_ROLES: Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

const SEGMENT_TRANSITIONS: SegmentTransitionRule[] = [
  { from: OrderVendorSegmentStatus.PENDING, to: OrderVendorSegmentStatus.CONFIRMED, allowedRoles: SEGMENT_ACTORS },
  { from: OrderVendorSegmentStatus.PENDING, to: OrderVendorSegmentStatus.CANCELLED, allowedRoles: SEGMENT_ACTORS },

  { from: OrderVendorSegmentStatus.CONFIRMED, to: OrderVendorSegmentStatus.PREPARING, allowedRoles: SEGMENT_ACTORS },
  { from: OrderVendorSegmentStatus.CONFIRMED, to: OrderVendorSegmentStatus.CANCELLED, allowedRoles: SEGMENT_ACTORS },

  { from: OrderVendorSegmentStatus.PREPARING, to: OrderVendorSegmentStatus.READY_FOR_PICKUP, allowedRoles: SEGMENT_ACTORS },
  { from: OrderVendorSegmentStatus.PREPARING, to: OrderVendorSegmentStatus.CANCELLED, allowedRoles: SEGMENT_ACTORS },

  { from: OrderVendorSegmentStatus.READY_FOR_PICKUP, to: OrderVendorSegmentStatus.CANCELLED, allowedRoles: SEGMENT_ACTORS },
];

const SEGMENT_LOCKED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
  OrderStatus.COLLECTED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED_DELIVERY,
];

@Injectable()
export class OrderVendorSegmentStateMachineService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly vendorStaffAuthorizationService: VendorStaffAuthorizationService,
    private readonly orderReadinessService: OrderReadinessService,
    @Inject(forwardRef(() => AutomaticDispatchService))
    private readonly automaticDispatchService: AutomaticDispatchService,
    private readonly orderStateMachine: OrderStateMachineService,
    private readonly orderSegmentCancellationService: OrderSegmentCancellationService,
    private readonly orderPaymentGateService: OrderPaymentGateService,
    @Optional() private readonly requestContextService?: RequestContextService,
  ) {}

  private readonly logger = new Logger(OrderVendorSegmentStateMachineService.name);

  /**
   * `expectedReadyAt` is accepted here because the field already
   * exists on the schema specifically for this ("the vendor-side
   * confirm + estimate prep time workflow" — see the entity's own
   * doc comment) — no new field, no new validation logic beyond
   * accepting and storing whatever the vendor supplies. Nothing reads
   * it yet (Dispatch doesn't exist) — this only makes it possible to
   * populate, per the approved Phase B scope.
   */
  async transition(params: {
    segmentId: string;
    to: OrderVendorSegmentStatus;
    /** Null only for a SYSTEM transition (`system: true`): automatic readiness of a Hatly/Wasally service segment. */
    actorUserId: string | null;
    actorRole: Role;
    expectedReadyAt?: Date;
    /** Required (non-blank) for a rejection by a person; stored in the segment history and shown to the customer. */
    reason?: string;
    /** A transition made by the platform itself (no person): skips the actor/role/ownership checks, still follows the table and gates. */
    system?: boolean;
  }): Promise<OrderVendorSegment> {
    const isOperations = !params.system && OPERATIONS_ROLES.includes(params.actorRole);
    if (params.to === OrderVendorSegmentStatus.CANCELLED && !params.system && !(params.reason ?? '').trim()) {
      throw new BadRequestException({ message: 'A reason is required to reject an order segment.', details: { code: 'REJECTION_REASON_REQUIRED' } });
    }
    // Set only when this call cancelled the order's LAST active segment, which cancels the whole order atomically.
    let afterOrderCancelled: (() => Promise<void>) | undefined;
    let partiallyCancelled = false;

    const updatedSegment = await this.dataSource.transaction(async (manager) => {
      const segment = await manager.findOne(OrderVendorSegment, {
        where: { id: params.segmentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!segment) {
        throw new NotFoundException('Order segment not found.');
      }

      if (!params.system && !isOperations) {
        if (!segment.vendorBranchId) {
          // AD_HOC_SERVICE segments have no VendorBranch — there is no registered vendor to authorize. Only Hatly operations (or the
          // platform itself) may move one.
          throw new ForbiddenException('This segment does not belong to a registered vendor.');
        }
        await this.vendorStaffAuthorizationService.assertOwnsBranch(params.actorUserId as string, segment.vendorBranchId);
      }
      const fromStatus = segment.status;

      // A vendor may only work a segment while its order is still in the vendor's hands. Once the
      // order is cancelled, failed, delivered, or physically picked up, moving a segment
      // (CONFIRMED/PREPARING/READY/CANCELLED) is meaningless at best and — for a cancellation —
      // corrupts stock and finance at worst (found by the Group 8 journeys: a vendor could keep
      // "preparing" a cancelled order).
      const parentOrder = await manager.findOne(Order, { where: { id: segment.orderId } });
      if (parentOrder && SEGMENT_LOCKED_ORDER_STATUSES.includes(parentOrder.status)) {
        throw new BadRequestException({
          message: `This order is ${parentOrder.status} — its vendor segments can no longer be changed.`,
          details: { code: 'ORDER_NOT_ACTIVE_FOR_VENDOR', status: parentOrder.status },
        });
      }

      // R2: a vendor cannot act on (or learn about) an InstaPay / Vodafone Cash order until Operations verified its payment.
      if (!params.system && (params.actorRole === Role.VENDOR || params.actorRole === Role.VENDOR_MANAGER) && parentOrder?.paymentMethod === 'MANUAL_TRANSFER') {
        const payment = await manager.getRepository(Payment).findOne({ where: { orderId: parentOrder.id } });
        if (!isOrderVisibleToVendor(parentOrder.paymentMethod, payment?.status)) throw new NotFoundException('Order not found.');
      }

      // R12: on a branch whose orders Hatly accepts, the vendor does not accept or reject (Operations do, on its behalf); it still prepares.
      if (
        !params.system && !isOperations && segment.vendorBranchId && segment.status === OrderVendorSegmentStatus.PENDING &&
        (params.to === OrderVendorSegmentStatus.CONFIRMED || params.to === OrderVendorSegmentStatus.CANCELLED)
      ) {
        const [b] = await manager.query(`SELECT acceptance_mode FROM vendor_branches WHERE id = $1`, [segment.vendorBranchId]);
        if (b?.acceptance_mode === 'HATLY') {
          throw new ForbiddenException({ message: 'Hatly accepts or rejects this branch’s orders. Prepare it once Hatly has accepted it.', details: { code: 'ACCEPTANCE_BY_HATLY' } });
        }
      }

      const rule = SEGMENT_TRANSITIONS.find((t) => t.from === segment.status && t.to === params.to);
      if (!rule) {
        throw new BadRequestException(`Cannot transition segment from ${segment.status} to ${params.to}.`);
      }
      if (!params.system && !rule.allowedRoles.includes(params.actorRole)) {
        throw new BadRequestException(`Role ${params.actorRole} is not allowed to perform this transition.`);
      }

      // Vendor/Driver Deferred Pricing workflow. Every unpriced Custom
      // Item in THIS segment must be priced before the Vendor can mark
      // it READY_FOR_PICKUP — CONFIRMED: never a partial READY, never
      // a new order status; this is a validation gate on the existing
      // transition, checked inside the SAME locked transaction as the
      // status change itself, so the two can never diverge (either
      // both happen or neither does). Normal catalog-item segments
      // (no Custom Items at all) are completely unaffected — the
      // `some(...)` below is simply never true for them.
      // PAYMENT GATING (PD-006): a vendor may accept (CONFIRMED) an order that awaits payment approval, but may not start
      // PREPARING it until a MANUAL_TRANSFER payment is approved.
      if (params.to === OrderVendorSegmentStatus.PREPARING && parentOrder) {
        await this.orderPaymentGateService.assertFulfilmentMayProceed(manager, parentOrder);
      }

      // (only a vendor's segment carries vendor custom items; a Hatly/Wasally service segment is priced by the driver's purchase record)
      if (params.to === OrderVendorSegmentStatus.READY_FOR_PICKUP && segment.groupType !== CartGroupType.AD_HOC_SERVICE) {
        const items = (await manager.find(OrderItem, { where: { orderVendorSegmentId: segment.id } })).filter((i) => !i.removedAt);
        const stillUnpriced = items.some(
          (i) => (i.productId === null || i.productId === undefined) && i.actualAmountMinor == null,
        );
        if (stillUnpriced) {
          throw new BadRequestException({
            message: 'One or more custom items in this order still need a final price before it can be marked ready.',
            details: { code: 'UNPRICED_CUSTOM_ITEMS_REMAIN' },
          });
        }
      }

      // Cancelling (rejecting) a segment recomputes the order's money from the remaining segments (PD-002/PD-003/PD-004): the segment's
      // subtotal and discounts leave, its Flash Sale allocation is released, the additional-vendor fee drops per rejected vendor, the base
      // delivery fee stays FIXED, and the difference is refunded or removed from the amount due (OrderSegmentCancellationService).
      if (params.to === OrderVendorSegmentStatus.CANCELLED) {
        const order = await manager.findOne(Order, { where: { id: segment.orderId }, lock: { mode: 'pessimistic_write' } });
        if (order && SEGMENT_LOCKED_ORDER_STATUSES.includes(order.status)) {
          // Re-checked UNDER the order lock: the order may have moved on since the unlocked read above.
          throw new BadRequestException({
            message: `This order is ${order.status} — its vendor segments can no longer be changed.`,
            details: { code: 'ORDER_NOT_ACTIVE_FOR_VENDOR', status: order.status },
          });
        }
        if (order) {
          const siblings = await manager.find(OrderVendorSegment, { where: { orderId: order.id } });
          const otherActiveCount = siblings.filter(
            (s) => s.id !== segment.id && s.status !== OrderVendorSegmentStatus.CANCELLED,
          ).length;

          if (otherActiveCount === 0 && order.status === OrderStatus.ASSIGNED_TO_DRIVER) {
            // Cancelling the last segment cancels the order, which the order state machine forbids once a driver is
            // assigned ("only reassigned/failed") — refuse rather than leave a live order with nothing to fulfil.
            throw new ConflictException({
              message: 'A driver is already assigned — the last vendor segment can no longer be cancelled.',
              details: { code: 'ORDER_ASSIGNED_CANNOT_CANCEL_LAST_SEGMENT' },
            });
          }

          await restoreTrackedInventoryForSegments(manager, [segment.id]);
          segment.status = OrderVendorSegmentStatus.CANCELLED;
          await manager.save(segment);

          if (otherActiveCount > 0) {
            // PD-002/PD-003: the cancelled vendor's merchandise + one additional-vendor fee leave the order, and a
            // PAID Manual Transfer is refunded the difference (server-derived, idempotent per segment).
            await this.orderSegmentCancellationService.applyPartialCancellation(manager, {
              order,
              cancelledSegment: segment,
              actorUserId: params.actorUserId as string,
            });
            partiallyCancelled = true;
            // Told in the same transaction (one notification per order): this vendor's part is gone, the rest of the order continues.
            await recordOrderNotification(manager, { id: order.id, customerId: order.customerId, orderNumber: order.orderNumber }, CustomerNotificationType.ORDER_PART_CANCELLED);
          } else {
            // Last active segment: the whole order is cancelled in the SAME transaction (delivery fee 0, the full
            // paid amount minus anything already refunded, remaining flash-sale allocations returned).
            const cancelled = await this.orderStateMachine.transitionInTransaction(manager, {
              orderId: order.id,
              to: OrderStatus.CANCELLED,
              actorRole: params.actorRole,
              actorUserId: params.actorUserId as string,
              cancellationReason: params.reason?.trim() ? `All vendor segments were cancelled — ${params.reason.trim()}` : 'All vendor segments were cancelled.',
            });
            afterOrderCancelled = cancelled.afterCommit;
          }
        }
      }

      segment.status = params.to;
      if (params.expectedReadyAt !== undefined) {
        segment.expectedReadyAt = params.expectedReadyAt;
      }

      const saved = await manager.save(segment);
      // Same transaction as the transition: the history and the state can never disagree.
      await recordSegmentEvent(manager, {
        segmentId: segment.id,
        orderId: segment.orderId,
        fromStatus,
        toStatus: params.to,
        actorUserId: params.system ? null : params.actorUserId,
        actorRole: params.system ? null : params.actorRole,
        onBehalfOfVendor: isOperations,
        reason: params.reason ?? null,
        correlationRef: this.requestContextService?.getCorrelationId?.() ?? null,
      });
      return saved;
    });

    // Outside the segment's own transaction, deliberately — the
    // vendor's segment update has already committed and succeeded
    // regardless of what happens next. Readiness aggregation and any
    // dispatch attempt are a SEPARATE, system-driven concern (their
    // own transactions, their own locks) — never allowed to make the
    // vendor's own request fail or roll back.
    if (afterOrderCancelled) {
      await afterOrderCancelled();
    }

    // The vendor whose segment was cancelled may have been the last one the order was waiting for: if every remaining
    // segment is already READY_FOR_PICKUP, the order moves on (and is dispatched) just as if the last one had become ready.
    if (partiallyCancelled || params.to === OrderVendorSegmentStatus.READY_FOR_PICKUP) {
      await this.advanceAndDispatch(updatedSegment.orderId);
    }

    return updatedSegment;
  }

  /**
   * After the segment change has COMMITTED: if every remaining segment is ready the order moves on and automatic dispatch is attempted.
   * A failure here must never turn the vendor's (or operations') successful transition into a failed request — it is logged, recorded as a
   * dispatch attempt, and raised to operations as an ASSIGNMENT_ERROR alert; a retry is safe (readiness and dispatch are idempotent).
   */
  private async advanceAndDispatch(orderId: string): Promise<void> {
    try {
      const justBecameFullyReady = await this.orderReadinessService.checkAndAdvance(orderId);
      if (justBecameFullyReady) {
        await this.automaticDispatchService.attemptAutomaticDispatch(orderId);
      }
    } catch (error) {
      this.logger.error(`Readiness/dispatch after a segment change failed for order ${orderId}: ${error instanceof Error ? error.message : String(error)}`);
      await this.automaticDispatchService.recordAssignmentError(orderId, error);
    }
  }
}
