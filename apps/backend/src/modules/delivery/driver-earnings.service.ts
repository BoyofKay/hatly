import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DriverAuthorizationService } from './driver-authorization.service';
import { SettlementClosingService } from '../finance/settlement-closing.service';
import { derivePaymentStatus, driverPeriodDue, remainingMinor } from '../admin-platform/finance/settlement-status';

const CAIRO = 'Africa/Cairo';
const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/**
 * What a driver sees about their own deliveries and money (Driver App: Home, Earnings, History).
 *
 * SINGLE SOURCE OF TRUTH (2026-11-13): every amount comes from SettlementClosingService — the very preview the Admin courier closing shows
 * and the lines a closing stores — computed by courier-settlement-math.ts with COD and electronic orders kept apart:
 *   COD        → goods collected and paid to the store are pass-through (excluded); the courier keeps the delivery-fee cash, so he owes
 *                Hatly its commission (net −commission for an all-cash order);
 *   electronic → Hatly owes the courier the goods he paid the store + the fee − Hatly's commission.
 * Nothing here defines a formula. The app shows these numbers; it never recomputes them.
 *
 * HISTORY is the driver's real delivered orders (deliveries + order status), NOT financial events: a delivery whose money cannot be
 * computed yet (e.g. the driver has no commission rate — R43) still appears, marked "excluded" with the reason, instead of vanishing.
 *
 * Backward compatible (R38): every field the earlier app reads keeps its name and stays a number; new fields are additive. Periods closed
 * before 2026-11-13 (method 1) are shown exactly as stored and marked legacy — never recomputed.
 */
@Injectable()
export class DriverEarningsService {
  constructor(
    private readonly ds: DataSource,
    private readonly auth: DriverAuthorizationService,
    private readonly closing: SettlementClosingService,
  ) {}

  async summary(userId: string) {
    const driver = await this.auth.getDriverForUser(userId);
    const preview = await this.closing.courierPreview(driver.id);
    const t = preview.totals;
    const excluded = preview.unresolved.filter((u) => u.reason !== 'IN_PROGRESS');
    const open = {
      // since the previous closing (or the first eligible delivery) — the register-default shift window
      periodStart: preview.previousClosing?.periodEnd ?? preview.lines.map((l) => l.deliveredAt).filter(Boolean).sort()[0] ?? null,
      deliveries: t.orders,
      // legacy names (older apps): fee entitlement, commission, goods Hatly owes back, net
      earningsMinor: t.feeEntitlementMinor,
      commissionMinor: t.commissionMinor,
      reimbursementsMinor: t.goodsReimbursementMinor,
      netMinor: t.netToCourierMinor,
      methodVersion: 2,
      breakdown: t,
      direction: t.netToCourierMinor >= 0 ? 'PAYOUT' : 'COLLECTION',
      excluded: excluded.map((u) => ({ orderId: u.orderId, orderNumber: u.orderNumber, reason: u.reason })),
      inProgress: preview.unresolved.filter((u) => u.reason === 'IN_PROGRESS').length,
    };

    const [today] = await this.ds.query(
      `SELECT count(*)::int AS n FROM deliveries d JOIN orders o ON o.id = d.order_id
        WHERE d.driver_id = $1 AND d.deleted_at IS NULL AND o.status = 'DELIVERED' AND d.delivered_at IS NOT NULL
          AND (d.delivered_at AT TIME ZONE '${CAIRO}')::date = (now() AT TIME ZONE '${CAIRO}')::date`,
      [driver.id],
    );
    const [freq] = await this.ds.query(`SELECT frequency FROM driver_settlement_periods WHERE driver_id = $1 ORDER BY period_end DESC LIMIT 1`, [driver.id]);

    const periods = await this.ds.query(
      `SELECT p.*,
              (SELECT coalesce(json_agg(json_build_object('direction', s.direction, 'amountMinor', s.amount_minor, 'method', s.method, 'paidOn', s.paid_on, 'status', s.status) ORDER BY s.paid_on), '[]'::json) FROM settlement_payments s WHERE s.driver_period_id = p.id) AS payments,
              coalesce((SELECT sum(s.amount_minor) FROM settlement_payments s WHERE s.driver_period_id = p.id AND s.status = 'RECORDED'), 0) AS settled
         FROM driver_settlement_periods p WHERE p.driver_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL ORDER BY p.period_end DESC LIMIT 12`,
      [driver.id],
    );
    return {
      open,
      deliveredToday: today.n,
      lastClosedFrequency: freq?.frequency ?? null,
      closedPeriods: periods.map((p: any) => {
        const v2 = Number(p.method_version ?? 1) === 2;
        const due = driverPeriodDue(num(p.net_payable_minor));
        const settled = num(p.settled);
        return {
          id: p.id, frequency: p.frequency, periodStart: p.period_start, periodEnd: p.period_end, closedAt: p.closed_at,
          earningsMinor: num(p.total_earnings_minor), commissionMinor: num(p.total_commission_owed_minor),
          reimbursementsMinor: num(p.total_reimbursements_owed_minor), netMinor: num(p.net_payable_minor),
          payments: (p.payments ?? []).map((x: any) => ({ ...x, amountMinor: num(x.amountMinor) })),
          // additive
          reference: p.reference ?? null,
          methodVersion: v2 ? 2 : 1,
          orders: p.orders_count ?? null,
          breakdown: v2
            ? {
                feeEntitlementMinor: num(p.fee_entitlement_minor), commissionMinor: num(p.total_commission_owed_minor), courierCompensationMinor: num(p.courier_compensation_minor),
                goodsPaidToStoresMinor: num(p.goods_paid_to_stores_minor), goodsPassThroughMinor: num(p.goods_pass_through_minor), goodsReimbursementMinor: num(p.goods_reimbursement_minor),
                cashCollectedMinor: num(p.cash_collected_minor), cashHeldMinor: num(p.cash_held_minor), changeKeptMinor: num(p.change_kept_minor), netToCourierMinor: num(p.net_payable_minor),
              }
            : null,
          direction: due.direction, dueMinor: due.dueMinor, settledMinor: settled, remainingMinor: remainingMinor(due.dueMinor, settled), paymentStatus: derivePaymentStatus(due.dueMinor, settled),
        };
      }),
      note: 'The open period is the preview of what the next Hatly closing will settle; it becomes final when Operations close it.',
    };
  }

  /** The driver's delivered orders, newest delivery first (paginated), each with its money state. Never another driver's orders. */
  async transactions(userId: string, q: { page?: string; limit?: string }) {
    const driver = await this.auth.getDriverForUser(userId);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const where = `d.driver_id = $1 AND d.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status = 'DELIVERED'`;
    const [tot] = await this.ds.query(`SELECT count(*)::int AS n FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE ${where}`, [driver.id]);
    const rows: any[] = await this.ds.query(
      `SELECT o.id AS order_id, d.id AS delivery_id, o.order_number, o.status, o.payment_method, o.amount_due_minor, o.total_minor,
              coalesce(d.delivered_at, (SELECT max(se.created_at) FROM order_status_events se WHERE se.order_id = o.id AND se.to_status = 'DELIVERED'), o.updated_at) AS delivered_at,
              (SELECT string_agg(DISTINCT v.name, ' · ') FROM order_vendor_segments s JOIN vendor_branches b ON b.id = s.vendor_branch_id JOIN vendors v ON v.id = b.vendor_id
                WHERE s.order_id = o.id AND s.deleted_at IS NULL AND s.status <> 'CANCELLED') AS vendors
         FROM deliveries d JOIN orders o ON o.id = d.order_id
        WHERE ${where}
        ORDER BY 8 DESC NULLS LAST, o.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      [driver.id],
    );
    const states = await this.closing.courierOrderStates(driver.id, rows.map((r) => r.order_id));
    return {
      items: rows.map((r) => {
        const st = states.get(r.order_id)!;
        const l = (st.line ?? {}) as Record<string, number>;
        return {
          // legacy fields (older apps read these as numbers)
          id: r.order_id, at: iso(r.delivered_at), orderId: r.order_id, orderNumber: r.order_number, orderStatus: r.status, paymentMethod: r.payment_method,
          cashDueAtDoorMinor: r.payment_method === 'COD' ? num(r.amount_due_minor) : null,
          earningsMinor: num(l.feeEntitlementMinor), commissionMinor: num(l.commissionMinor), reimbursementMinor: num(l.goodsReimbursementMinor), netMinor: num(l.netToCourierMinor),
          // additive
          deliveryId: r.delivery_id, deliveredAt: iso(r.delivered_at), vendors: r.vendors ?? null, orderTotalMinor: num(r.total_minor),
          settlementState: st.state, settlementReference: st.reference ?? null, settledAt: st.closedAt ?? null, excludedReason: st.reason ?? null,
          breakdown: st.line ?? null,
        };
      }),
      page, limit, total: tot.n,
    };
  }
}
