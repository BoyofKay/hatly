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
type OrderStatusFilter = 'completed' | 'cancelled' | 'failed' | 'active' | 'acknowledge' | 'ready' | 'on_way';

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

  async orders(userId: string, q: { tab?: string; from?: string; to?: string; status?: string; q?: string; page?: string; limit?: string }) {
    const driver = await this.auth.getDriverForUser(userId);
    const tab: OrdersTab = q.tab === 'previous' ? 'previous' : 'today';
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const limit = Math.min(50, Math.max(1, Math.floor(Number(q.limit) || 20)));
    const range = tab === 'previous' ? this.range(q) : null;
    const params: unknown[] = [driver.id];
    const scope = tab === 'today' ? 'sh.ended_at IS NULL AND sh.id IS NOT NULL' : 'sh.ended_at IS NOT NULL';
    // An order may be offered repeatedly in one shift. Choose the latest recorded assignment in
    // that shift; the immutable attempt records remain available for future dispatch analytics.
    const cte = `WITH scoped AS (
      SELECT DISTINCT ON (a.shift_id,a.order_id) a.*, coalesce(a.concluded_at,a.assigned_at) AS at
      FROM driver_shift_assignments a JOIN driver_shifts sh ON sh.id=a.shift_id JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
      WHERE a.driver_id=$1 AND ${scope}
      ORDER BY a.shift_id,a.order_id,a.assigned_at DESC,a.id DESC
    ), selected AS (
      SELECT a.* FROM scoped a
      ${range ? "WHERE (a.at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date" : ''}
    )`;
    if (range) params.push(range.from, range.to);
    const active = "a.concluded_at IS NULL AND a.status NOT IN ('DELIVERED','CANCELLED','FAILED_DELIVERY','REASSIGNED','COLLECTED')";
    const ack = `(${active} AND a.acknowledged_at IS NULL)`;
    const ready = `(${active} AND a.status IN ('READY_FOR_PICKUP','ASSIGNED_TO_DRIVER'))`;
    const onWay = `(${active} AND a.status IN ('PICKED_UP','ON_THE_WAY'))`;
    const map: Record<OrderStatusFilter,string> = {
      completed: "a.status='DELIVERED'", cancelled: "a.status='CANCELLED'", failed: "a.status='FAILED_DELIVERY'",
      active, acknowledge: ack, ready, on_way: onWay,
    };
    const [k] = await this.ds.query(`${cte}
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE ${map.completed})::int AS completed,
        count(*) FILTER (WHERE ${map.cancelled})::int AS cancelled,
        count(*) FILTER (WHERE ${map.failed})::int AS failed,
        count(*) FILTER (WHERE ${ack})::int AS acknowledge,
        count(*) FILTER (WHERE ${ready})::int AS ready,
        count(*) FILTER (WHERE ${onWay})::int AS on_way
      FROM selected a`,params);
    const where = ['o.deleted_at IS NULL'];
    if (q.status && Object.prototype.hasOwnProperty.call(map,q.status)) where.push(map[q.status as OrderStatusFilter]);
    const search = (q.q ?? '').trim().slice(0,60);
    if (search) {
      params.push('%' + search.replace(/[%_\\]/g,c=>'\\'+c) + '%');
      const i=params.length;
      where.push(`(o.order_number ILIKE $${i} OR EXISTS (SELECT 1 FROM order_vendor_segments s JOIN vendor_branches b ON b.id=s.vendor_branch_id JOIN vendors v ON v.id=b.vendor_id WHERE s.order_id=o.id AND (v.name ILIKE $${i} OR v.name_ar ILIKE $${i})))`);
    }
    const base = `FROM selected a JOIN orders o ON o.id=a.order_id JOIN deliveries d ON d.id=a.delivery_id WHERE ${where.join(' AND ')}`;
    const [tot] = await this.ds.query(`${cte} SELECT count(*)::int AS n ${base}`,params);
    const rows: any[] = await this.ds.query(`${cte}
      SELECT a.*,o.order_number,o.payment_method::text AS payment_method,
        (d.driver_id=a.driver_id AND d.assigned_at=a.assigned_at AND a.status<>'REASSIGNED' AND d.deleted_at IS NULL) AS can_open,
        (SELECT string_agg(DISTINCT v.name,' · ') FROM order_vendor_segments s JOIN vendor_branches b ON b.id=s.vendor_branch_id JOIN vendors v ON v.id=b.vendor_id WHERE s.order_id=o.id AND s.deleted_at IS NULL) AS vendors
      ${base}
      ORDER BY CASE WHEN ${ack} THEN 0 WHEN ${ready} THEN 1 WHEN ${onWay} THEN 2 WHEN ${active} THEN 3 ELSE 4 END,
        CASE WHEN ${ack} THEN a.acknowledge_by END ASC NULLS LAST, a.at DESC, a.id
      LIMIT ${limit} OFFSET ${(page-1)*limit}`,params);
    const states = await this.closing.courierOrderStates(driver.id, rows.filter(r=>r.status==='DELIVERED' && r.can_open).map(r=>r.order_id));
    return {
      tab, range, page, limit, total:num(tot?.n),
      kpis: { all:num(k?.total), completed:num(k?.completed), cancelled:num(k?.cancelled), failed:num(k?.failed),
        acknowledge:num(k?.acknowledge), ready:num(k?.ready), onWay:num(k?.on_way), ignored:0, accepted:0, acceptanceRatePercent:null },
      items: rows.map(r=>{
        const st=states.get(r.order_id);
        const line=(st?.line ?? null) as Record<string,number>|null;
        return {deliveryId:r.delivery_id,orderId:r.order_id,orderNumber:r.order_number,status:r.status,
          paymentMethod:r.payment_method,vendors:r.vendors??null,at:iso(r.at),canOpen:r.can_open===true,
          earnedMinor:line?num(line.courierCompensationMinor):null,settlementState:st?.state??null,settlementReference:st?.reference??null};
      }),
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
    const previousBalances: Array<{net_payable_minor: string; settled: string}> = await this.ds.query(
      `SELECT p.net_payable_minor, coalesce((SELECT sum(s.amount_minor) FROM settlement_payments s WHERE s.driver_period_id=p.id AND s.status='RECORDED'),0) AS settled
         FROM driver_settlement_periods p WHERE p.driver_id=$1 AND p.status='CLOSED' AND p.deleted_at IS NULL`,[driver.id]);
    let unpaidPayoutMinor=0, unpaidCollectionMinor=0;
    for(const row of previousBalances){
      const due=driverPeriodDue(num(row.net_payable_minor));
      const remaining=remainingMinor(due.dueMinor,num(row.settled));
      if(due.direction==='PAYOUT') unpaidPayoutMinor+=remaining; else unpaidCollectionMinor+=remaining;
    }
    const previousUnpaidMinor=unpaidPayoutMinor-unpaidCollectionMinor;
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
        readyToClose: p.lines.length, unresolvedOrders: held.length,
        unclosedMinutes: Math.floor(p.shifts.reduce((sum,sh)=>sum+(new Date(sh.reconciledTo).getTime()-new Date(sh.reconciledFrom).getTime())/60_000,0)),
        unpaidPayoutMinor, unpaidCollectionMinor, previousUnpaidMinor,
        totalPositionMinor: balanceMinor+previousUnpaidMinor,
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
      `WITH bounds AS (
         SELECT ($2::date::timestamp AT TIME ZONE '${CAIRO}') AS lo, (($3::date+1)::timestamp AT TIME ZONE '${CAIRO}') AS hi
       )
       SELECT p.*, coalesce((SELECT sum(s.amount_minor) FROM settlement_payments s WHERE s.driver_period_id=p.id AND s.status='RECORDED'),0) AS settled,
              coalesce(l.orders,0) AS selected_orders, coalesce(l.revenue,0) AS selected_revenue,
              coalesce(t.seconds,0) AS selected_seconds,
              coalesce((SELECT sum(a.amount_minor) FROM driver_allowances a WHERE a.closing_period_id=p.id),0) AS allowance_returned
       FROM driver_settlement_periods p CROSS JOIN bounds b
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS orders, sum(o.courier_compensation_minor) AS revenue FROM driver_settlement_period_orders o
         WHERE o.period_id=p.id AND o.delivered_at>=b.lo AND o.delivered_at<b.hi
       ) l ON true
       LEFT JOIN LATERAL (
         SELECT sum(extract(epoch FROM (least(i.to_at,b.hi)-greatest(i.from_at,b.lo)))) AS seconds
         FROM driver_shift_reconciliations i WHERE i.period_id=p.id AND i.from_at<b.hi AND i.to_at>b.lo
       ) t ON true
       WHERE p.driver_id=$1 AND p.status='CLOSED' AND p.deleted_at IS NULL
         AND (l.orders>0 OR t.seconds>0 OR (p.closed_at>=b.lo AND p.closed_at<b.hi))
       ORDER BY p.closed_at DESC,p.id`,
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
        orders: num(p.selected_orders),
        minutesWorked: Math.floor(num(p.selected_seconds)/60),
        workedSeconds: num(p.selected_seconds),
        revenueMinor: num(p.selected_revenue),
        legacyUnallocated: !v2 && num(p.orders_count)>0,
        closingOrders: num(p.orders_count),
        closingRevenueMinor: v2 ? num(p.courier_compensation_minor) : num(p.total_earnings_minor)-num(p.total_commission_owed_minor),
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
        minutesWorked: Math.floor(items.reduce((s, i) => s + i.workedSeconds, 0)/60),
      },
      items,
    };
  }
}
