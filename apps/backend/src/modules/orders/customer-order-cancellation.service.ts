import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderStateMachineService } from './order-state-machine.service';
import { customerCancellationBlock } from './customer-cancellation-rule';
import { Role } from '../../common/enums/role.enum';

/**
 * Customer cancellation of a WHOLE order (PD-005). Never of an individual vendor segment.
 *
 * One transaction does everything: it re-checks ownership and status under the locks, runs the ordinary order
 * state-machine cancellation (delivery fee 0 and totals zeroed, stock and flash-sale allocation restored once, PAID
 * Manual Transfer → the existing idempotent refund, unverified transfer → the PD-004 pending entitlement, COD → nothing),
 * and cancels every still-active vendor segment. The post-commit effects (business log, financial events, push) run only
 * after the commit, exactly as for every other cancellation.
 *
 * LOCK ORDER — segments (by id) → order → payment. A vendor cancelling its own segment locks segment → order → payment,
 * admin/readiness paths lock order → payment; taking the segments FIRST here is what makes the customer path deadlock-free
 * against a vendor working on a segment at the same moment, and it serializes two concurrent cancellations completely.
 */
@Injectable()
export class CustomerOrderCancellationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderStateMachine: OrderStateMachineService,
  ) {}

  async cancel(customerId: string, orderId: string, cancellationReason?: string): Promise<{ orderId: string }> {
    // Ownership first, without locking: someone else's (or a non-existent) order is a 404, indistinguishable, and takes no lock.
    const visible = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    if (!visible || visible.customerId !== customerId) {
      throw new NotFoundException('Order not found.');
    }

    let afterCommit: (() => Promise<void>) | undefined;

    await this.dataSource.transaction(async (manager) => {
      const segments = await manager.find(OrderVendorSegment, {
        where: { orderId },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const order = await manager.findOne(Order, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order || order.customerId !== customerId) {
        throw new NotFoundException('Order not found.');
      }

      if (order.status === OrderStatus.CANCELLED) {
        throw new BadRequestException({
          message: 'This order is already cancelled.',
          details: { code: 'ORDER_ALREADY_CANCELLED' },
        });
      }
      const block = customerCancellationBlock(order.status, segments);
      if (block === 'ORDER_STATUS') {
        throw new BadRequestException({
          message: `This order is ${order.status} and can no longer be cancelled by the customer.`,
          details: { code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', status: order.status },
        });
      }
      if (block === 'VENDOR_SEGMENT_PREPARING') {
        // The order status is still PENDING/CONFIRMED, but a vendor has already started preparing its part.
        throw new BadRequestException({
          message: 'A vendor has already started preparing your order, so it can no longer be cancelled.',
          details: { code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', status: order.status, reason: 'VENDOR_SEGMENT_PREPARING' },
        });
      }

      const cancelled = await this.orderStateMachine.transitionInTransaction(manager, {
        orderId,
        to: OrderStatus.CANCELLED,
        actorRole: Role.CUSTOMER,
        actorUserId: customerId,
        cancellationReason,
        customerCancellation: true,
      });
      afterCommit = cancelled.afterCommit;

      // Every still-active segment goes with the order (stock was already restored for exactly those by the state machine,
      // which looks at the segment statuses BEFORE this update). Segments that were already cancelled stay as they were.
      const stillActive = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED).map((s) => s.id);
      if (stillActive.length > 0) {
        await manager
          .createQueryBuilder()
          .update(OrderVendorSegment)
          .set({ status: OrderVendorSegmentStatus.CANCELLED })
          .where('id IN (:...ids)', { ids: stillActive })
          .execute();
      }
    });

    await afterCommit!();
    return { orderId };
  }
}
