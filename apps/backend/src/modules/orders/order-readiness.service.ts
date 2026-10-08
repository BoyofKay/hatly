import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus } from './order-status.enum';
import { Order } from './entities/order.entity';
import { Role } from '../../common/enums/role.enum';

/**
 * CONFIRMED BUSINESS DECISION: for a multi-vendor order, Dispatch must
 * not start until ALL OrderVendorSegments are READY_FOR_PICKUP — a
 * single ready segment is not enough. This service is the aggregation
 * check that enforces exactly that, and nothing more.
 *
 * Called after a segment transitions to READY_FOR_PICKUP (see
 * OrderVendorSegmentStateMachineService). Advances `Order.status`
 * through the EXISTING, unmodified transition table
 * (PENDING→CONFIRMED→PREPARING→READY_FOR_PICKUP) using `Role.ADMIN` as
 * a system actor — the same convention already established for
 * `DeliveryAssignmentService`'s own system-initiated transition. This
 * is Dispatch advancing Order.status, never the vendor — the vendor's
 * own action only ever wrote OrderVendorSegment.status, unchanged.
 *
 * A CANCELLED segment does not block readiness — it's excluded from
 * the "must be ready" set entirely, a technical interpretation (no
 * prior rule addresses cancelled segments specifically), not a
 * business decision.
 */
@Injectable()
export class OrderReadinessService {
  constructor(
    @InjectRepository(OrderVendorSegment)
    private readonly segmentsRepository: Repository<OrderVendorSegment>,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
    private readonly orderStateMachine: OrderStateMachineService,
  ) {}

  /**
   * Returns true only if THIS call is what just made the order fully
   * ready (i.e. the caller should now attempt dispatch) — false if the
   * order isn't fully ready yet, or was already advanced to
   * READY_FOR_PICKUP (or beyond) by an earlier call. Idempotent: safe
   * to call more than once for the same order.
   */
  async checkAndAdvance(orderId: string): Promise<boolean> {
    const orderBefore = await this.ordersRepository.findOne({ where: { id: orderId } });
    if (!orderBefore || this.isAtOrPastReady(orderBefore.status)) {
      // Already advanced (by an earlier call, or the order somehow
      // progressed further already) — nothing new to report.
      return false;
    }

    const segments = await this.segmentsRepository.find({ where: { orderId } });
    const relevantSegments = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED);

    const allReady =
      relevantSegments.length > 0 &&
      relevantSegments.every((s) => s.status === OrderVendorSegmentStatus.READY_FOR_PICKUP);

    if (!allReady) {
      return false;
    }

    return this.advanceToReady(orderId);
  }

  private isAtOrPastReady(status: OrderStatus): boolean {
    return [
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.ASSIGNED_TO_DRIVER,
      OrderStatus.PICKED_UP,
      OrderStatus.ON_THE_WAY,
      OrderStatus.DELIVERED,
      OrderStatus.COLLECTED,
      OrderStatus.CANCELLED,
    ].includes(status);
  }

  /**
   * Walks Order.status forward from wherever it currently is, through
   * the existing PENDING→CONFIRMED→PREPARING→READY_FOR_PICKUP chain.
   * Caller has already confirmed the order was NOT at or past
   * READY_FOR_PICKUP before this call, so reaching it here genuinely
   * means this call caused the advancement.
   */
  private async advanceToReady(orderId: string): Promise<boolean> {
    let order: Order | null = await this.orderStateMachine.transitionIfPossible({
      orderId,
      to: OrderStatus.CONFIRMED,
      actorRole: Role.ADMIN,
    });
    if (order?.status === OrderStatus.CONFIRMED) {
      order = await this.orderStateMachine.transitionIfPossible({
        orderId,
        to: OrderStatus.PREPARING,
        actorRole: Role.ADMIN,
      });
    }
    if (order?.status === OrderStatus.PREPARING) {
      order = await this.orderStateMachine.transitionIfPossible({
        orderId,
        to: OrderStatus.READY_FOR_PICKUP,
        actorRole: Role.ADMIN,
      });
    }
    return order?.status === OrderStatus.READY_FOR_PICKUP;
  }
}
