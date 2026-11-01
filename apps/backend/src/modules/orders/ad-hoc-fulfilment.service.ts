import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderStatus } from './order-status.enum';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { OrderVendorSegmentStateMachineService } from './order-vendor-segment-state-machine.service';
import { paymentBlocksFulfilment } from './order-payment-gate.service';
import { Payment } from '../payments/entities/payment.entity';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { Role } from '../../common/enums/role.enum';

const NEXT_STEP: Partial<Record<OrderVendorSegmentStatus, OrderVendorSegmentStatus>> = {
  [OrderVendorSegmentStatus.PENDING]: OrderVendorSegmentStatus.CONFIRMED,
  [OrderVendorSegmentStatus.CONFIRMED]: OrderVendorSegmentStatus.PREPARING,
  [OrderVendorSegmentStatus.PREPARING]: OrderVendorSegmentStatus.READY_FOR_PICKUP,
};

const FINISHED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
  OrderStatus.DELIVERED,
  OrderStatus.COLLECTED,
  OrderStatus.CANCELLED,
  OrderStatus.FAILED_DELIVERY,
];

/**
 * Hatly ("هاتلي من مكان") and Wasally ("وصّلي لمكان") service segments have NO vendor: nobody accepts or prepares them. Approved rule: once the
 * existing PAYMENT GATE passes (cash on delivery / pay at delivery / wallet immediately; Manual Transfer only after the transfer is approved)
 * the segment becomes ready for dispatch automatically — through the SAME segment state machine (system actor, full history rows), so the
 * normal readiness aggregation and automatic driver assignment follow. Nothing here bypasses payment verification.
 *
 * Triggered right after the order is placed, and by a small periodic pass (idle in tests) that picks up orders whose Manual Transfer has since
 * been approved. Every step is idempotent: a concurrent or repeated pass finds nothing left to do.
 */
@Injectable()
export class AdHocFulfilmentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdHocFulfilmentService.name);
  static readonly PASS_INTERVAL_MS = 10_000;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => OrderVendorSegmentStateMachineService))
    private readonly segmentStateMachine: OrderVendorSegmentStateMachineService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.configService.get<string>('env') === 'test') return;
    this.timer = setInterval(() => {
      this.sweep().catch((error) => this.logger.error(`Hatly/Wasally readiness pass failed: ${(error as Error).message}`));
    }, AdHocFulfilmentService.PASS_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Moves the order's Hatly/Wasally segments to READY_FOR_PICKUP if (and only if) the payment gate allows it. Returns how many segments moved. */
  async advanceOrder(orderId: string): Promise<number> {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: orderId } });
    if (!order || FINISHED_ORDER_STATUSES.includes(order.status)) return 0;
    const payment = await this.dataSource.getRepository(Payment).findOne({ where: { orderId } });
    if (paymentBlocksFulfilment(order.paymentMethod, payment)) return 0; // Manual Transfer not approved yet: wait, never bypass

    const segments = await this.dataSource.getRepository(OrderVendorSegment).find({ where: { orderId, groupType: CartGroupType.AD_HOC_SERVICE } });
    let moved = 0;
    for (const segment of segments) {
      let status = segment.status;
      while (NEXT_STEP[status]) {
        const next = NEXT_STEP[status]!;
        try {
          const updated = await this.segmentStateMachine.transition({
            segmentId: segment.id,
            to: next,
            actorUserId: null,
            actorRole: Role.ADMIN,
            system: true,
          });
          status = updated.status;
          moved++;
        } catch (error) {
          // A concurrent pass or an operator got there first (or the order changed under us): benign — the next pass re-reads the truth.
          this.logger.debug(`Hatly/Wasally readiness: segment ${segment.id} ${status}→${next} skipped: ${(error as Error).message}`);
          break;
        }
      }
    }
    return moved;
  }

  /** One pass over service segments still waiting (typically for a Manual Transfer approval). Bounded batch. */
  async sweep(): Promise<{ orders: number }> {
    const rows: Array<{ order_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT s.order_id
         FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        WHERE s.group_type = 'AD_HOC_SERVICE' AND s.status IN ('PENDING','CONFIRMED','PREPARING')
          AND o.status NOT IN ('PICKED_UP','ON_THE_WAY','DELIVERED','COLLECTED','CANCELLED','FAILED_DELIVERY')
        LIMIT 50`,
    );
    for (const row of rows) await this.advanceOrder(row.order_id);
    return { orders: rows.length };
  }
}
