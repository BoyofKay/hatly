import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DriverAuthorizationService } from './driver-authorization.service';
import { SettlementClosingService } from '../finance/settlement-closing.service';
import { DriverAllowanceService } from '../finance/driver-allowance.service';
import { derivePaymentStatus, driverPeriodDue, remainingMinor } from '../admin-platform/finance/settlement-status';

const CAIRO = 'Africa/Cairo';
const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type OrdersTab = 'today' | 'previous';
export type EarningsTab = 'current' | 'previous';
type OrderStatusFilter = 'completed' | 'cancelled' | 'failed' | 'active';

/** Cairo dates of the current week (Saturday → Friday, the Egyptian work week) — the default range of the "Previous" tabs. */
export function currentCairoWeek(now = new Date()): { from: string; to: string } {
  const cairo = new Date(now.toLocaleString('en-US', { timeZone: CAIRO }));
  const back = (cairo.getDay() + 1) % 7; // days since Saturday (Sat=6 → 0)
  const start = new Date(cairo);
  start.setDate(cairo.getDate() - back);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(start), to: f(end) };
}

/**
 * Driver app round 2 (owner decision 2026-11-22): the driver's Orders and Earnings tabs.
 *
 * ORDERS — "Today" = what belongs to the current, not-yet-closed shift: orders still with the driver, plus delivered / cancelled / failed
 * orders since his last closing that are not in a closing. When the courier closing runs they move to "Previous" (settled), which defaults
 * to the current week and filters by dates, status and a search (order number or store name). KPIs for the same window: completed,
 * cancelled, ignored (an assignment he did not acknowledge in time — Operations were alerted), and accepted vs ignored.
 *
 * EARNINGS — "Current shift" = the preview of his next closing (the same figures the office sees): cash in pocket, revenue (his earnings
 * after Hatly's commission), loan, daily allowance, balance (what changes hands at the closing) and unsettled orders, with one row per
 * delivered order. "Previous" = his closings in the date range (default this week): revenue, orders and time worked (from the shift
 * records), one row per closing. Nothing here defines money: every amount is SettlementClosingService's or a stored closing's.
 */
@Injectable()
export class DriverOverviewService {
  constructor(
    private readonly ds: DataSource,
    private readonly auth: DriverAuthorizationService,
    private readonly closing: SettlementClosingService,
  ) {}

  private range(q: { from?: string; to?: string }): { from: string; to: string } {
    const week = currentCairoWeek();
    const from = q.from && DATE.test(q.from) ? q.from : week.from;
    const to = q.to && DATE.test(q.to) ? q.to : week.to;
    if (from > to) throw new BadRequestException({ message: 'The start date is after the end date.', details: { code: 'INVALID_DATE_RANGE' } });
    return { from, to };
  }

  private async lastClosingEnd(driverId: string): Promise<string | null> {
    const [r] = await this.ds.query(
      `SELECT max(period_end) AS e FROM driver_settlement_periods WHERE driver_id = $1 AND status = 'CLOSED' AND deleted_at IS NULL`,
      [driverId],
    );
    return r?.e ? new Date(r.e).toISOString() : null;
  }

  async orders(userId: string, q: { tab?: string; from?: string; to?: string; status?: string; q?: string; page?: string; limit?: string }) {
    const driver = await this.auth.getDriverForUser(userId);
    const tab: OrdersTab = q.tab === 'previous' ? 'previous' : 'today';
    const status = (['completed', 'cancelled', 'failed', 'active'] as const).includes(q.status as OrderStatusFilter) ? (q.status as OrderStatusFilter) : null;
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const lastEnd = await this.lastClosingEnd(driver.id);
    const range = tab === 'previous' ? this.range(q) : null;

    const params: unknown[] = [driver.id, lastEnd];
    const at = `coalesce(d.delivered_at, o.updated_at)`;
    const settled = `EXISTS (SELECT 1 FROM driver_settlement_period_orders so WHERE so.order_id = o.id)`;
    const active = `o.status::text NOT IN ('DELIVERED','CANCELLED','FAILED_DELIVERY','RETURNED')`;
    // Today: still with him, or finished since his last closing and not settled. Previous: everything else (settled, or finished before it).
    const todaySet = `(${active} OR (NOT ${settled} AND ($2::timestamptz IS NULL OR ${at} > $2::timestamptz OR o.status::text = 'DELIVERED')))`;
    const where = [`d.driver_id = $1`, `d.deleted_at IS NULL`, `o.deleted_at IS NULL`, tab === 'today' ? todaySet : `NOT ${todaySet}`];
    if (range) {
      params.push(range.from, range.to);
      where.push(`(${at} AT TIME ZONE '${CAIRO}')::date BETWEEN $3::date AND $4::date`);
    }
    if (status) {
      const map: Record<OrderStatusFilter, string> = {
        completed: `o.status::text = 'DELIVERED'`,
        cancelled: `o.status::text = 'CANCELLED'`,
        failed: `o.status::text IN ('FAILED_DELIVERY','RETURNED')`,
        active,
      };
      where.push(map[status]);
    }
    const search = (q.q ?? '').trim().slice(0, 60);
    if (search) {
      params.push(`%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
      const i = params.length;
      where.push(`(o.order_number ILIKE $${i} OR EXISTS (SELECT 1 FROM order_vendor_segments s JOIN vendor_branches b ON b.id = s.vendor_branch_id JOIN vendors v ON v.id = b.vendor_id
                     WHERE s.order_id = o.id AND (v.name ILIKE $${i} OR v.name_ar ILIKE $${i})))`);
    }
    const base = `FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE ${where.join(' AND ')}`;
    const [tot] = await this.ds.query(`SELECT count(*)::int AS n ${base}`, params);
    const rows: any[] = await this.ds.query(
      `SELECT d.id AS delivery_id, o.id AS order_id, o.order_number, o.status::text AS status, o.payment_method::text AS payment_method, ${at} AS at, d.assigned_at,
              (SELECT string_agg(DISTINCT v.name, ' · ') FROM order_vendor_segments s JOIN vendor_branches b ON b.id = s.vendor_branch_id JOIN vendors v ON v.id = b.vendor_id
                WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS vendors
         ${base} ORDER BY ${at} DESC NULLS LAST, o.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    const states = await this.closing.courierOrderStates(driver.id, rows.filter((r) => r.status === 'DELIVERED').map((r) => r.order_id));

    // KPIs over the whole window (not the page), ignoring search/status so the numbers describe the shift / the range.
    const kWhere = [`d.driver_id = $1`, `d.deleted_at IS NULL`, `o.deleted_at IS NULL`, tab === 'today' ? todaySet : `NOT ${todaySet}`];
    const kParams: unknown[] = [driver.id, lastEnd];
    if (range) {
      kParams.push(range.from, range.to);
      kWhere.push(`(${at} AT TIME ZONE '${CAIRO}')::date BETWEEN $3::date AND $4::date`);
    }
    const [k] = await this.ds.query(
      `SELECT count(*) FILTER (WHERE o.status::text = 'DELIVERED')::int AS completed,
              count(*) FILTER (WHERE o.status::text = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE d.acknowledged_at IS NOT NULL)::int AS accepted
         FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE ${kWhere.join(' AND ')}`,
      kParams,
    );
    const ignoredWindow = range
      ? { sql: `(a.created_at AT TIME ZONE '${CAIRO}')::date BETWEEN $2::date AND $3::date`, params: [driver.id, range.from, range.to] }
      : { sql: `($2::timestamptz IS NULL OR a.created_at > $2::timestamptz)`, params: [driver.id, lastEnd] };
    const [ig] = await this.ds.query(
      `SELECT count(DISTINCT a.order_id)::int AS n FROM dispatch_attempts a WHERE a.driver_id = $1 AND a.outcome = 'ACKNOWLEDGEMENT_OVERDUE' AND ${ignoredWindow.sql}`,
      ignoredWindow.params,
    );
    const ignored = num(ig?.n);
    const accepted = num(k?.accepted);
    return {
      tab,
      range,
      kpis: {
        completed: num(k?.completed),
        cancelled: num(k?.cancelled),
        ignored,
        accepted,
        // share of the offers he answered: accepted ÷ (accepted + ignored); null when there was nothing to answer
        acceptanceRatePercent: accepted + ignored > 0 ? Math.round((accepted * 100) / (accepted + ignored)) : null,
      },
      items: rows.map((r) => {
        const st = states.get(r.order_id);
        const line = (st?.line ?? null) as Record<string, number> | null;
        return {
          deliveryId: r.delivery_id,
          orderId: r.order_id,
          orderNumber: r.order_number,
          status: r.status,
          paymentMethod: r.payment_method,
          vendors: r.vendors ?? null,
          at: iso(r.at),
          earnedMinor: line ? num(line.courierCompensationMinor) : null,
          settlementState: st?.state ?? null,
          settlementReference: st?.reference ?? null,
        };
      }),
      page,
      limit,
      total: num(tot?.n),
    };
  }

  async earnings(userId: string, q: { tab?: string; from?: string; to?: string; status?: string }) {
    const driver = await this.auth.getDriverForUser(userId);
    if (q.tab === 'previous') return this.previousEarnings(driver.id, q);

    const p = await this.closing.courierPreview(driver.id);
    const t = p.totals;
    const allowanceMinor = await DriverAllowanceService.outstandingMinor(this.ds, driver.id);
    const balanceMinor = t.netToCourierMinor - allowanceMinor;
    const [shift] = await this.ds.query(`SELECT started_at FROM driver_shifts WHERE driver_id = $1 AND ended_at IS NULL`, [driver.id]);
    const held = p.unresolved.filter((u) => u.reason !== 'IN_PROGRESS');
    return {
      tab: 'current' as const,
      shiftStartedAt: iso(shift?.started_at),
      kpis: {
        cashInPocketMinor: t.cashHeldMinor,
        revenueMinor: t.courierCompensationMinor,
        loanMinor: p.loans.outstandingMinor,
        allowanceMinor,
        // + Hatly pays him at the closing, − he hands this over (orders' net minus the allowance he returns)
        balanceMinor,
        balanceDirection: balanceMinor >= 0 ? 'PAYOUT' : 'COLLECTION',
        unsettledOrders: p.lines.length + held.length,
      },
      items: p.lines.map((l) => ({
        orderId: l.orderId,
        orderNumber: l.orderNumber,
        deliveredAt: l.deliveredAt,
        paymentMethod: l.paymentMethod,
        earnedMinor: l.courierCompensationMinor,
        netMinor: l.netToCourierMinor,
        breakdown: Object.fromEntries(
          ['feeEntitlementMinor', 'commissionMinor', 'courierCompensationMinor', 'goodsPaidToStoresMinor', 'goodsPassThroughMinor', 'goodsReimbursementMinor', 'cashCollectedMinor', 'cashHeldMinor', 'changeKeptMinor', 'netToCourierMinor'].map(
            (k) => [k, num((l as unknown as Record<string, number>)[k])],
          ),
        ),
      })),
      held: held.map((u) => ({ orderId: u.orderId, orderNumber: u.orderNumber, reason: u.reason })),
    };
  }

  private async previousEarnings(driverId: string, q: { from?: string; to?: string; status?: string }) {
    const range = this.range(q);
    const periods: any[] = await this.ds.query(
      `SELECT p.*, coalesce((SELECT sum(s.amount_minor) FROM settlement_payments s WHERE s.driver_period_id = p.id AND s.status = 'RECORDED'), 0) AS settled,
              coalesce((SELECT sum(greatest(0, extract(epoch FROM (coalesce(sh.ended_at, now()) - sh.started_at)) / 60))::int FROM driver_shifts sh WHERE sh.closing_period_id = p.id), 0) AS minutes,
              coalesce((SELECT sum(a.amount_minor) FROM driver_allowances a WHERE a.closing_period_id = p.id), 0) AS allowance_returned
         FROM driver_settlement_periods p
        WHERE p.driver_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL
          AND (p.closed_at AT TIME ZONE '${CAIRO}')::date BETWEEN $2::date AND $3::date
        ORDER BY p.closed_at DESC LIMIT 100`,
      [driverId, range.from, range.to],
    );
    let items = periods.map((p) => {
      const due = driverPeriodDue(num(p.net_payable_minor));
      const settled = num(p.settled);
      const v2 = Number(p.method_version ?? 1) === 2;
      return {
        id: p.id,
        reference: p.reference ?? null,
        closedAt: iso(p.closed_at),
        orders: num(p.orders_count),
        minutesWorked: num(p.minutes),
        revenueMinor: v2 ? num(p.courier_compensation_minor) : num(p.total_earnings_minor) - num(p.total_commission_owed_minor),
        netMinor: num(p.net_payable_minor),
        allowanceReturnedMinor: num(p.allowance_returned),
        direction: due.direction,
        remainingMinor: remainingMinor(due.dueMinor, settled),
        paymentStatus: derivePaymentStatus(due.dueMinor, settled),
        breakdown: v2
          ? {
              feeEntitlementMinor: num(p.fee_entitlement_minor), commissionMinor: num(p.total_commission_owed_minor), courierCompensationMinor: num(p.courier_compensation_minor),
              goodsPaidToStoresMinor: num(p.goods_paid_to_stores_minor), goodsPassThroughMinor: num(p.goods_pass_through_minor), goodsReimbursementMinor: num(p.goods_reimbursement_minor),
              cashCollectedMinor: num(p.cash_collected_minor), cashHeldMinor: num(p.cash_held_minor), changeKeptMinor: num(p.change_kept_minor), netToCourierMinor: num(p.net_payable_minor),
            }
          : null,
      };
    });
    if (q.status === 'paid') items = items.filter((i) => i.paymentStatus === 'PAID' || i.remainingMinor === 0);
    if (q.status === 'unpaid') items = items.filter((i) => i.remainingMinor > 0);
    return {
      tab: 'previous' as const,
      range,
      kpis: {
        revenueMinor: items.reduce((s, i) => s + i.revenueMinor, 0),
        orders: items.reduce((s, i) => s + i.orders, 0),
        minutesWorked: items.reduce((s, i) => s + i.minutesWorked, 0),
      },
      items,
    };
  }
}
