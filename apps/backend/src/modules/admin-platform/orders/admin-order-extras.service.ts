import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Order } from '../../orders/entities/order.entity';
import { OrderVendorSegment } from '../../orders/entities/order-vendor-segment.entity';
import { OrderStatus } from '../../orders/order-status.enum';
import { OrderVendorSegmentStatus } from '../../orders/order-vendor-segment-status.enum';
import { OrderStateMachineService } from '../../orders/order-state-machine.service';
import { Role } from '../../../common/enums/role.enum';
import { assertUuid, num } from '../common/platform-sql';

export const ADMIN_CANCEL_REASONS = ['CUSTOMER_REQUEST', 'VENDOR_UNAVAILABLE', 'OUT_OF_STOCK', 'PAYMENT_ISSUE', 'FRAUD_SUSPECTED', 'OPERATIONAL_ISSUE', 'OTHER'] as const;
export type AdminCancelReason = (typeof ADMIN_CANCEL_REASONS)[number];

/** States in which the (unchanged) order state machine lets an ADMIN cancel. After a driver is assigned the failed-delivery flow applies. */
export const ADMIN_CANCELLABLE_STATUSES: string[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP];

@Injectable()
export class AdminOrderExtrasService {
  constructor(
    private readonly ds: DataSource,
    private readonly stateMachine: OrderStateMachineService,
  ) {}

  /**
   * Administrative cancellation through the SAME state machine the customer path uses — so stock/flash-sale restoration, the refund
   * (wallet / manual-transfer obligation / pending entitlement), PD-014/PD-015 discount & coupon restoration and the post-commit
   * effects are exactly the ordinary cancellation's. Segments (by id) are locked before the order, as in the customer path, so a vendor
   * or a concurrent driver assignment cannot interleave. The Dashboard never computes any money; the response reports what happened.
   */
  async cancel(orderId: string, actor: { id: string; role: string }, reasonCode: AdminCancelReason, reasonText?: string) {
    assertUuid(orderId, 'orderId');
    if (!ADMIN_CANCEL_REASONS.includes(reasonCode)) {
      throw new BadRequestException({ message: 'Choose a cancellation reason.', details: { code: 'VALIDATION_FAILED' } });
    }
    if (reasonText && reasonText.length > 500) throw new BadRequestException({ message: 'The reason text is limited to 500 characters.', details: { code: 'VALIDATION_FAILED' } });
    const visible = await this.ds.getRepository(Order).findOne({ where: { id: orderId } });
    if (!visible) throw new NotFoundException('Order not found.');

    let afterCommit: (() => Promise<void>) | undefined;
    await this.ds.transaction(async (manager) => {
      const segments = await manager.find(OrderVendorSegment, { where: { orderId }, order: { id: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      const order = await manager.findOne(Order, { where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException({ message: 'This order is already cancelled.', details: { code: 'ORDER_ALREADY_CANCELLED' } });
      }
      if (!ADMIN_CANCELLABLE_STATUSES.includes(order.status)) {
        throw new ConflictException({
          message: `This order is ${order.status} and can no longer be cancelled from here. After a driver is assigned, use the failed-delivery resolution.`,
          details: { code: 'STATE_CONFLICT', status: order.status },
        });
      }
      const cancelled = await this.stateMachine.transitionInTransaction(manager, {
        orderId,
        to: OrderStatus.CANCELLED,
        actorRole: actor.role as Role,
        actorUserId: actor.id,
        cancellationReason: `${reasonCode}${reasonText?.trim() ? `: ${reasonText.trim()}` : ''}`,
      });
      afterCommit = cancelled.afterCommit;
      const stillActive = segments.filter((s) => s.status !== OrderVendorSegmentStatus.CANCELLED).map((s) => s.id);
      if (stillActive.length > 0) {
        await manager.createQueryBuilder().update(OrderVendorSegment).set({ status: OrderVendorSegmentStatus.CANCELLED }).where('id IN (:...ids)', { ids: stillActive }).execute();
      }
    });
    await afterCommit!();
    return this.cancellationOutcome(orderId);
  }

  /** What the cancellation did to the money — read back from the ledgers, never computed here. */
  async cancellationOutcome(orderId: string) {
    const [order] = await this.ds.query(`SELECT id, order_number, status, payment_method, total_minor, cancellation_reason, cancelled_by_role FROM orders WHERE id = $1`, [orderId]);
    const [payment] = await this.ds.query(`SELECT status, method, amount_minor, pending_refund_minor, pending_refund_status FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`, [orderId]);
    const [wallet] = await this.ds.query(`SELECT coalesce(sum(amount_delta_minor), 0)::bigint AS refunded FROM wallet_transactions WHERE order_id = $1 AND type = 'ORDER_REFUND'`, [orderId]);
    const [fin] = await this.ds.query(
      `SELECT coalesce(sum(amount_minor) FILTER (WHERE type = 'MANUAL_TRANSFER_REFUND_RECORDED'), 0)::bigint AS transfer_refund,
              coalesce(sum(amount_minor) FILTER (WHERE type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'), 0)::bigint AS discount_restored
         FROM financial_events WHERE order_id = $1`,
      [orderId],
    );
    const [coupons] = await this.ds.query(`SELECT count(*) FILTER (WHERE is_reversed)::int AS reversed, count(*)::int AS total FROM offer_consumptions WHERE order_id = $1`, [orderId]);
    return {
      orderId, orderNumber: order.order_number, status: order.status, cancelledByRole: order.cancelled_by_role, cancellationReason: order.cancellation_reason,
      money: {
        walletRefundedMinor: num(wallet.refunded), transferRefundRecordedMinor: num(fin.transfer_refund), pendingRefundMinor: num(payment?.pending_refund_minor), pendingRefundStatus: payment?.pending_refund_status ?? null,
        hatlyFundedDiscountRestoredMinor: num(fin.discount_restored), offerConsumptionsReversed: coupons.reversed, offerConsumptions: coupons.total,
        paymentMethod: order.payment_method, paymentStatus: payment?.status ?? null,
      },
    };
  }

  async adminCanCancel(orderId: string): Promise<boolean> {
    const [o] = await this.ds.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
    return Boolean(o && ADMIN_CANCELLABLE_STATUSES.includes(o.status));
  }

  // ---------------------------------------------------------------- notes

  async notes(orderId: string) {
    assertUuid(orderId, 'orderId');
    const rows = await this.ds.query(
      `SELECT n.id, n.body, n.created_at, n.author_user_id, u.full_name FROM order_notes n JOIN users u ON u.id = n.author_user_id WHERE n.order_id = $1 ORDER BY n.created_at DESC, n.id DESC`,
      [orderId],
    );
    return rows.map((r: any) => ({ id: r.id, body: r.body, createdAt: new Date(r.created_at).toISOString(), authorId: r.author_user_id, authorName: r.full_name }));
  }

  async addNote(orderId: string, body: string, authorId: string) {
    assertUuid(orderId, 'orderId');
    const text = (body ?? '').trim();
    if (!text || text.length > 1000) throw new BadRequestException({ message: 'A note must be 1–1000 characters.', details: { code: 'VALIDATION_FAILED' } });
    const [order] = await this.ds.query(`SELECT 1 FROM orders WHERE id = $1`, [orderId]);
    if (!order) throw new NotFoundException('Order not found.');
    const [row] = await this.ds.query(`INSERT INTO order_notes (order_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING id, created_at`, [orderId, authorId, text]);
    return { id: row.id, createdAt: new Date(row.created_at).toISOString() };
  }

  // ---------------------------------------------------------------- timeline

  /** One merged, chronological timeline of everything that happened to the order. Amounts only with financial access. */
  async timeline(orderId: string, includeFinancial: boolean) {
    assertUuid(orderId, 'orderId');
    const [order] = await this.ds.query(`SELECT id FROM orders WHERE id = $1`, [orderId]);
    if (!order) throw new NotFoundException('Order not found.');
    const rows = await this.ds.query(
      `SELECT * FROM (
         SELECT e.created_at AS at, 'STATUS' AS kind, e.to_status AS title, e.from_status AS detail, e.actor_role, u.full_name AS actor_name, NULL::bigint AS amount, false AS on_behalf, e.id::text AS ref
           FROM order_status_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.order_id = $1
         UNION ALL
         SELECT g.created_at, 'SEGMENT', g.to_status, coalesce(g.reason, g.from_status), g.actor_role, u.full_name, NULL, g.on_behalf_of_vendor, g.id::text
           FROM order_vendor_segment_events g LEFT JOIN users u ON u.id = g.actor_user_id WHERE g.order_id = $1
         UNION ALL
         SELECT f.created_at, 'FINANCIAL', f.type, f.reason, NULL, NULL, ${includeFinancial ? 'f.amount_minor' : 'NULL::bigint'}, false, f.id::text FROM financial_events f WHERE f.order_id = $1
         UNION ALL
         SELECT d.created_at, 'DISPATCH', d.outcome, d.detail, NULL, NULL, NULL, false, d.id::text FROM dispatch_attempts d WHERE d.order_id = $1
         UNION ALL
         SELECT p.claimed_at, 'PAYMENT', 'CUSTOMER_CLAIMED_TRANSFER', p.method, NULL, NULL, ${includeFinancial ? 'p.amount_minor' : 'NULL::bigint'}, false, p.id::text FROM payments p WHERE p.order_id = $1 AND p.claimed_at IS NOT NULL
         UNION ALL
         SELECT p.verified_at, 'PAYMENT', p.status, p.rejection_reason, NULL, v.full_name, ${includeFinancial ? 'p.amount_minor' : 'NULL::bigint'}, false, p.id::text || ':v'
           FROM payments p LEFT JOIN users v ON v.id = p.verified_by_user_id WHERE p.order_id = $1 AND p.verified_at IS NOT NULL
         UNION ALL
         SELECT rp.created_at, 'REFUND_SENT', 'REFUND_MARKED_SENT', rp.note, NULL, s.full_name, NULL, false, rp.id::text
           FROM refund_payouts rp JOIN financial_events fe ON fe.id = rp.financial_event_id LEFT JOIN users s ON s.id = rp.sent_by_user_id WHERE fe.order_id = $1
         UNION ALL
         SELECT x.created_at, 'EXCEPTION', x.action, x.note, x.actor_role, a.full_name, NULL, false, x.id::text FROM order_exception_events x JOIN order_exceptions ex ON ex.id = x.exception_id LEFT JOIN users a ON a.id = x.actor_user_id WHERE ex.order_id = $1
         UNION ALL
         SELECT n.created_at, 'NOTE', 'NOTE', n.body, NULL, a.full_name, NULL, false, n.id::text FROM order_notes n JOIN users a ON a.id = n.author_user_id WHERE n.order_id = $1
       ) t WHERE t.at IS NOT NULL ORDER BY t.at, t.ref`,
      [orderId],
    );
    return rows.map((r: any) => ({ at: new Date(r.at).toISOString(), kind: r.kind, title: r.title, detail: r.detail, actorRole: r.actor_role, actorName: r.actor_name, amountMinor: r.amount === null ? null : num(r.amount), onBehalfOfVendor: r.on_behalf, ref: r.ref }));
  }
}
