import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { Delivery } from './entities/delivery.entity';
import { Driver } from './entities/driver.entity';
import { DriverRankingService } from './driver-ranking.service';
import { DeliveryAssignmentService } from './delivery-assignment.service';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { OrderStatus } from '../orders/order-status.enum';
import { Role } from '../../common/enums/role.enum';

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
    @InjectRepository(Driver) private readonly driversRepository: Repository<Driver>,
    private readonly driverRankingService: DriverRankingService,
    private readonly deliveryAssignmentService: DeliveryAssignmentService,
    private readonly orderStateMachine: OrderStateMachineService,
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
    const candidateDriverIds = driverId
      ? await this.resolveNamedDriverCandidate(orderId, driverId, hasOverridePermission)
      : await this.rankForOrder(orderId);
    return this.deliveryAssignmentService.assignDriver({ orderId, candidateDriverIds });
  }

  /**
   * Releases the currently-assigned driver, moves the order back to
   * READY_FOR_PICKUP using the EXISTING, already-permitted
   * ASSIGNED_TO_DRIVER→READY_FOR_PICKUP transition (its own comment
   * already anticipates this: "driver rejects / reassignment"), then
   * assigns the new driver via the same unmodified primitive. Same
   * OVERRIDE_DISPATCH enforcement as assign() — reassignment is still
   * "naming a specific driver," so the same rule applies.
   */
  async reassign(orderId: string, newDriverId: string, hasOverridePermission = false): Promise<Delivery> {
    const existingDelivery = await this.deliveriesRepository.findOne({ where: { orderId } });
    if (!existingDelivery) {
      throw new NotFoundException('No existing delivery to reassign for this order.');
    }

    const previousDriver = existingDelivery.driverId
      ? await this.driversRepository.findOne({ where: { id: existingDelivery.driverId } })
      : null;
    if (previousDriver) {
      previousDriver.isAvailable = true;
      await this.driversRepository.save(previousDriver);
    }
    existingDelivery.reassignmentCount = (existingDelivery.reassignmentCount ?? 0) + 1;
    await this.deliveriesRepository.save(existingDelivery);

    await this.orderStateMachine.transition({
      orderId,
      to: OrderStatus.READY_FOR_PICKUP,
      actorRole: Role.ADMIN,
    });

    const candidateDriverIds = await this.resolveNamedDriverCandidate(orderId, newDriverId, hasOverridePermission);
    return this.deliveryAssignmentService.assignDriver({ orderId, candidateDriverIds });
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
      where: [{ status: OrderStatus.READY_FOR_PICKUP }, { status: OrderStatus.ASSIGNED_TO_DRIVER }],
      order: { createdAt: 'DESC' },
    });
    if (orders.length === 0) return [];

    const deliveries = await this.deliveriesRepository.find({
      where: orders.map((o) => ({ orderId: o.id })),
    });
    const deliveryByOrderId = new Map(deliveries.map((d) => [d.orderId, d]));

    return orders.map((order) => {
      const delivery = deliveryByOrderId.get(order.id);
      return {
        orderId: order.id,
        status: order.status,
        createdAt: order.createdAt,
        deliveryAddressSnapshot: order.deliveryAddressSnapshot,
        currentDeliveryId: delivery?.id ?? null,
        currentDriverId: delivery?.driverId ?? null,
        reassignmentCount: delivery?.reassignmentCount ?? 0,
      };
    });
  }
}
