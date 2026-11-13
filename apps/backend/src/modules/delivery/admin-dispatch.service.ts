import { ACTIVE_DRIVER_ORDER_STATUSES } from './driver-capacity';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { Delivery } from './entities/delivery.entity';
import { DriverRankingService } from './driver-ranking.service';
import { DeliveryAssignmentService, OrderNotAssignableException } from './delivery-assignment.service';
import { OrderStatus } from '../orders/order-status.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';

/**
 * PHASE I-A, CHUNK 6 addition. Read-only view for the Admin Dispatch
 * page — confirmed no such endpoint existed anywhere (`AdminDispatchController`
 * only had the two mutation endpoints; `admin/dispatch-alerts` is a
 * DIFFERENT, narrower thing — "no eligible driver was found" alerts,
 * not a general dispatchable-orders list). Purely additive: no state
 * change, no business rule, mirrors the exact list-endpoint shape
 * already used everywhere else in this codebase (e.g.
 * AdminVendorsService.listVendors).
 */
export interface AdminDispatchOrderView {
  orderId: string;
  /** The human order reference (`HT-…`) an admin searches and talks about. */
  orderNumber: string;
  status: string;
  createdAt: Date;
  deliveryAddressSnapshot: unknown;
  currentDeliveryId: string | null;
  currentDriverId: string | null;
  reassignmentCount: number;
}

/**
 * Manual Admin assignment/reassignment. Reuses
 * DeliveryAssignmentService.assignDriver() unmodified — its own
 * internal isOnline/isAvailable re-check inside the transaction is
 * NEVER bypassed by anything here, per the instruction not to redesign
 * its locking/assignment behavior.
 *
 * CONFIRMED (Phase D, decision 9): "manual override may bypass normal
 * automatic ranking/eligibility only for an Admin with the appropriate
 * OVERRIDE_DISPATCH permission." This is now an actually-enforced
 * check, not just a design comment: an admin who names a specific
 * driver but does NOT hold OVERRIDE_DISPATCH still has that driver
 * checked against DriverRankingService's own filters (bicycle-distance
 * limit, online/available/verified, etc.) via
 * isDriverEligibleForOrder() — reusing that method's logic exactly,
 * not a re-implementation. Only a caller who DOES hold
 * OVERRIDE_DISPATCH may bypass that filter layer for an explicitly-
 * named driver. The baseline isOnline/isAvailable/verificationStatus
 * checks inside the unmodified assignDriver() itself are never
 * bypassed by anything, regardless of this permission.
 */
@Injectable()
export class AdminDispatchService {
  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(Delivery) private readonly deliveriesRepository: Repository<Delivery>,
    private readonly driverRankingService: DriverRankingService,
    private readonly deliveryAssignmentService: DeliveryAssignmentService,
  ) {}

  /**
   * `driverId` explicitly named without `hasOverridePermission` = that
   * driver must still pass the normal ranking/eligibility filters.
   * `driverId` named WITH `hasOverridePermission` = bypass those
   * filters entirely for that driver (baseline eligibility inside
   * assignDriver() itself still applies, never bypassed). No
   * `driverId` = run the same ranking automatic dispatch uses, as a
   * manual "attempt dispatch now" action (override is irrelevant here
   * — there's no named driver to bypass filters for).
   */
  async assign(orderId: string, driverId?: string, hasOverridePermission = false): Promise<Delivery> {
    // A clear refusal up front (the authoritative status check is repeated under lock inside assignDriver()).
    await this.requireStatus(orderId, OrderStatus.READY_FOR_PICKUP);
    const candidateDriverIds = driverId
      ? await this.resolveNamedDriverCandidate(orderId, driverId, hasOverridePermission)
      : await this.rankForOrder(orderId);
    const delivery = await this.deliveryAssignmentService.assignDriver({ orderId, candidateDriverIds });
    // A person took over: the unanswered-offer streak starts over (the assignment itself resolved every open alert of the order).
    await this.deliveriesRepository.update({ orderId }, { consecutiveUnanswered: 0 });
    return delivery;
  }

  /**
   * Control Tower milestone fix: every check (order state, the named driver's eligibility / OVERRIDE_DISPATCH, the new
   * driver's availability, the caller's view of who is currently assigned) runs BEFORE anything is written, and the
   * release + new assignment are one transaction (DeliveryAssignmentService.reassignDriver). Previously the previous
   * driver was freed, the counter bumped and the order released first — so a refused reassignment (ineligible/offline
   * driver) silently left the order unassigned, and a reassignment attempted on a PICKED_UP order marked the carrying
   * driver available before failing.
   */
  async reassign(orderId: string, newDriverId: string, hasOverridePermission = false, expectedCurrentDriverId?: string): Promise<Delivery> {
    await this.requireStatus(orderId, OrderStatus.ASSIGNED_TO_DRIVER);
    await this.resolveNamedDriverCandidate(orderId, newDriverId, hasOverridePermission);
    const delivery = await this.deliveryAssignmentService.reassignDriver({ orderId, newDriverId, expectedCurrentDriverId });
    await this.deliveriesRepository.update({ orderId }, { consecutiveUnanswered: 0 });
    return delivery;
  }

  private async requireStatus(orderId: string, expected: OrderStatus): Promise<void> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({ message: 'Order not found.', details: { code: 'ORDER_NOT_FOUND' } });
    }
    if (order.fulfillmentType !== FulfillmentType.DELIVERY) {
      throw new OrderNotAssignableException(
        'This is a pickup order — the customer collects it at the branch, so no driver is assigned.',
        expected === OrderStatus.READY_FOR_PICKUP ? 'ORDER_NOT_ASSIGNABLE' : 'ORDER_NOT_REASSIGNABLE',
        order.status,
      );
    }
    if (order.status !== expected) {
      throw expected === OrderStatus.READY_FOR_PICKUP
        ? new OrderNotAssignableException(`This order cannot be assigned: it is ${order.status}, not waiting for a driver.`, 'ORDER_NOT_ASSIGNABLE', order.status)
        : new OrderNotAssignableException(`This order cannot be reassigned: it is ${order.status}, not assigned to a driver.`, 'ORDER_NOT_REASSIGNABLE', order.status);
    }
  }

  private async resolveNamedDriverCandidate(
    orderId: string,
    driverId: string,
    hasOverridePermission: boolean,
  ): Promise<string[]> {
    if (hasOverridePermission) {
      return [driverId];
    }
    const order = await this.getOrderWithSegments(orderId);
    const eligible = await this.driverRankingService.isDriverEligibleForOrder(order, driverId);
    if (!eligible) {
      throw new BadRequestException({
        message:
          'This driver does not meet the normal ranking/eligibility criteria for this order. OVERRIDE_DISPATCH permission is required to assign them anyway.',
        details: { code: 'DRIVER_NOT_ELIGIBLE_WITHOUT_OVERRIDE' },
      });
    }
    return [driverId];
  }

  /**
   * Operations board (2026-11-13): the drivers automatic dispatch would try first for this order — the SAME ranking (eligibility, service
   * area, GPS proximity / round-robin, spare capacity), read-only. Nothing is assigned; the operator still chooses.
   */
  async suggestDrivers(orderId: string, limit = 3): Promise<Array<{ id: string; name: string; active: number; capacity: number }>> {
    const ids = (await this.rankForOrder(orderId)).slice(0, limit);
    if (ids.length === 0) return [];
    const rows: any[] = await this.ordersRepository.manager.query(
      `SELECT d.id, u.full_name AS name,
              (SELECT count(*)::int FROM deliveries x JOIN orders o ON o.id = x.order_id WHERE x.driver_id = d.id AND x.deleted_at IS NULL AND o.status::text = ANY($2::text[])) AS active,
              GREATEST(1, COALESCE(d.capacity_override, (SELECT v.max_active_deliveries FROM vehicle_types v WHERE v.id = d.vehicle_type_id), 1))::int AS capacity
         FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ANY($1::uuid[])`,
      [ids, ACTIVE_DRIVER_ORDER_STATUSES],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((id) => byId.has(id)).map((id) => ({ id, name: byId.get(id).name, active: byId.get(id).active, capacity: byId.get(id).capacity }));
  }

  private async rankForOrder(orderId: string): Promise<string[]> {
    const order = await this.getOrderWithSegments(orderId);
    return this.driverRankingService.rankCandidates(order);
  }

  private async getOrderWithSegments(orderId: string): Promise<Order> {
    const order = await this.ordersRepository.findOne({ where: { id: orderId }, relations: { segments: true } });
    if (!order) {
      throw new NotFoundException('Order not found.');
    }
    return order;
  }

  /**
   * READY_FOR_PICKUP (awaiting assignment) and ASSIGNED_TO_DRIVER
   * (assigned, reassignable) — the two states a dispatch decision is
   * actually relevant for. PICKED_UP/ON_THE_WAY/DELIVERED are past the
   * dispatch decision point (this is deliberately NOT a general order-
   * tracking view). Newest-first is arbitrary but stable — no ranking
   * logic here, this is a plain read.
   */
  async listDispatchable(): Promise<AdminDispatchOrderView[]> {
    const orders = await this.ordersRepository.find({
      where: [
        { status: OrderStatus.READY_FOR_PICKUP, fulfillmentType: FulfillmentType.DELIVERY },
        { status: OrderStatus.ASSIGNED_TO_DRIVER, fulfillmentType: FulfillmentType.DELIVERY },
      ],
      order: { createdAt: 'DESC' },
    });
    if (orders.length === 0) return [];

    const deliveries = await this.deliveriesRepository.find({
      where: orders.map((o) => ({ orderId: o.id })),
    });
    const deliveryByOrderId = new Map(deliveries.map((d) => [d.orderId, d]));

    return orders.map((order) => {
      const delivery = deliveryByOrderId.get(order.id);
      // Control Tower milestone fix: a READY_FOR_PICKUP order's delivery row may still name the driver it was RELEASED from
      // (timeout / driver release) — that driver is not on the order any more, so it must not be reported as current
      // (the Dispatch page filed such orders under "Assigned" and offered a reassignment that cannot apply).
      const driverOnOrder = order.status === OrderStatus.ASSIGNED_TO_DRIVER;
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        createdAt: order.createdAt,
        deliveryAddressSnapshot: order.deliveryAddressSnapshot,
        currentDeliveryId: delivery?.id ?? null,
        currentDriverId: driverOnOrder ? delivery?.driverId ?? null : null,
        reassignmentCount: delivery?.reassignmentCount ?? 0,
      };
    });
  }
}
