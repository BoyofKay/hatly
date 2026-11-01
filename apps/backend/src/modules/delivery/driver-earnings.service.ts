import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DriverAuthorizationService } from './driver-authorization.service';

const CAIRO = 'Africa/Cairo';
const num = (v: unknown) => (v == null ? 0 : Number(v));

/**
 * What a driver sees about their own money — only what the platform has RECORDED, computed with the very formulas the settlement close already
 * uses (nothing new is defined here):
 *   earnings      = Σ the base amount stored on each recognised DRIVER_COMMISSION event,
 *   commission    = Σ those events' amounts (what Hatly keeps),
 *   reimbursement = Σ DRIVER_REIMBURSEMENT_OWED events,
 *   net           = earnings − commission + reimbursements.
 * The "open period" is everything since the last CLOSED settlement period; it is a preview until an Admin closes it. Closed periods and the
 * payments recorded against them are shown exactly as stored. Cash the driver collects from customers is shown per delivery as a fact (the
 * amount due at the door) — there is no "cash in hand" balance because no remittance rule exists to subtract from it.
 */
@Injectable()
export class DriverEarningsService {
  constructor(
    private readonly ds: DataSource,
    private readonly auth: DriverAuthorizationService,
  ) {}

  async summary(userId: string) {
    const driver = await this.auth.getDriverForUser(userId);
    const [last] = await this.ds.query(`SELECT period_end FROM driver_settlement_periods WHERE driver_id = $1 AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1`, [driver.id]);
    const [first] = await this.ds.query(`SELECT min(created_at) AS at FROM financial_events WHERE driver_id = $1`, [driver.id]);
    const start: Date | null = last?.period_end ?? first?.at ?? null;

    let open = { periodStart: null as string | null, deliveries: 0, earningsMinor: 0, commissionMinor: 0, reimbursementsMinor: 0, netMinor: 0 };
    if (start) {
      const [a] = await this.ds.query(
        `SELECT count(DISTINCT order_id) FILTER (WHERE type = 'DRIVER_COMMISSION_RECOGNIZED')::int AS deliveries,
                coalesce(sum((rate_snapshot->>'baseAmountMinor')::bigint) FILTER (WHERE type = 'DRIVER_COMMISSION_RECOGNIZED'), 0) AS earnings,
                coalesce(sum(amount_minor) FILTER (WHERE type = 'DRIVER_COMMISSION_RECOGNIZED'), 0) AS commission,
                coalesce(sum(amount_minor) FILTER (WHERE type = 'DRIVER_REIMBURSEMENT_OWED'), 0) AS reimbursements
           FROM financial_events WHERE driver_id = $1 AND created_at >= $2 AND deleted_at IS NULL`,
        [driver.id, start],
      );
      const earnings = num(a.earnings), commission = num(a.commission), reimbursements = num(a.reimbursements);
      open = { periodStart: new Date(start).toISOString(), deliveries: a.deliveries, earningsMinor: earnings, commissionMinor: commission, reimbursementsMinor: reimbursements, netMinor: earnings - commission + reimbursements };
    }

    const [today] = await this.ds.query(`SELECT count(*)::int AS n FROM deliveries WHERE driver_id = $1 AND delivered_at IS NOT NULL AND (delivered_at AT TIME ZONE '${CAIRO}')::date = (now() AT TIME ZONE '${CAIRO}')::date AND deleted_at IS NULL`, [driver.id]);
    const [freq] = await this.ds.query(`SELECT frequency FROM driver_settlement_periods WHERE driver_id = $1 ORDER BY period_end DESC LIMIT 1`, [driver.id]);

    const periods = await this.ds.query(
      `SELECT p.id, p.frequency, p.period_start, p.period_end, p.total_earnings_minor, p.total_commission_owed_minor, p.total_reimbursements_owed_minor, p.net_payable_minor, p.closed_at,
              (SELECT coalesce(json_agg(json_build_object('direction', s.direction, 'amountMinor', s.amount_minor, 'method', s.method, 'paidOn', s.paid_on, 'status', s.status) ORDER BY s.paid_on), '[]'::json) FROM settlement_payments s WHERE s.driver_period_id = p.id) AS payments
         FROM driver_settlement_periods p WHERE p.driver_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL ORDER BY p.period_end DESC LIMIT 12`,
      [driver.id],
    );
    return {
      open,
      deliveredToday: today.n,
      lastClosedFrequency: freq?.frequency ?? null,
      closedPeriods: periods.map((p: any) => ({
        id: p.id, frequency: p.frequency, periodStart: p.period_start, periodEnd: p.period_end, earningsMinor: num(p.total_earnings_minor), commissionMinor: num(p.total_commission_owed_minor),
        reimbursementsMinor: num(p.total_reimbursements_owed_minor), netMinor: num(p.net_payable_minor), closedAt: p.closed_at,
        payments: (p.payments ?? []).map((x: any) => ({ ...x, amountMinor: num(x.amountMinor) })),
      })),
      note: 'The open period is a preview of what the platform has recorded since the last closed period; it becomes final when Hatly closes it.',
    };
  }

  /** One row per delivery the driver has been credited for, newest first. */
  async transactions(userId: string, q: { page?: string; limit?: string }) {
    const driver = await this.auth.getDriverForUser(userId);
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const [tot] = await this.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE driver_id = $1 AND type = 'DRIVER_COMMISSION_RECOGNIZED' AND deleted_at IS NULL`, [driver.id]);
    const rows = await this.ds.query(
      `SELECT e.id, e.created_at, o.id AS order_id, o.order_number, o.payment_method, o.amount_due_minor, o.status AS order_status,
              coalesce((e.rate_snapshot->>'baseAmountMinor')::bigint, 0) AS earnings, e.amount_minor AS commission,
              (SELECT coalesce(sum(r.amount_minor), 0) FROM financial_events r WHERE r.driver_id = e.driver_id AND r.order_id = e.order_id AND r.type = 'DRIVER_REIMBURSEMENT_OWED' AND r.deleted_at IS NULL) AS reimbursement
         FROM financial_events e JOIN orders o ON o.id = e.order_id
        WHERE e.driver_id = $1 AND e.type = 'DRIVER_COMMISSION_RECOGNIZED' AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC, e.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      [driver.id],
    );
    return {
      items: rows.map((r: any) => ({
        id: r.id, at: r.created_at, orderId: r.order_id, orderNumber: r.order_number, orderStatus: r.order_status, paymentMethod: r.payment_method,
        // What the customer owed at the door for a cash order — a fact about the delivery, not a balance.
        cashDueAtDoorMinor: r.payment_method === 'COD' ? num(r.amount_due_minor) : null,
        earningsMinor: num(r.earnings), commissionMinor: num(r.commission), reimbursementMinor: num(r.reimbursement),
        netMinor: num(r.earnings) - num(r.commission) + num(r.reimbursement),
      })),
      page, limit, total: tot.n,
    };
  }
}
