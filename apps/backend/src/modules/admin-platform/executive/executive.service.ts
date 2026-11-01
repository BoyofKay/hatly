import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addCairoRange, assertMaxRange, assertDate, likeTerm, maskName, maskPhone, num, REPORTING_TIMEZONE } from '../common/platform-sql';

export interface KpiValue {
  key: string;
  /** null = no data (never rendered as 0). */
  value: number | null;
  previous: number | null;
  deltaPct: number | null;
  unit: 'count' | 'minor' | 'percent' | 'minutes';
  /** True for money figures — hidden without VIEW_FINANCIALS. */
  financial: boolean;
}

/**
 * Executive KPIs, single definitions (docs/admin-revamp MS §5.1 / §8). Every figure is computed here from the ledgers — the Dashboard
 * renders what it is given and never derives money. A period with no source rows yields `null` (shown as "No data"), never 0.
 *
 *  - Orders placed: orders created in the range. Cancelled / delivered: of those, by status.
 *  - GMV: Σ segment subtotals of NON-cancelled segments of orders placed in the range (goods value before discounts/fees). NOT revenue.
 *  - Hatly revenue (recognised): vendor commission + driver commission + Hatly service charge recognised in the range, MINUS the net
 *    Hatly-funded offer discount (recorded − restored). Gross sales are never revenue.
 *  - Outstanding refunds: manual-transfer refunds recorded but not yet marked sent (recorded ≠ sent), as of now.
 */
@Injectable()
export class ExecutiveService {
  constructor(private readonly ds: DataSource) {}

  private async periodKpis(from: string, to: string): Promise<Record<string, number | null>> {
    const p: unknown[] = [];
    const w: string[] = [];
    addCairoRange(w, p, 'o.created_at', from, to);
    const ordersWhere = w.length ? `WHERE ${w.join(' AND ')}` : '';

    const [orders] = await this.ds.query(
      `SELECT count(*)::int AS placed,
              count(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE o.status IN ('DELIVERED','COLLECTED'))::int AS delivered,
              coalesce(sum(o.delivery_fee_minor) FILTER (WHERE o.status IN ('DELIVERED','COLLECTED')), 0)::bigint AS delivery_fees
         FROM orders o ${ordersWhere}`,
      p,
    );
    const [gmv] = await this.ds.query(
      `SELECT coalesce(sum(s.subtotal_minor), 0)::bigint AS gmv, count(DISTINCT s.order_id)::int AS orders, count(DISTINCT s.vendor_branch_id)::int AS active_vendors
         FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        ${ordersWhere ? `${ordersWhere} AND` : 'WHERE'} s.status <> 'CANCELLED'`,
      p,
    );

    const pe: unknown[] = [];
    const we: string[] = [];
    addCairoRange(we, pe, 'e.created_at', from, to);
    const eventsWhere = we.length ? `AND ${we.join(' AND ')}` : '';
    const [fin] = await this.ds.query(
      `SELECT
         coalesce(sum(e.amount_minor) FILTER (WHERE e.type IN ('VENDOR_COMMISSION_RECOGNIZED','DRIVER_COMMISSION_RECOGNIZED','HATLY_SERVICE_CHARGE_RECOGNIZED')), 0)::bigint AS recognised,
         coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED'), 0)::bigint AS discount_recorded,
         coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'), 0)::bigint AS discount_restored,
         count(*)::int AS events
       FROM financial_events e WHERE true ${eventsWhere}`,
      pe,
    );

    const pd: unknown[] = [];
    const wd: string[] = [];
    addCairoRange(wd, pd, 'd.delivered_at', from, to);
    const [del] = await this.ds.query(
      `SELECT count(DISTINCT d.driver_id)::int AS active_drivers,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.delivered_at - d.assigned_at)) / 60) AS median_minutes
         FROM deliveries d WHERE d.delivered_at IS NOT NULL ${wd.length ? `AND ${wd.join(' AND ')}` : ''}`,
      pd,
    );

    const pc: unknown[] = [];
    const wc: string[] = [`u.role = 'CUSTOMER'`];
    addCairoRange(wc, pc, 'u.created_at', from, to);
    const [cust] = await this.ds.query(`SELECT count(*)::int AS n FROM users u WHERE ${wc.join(' AND ')}`, pc);

    const placed = num(orders.placed);
    const nonCancelledOrders = num(gmv.orders);
    const hasOrders = placed > 0;
    return {
      ordersPlaced: hasOrders ? placed : null,
      ordersDelivered: hasOrders ? num(orders.delivered) : null,
      cancellationRate: hasOrders ? Math.round((num(orders.cancelled) / placed) * 1000) / 10 : null,
      gmvMinor: hasOrders ? num(gmv.gmv) : null,
      averageOrderValueMinor: nonCancelledOrders > 0 ? Math.round(num(gmv.gmv) / nonCancelledOrders) : null,
      deliveryFeesMinor: hasOrders ? num(orders.delivery_fees) : null,
      hatlyRevenueMinor: num(fin.events) > 0 ? num(fin.recognised) - (num(fin.discount_recorded) - num(fin.discount_restored)) : null,
      hatlyFundedDiscountNetMinor: num(fin.discount_recorded) + num(fin.discount_restored) > 0 ? num(fin.discount_recorded) - num(fin.discount_restored) : null,
      activeVendors: hasOrders ? num(gmv.active_vendors) : null,
      activeDrivers: num(del.active_drivers) > 0 ? num(del.active_drivers) : null,
      medianDeliveryMinutes: del.median_minutes === null ? null : Math.round(num(del.median_minutes) * 10) / 10,
      // Customer accounts registered in the period (a count of real rows; 0 is a real answer, not "no data").
      newCustomers: num(cust.n),
    };
  }

  /** The period's orders counted by their current status (Cairo dates of creation) — every status present, nothing grouped or guessed. */
  private async ordersByStatus(from: string, to: string): Promise<Record<string, number>> {
    const p: unknown[] = [];
    const w: string[] = [];
    addCairoRange(w, p, 'o.created_at', from, to);
    const rows = await this.ds.query(`SELECT o.status, count(*)::int AS n FROM orders o ${w.length ? `WHERE ${w.join(' AND ')}` : ''} GROUP BY 1`, p);
    return Object.fromEntries(rows.map((r: any) => [r.status, num(r.n)]));
  }

  private previousRange(from: string, to: string): { from: string; to: string } {
    const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    const end = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  async todayLocal(): Promise<string> {
    const [row] = await this.ds.query(`SELECT to_char((now() AT TIME ZONE '${REPORTING_TIMEZONE}')::date, 'YYYY-MM-DD') AS d`);
    return row.d;
  }

  async kpis(fromIn: string | undefined, toIn: string | undefined, compare: boolean, includeFinancial: boolean) {
    const today = await this.todayLocal();
    const from = assertDate(fromIn, 'from') ?? today;
    const to = assertDate(toIn, 'to') ?? from;
    assertMaxRange(from, to, 366);
    const current = await this.periodKpis(from, to);
    const prevRange = this.previousRange(from, to);
    const previous = compare ? await this.periodKpis(prevRange.from, prevRange.to) : null;

    const defs: Array<{ key: keyof typeof current; unit: KpiValue['unit']; financial: boolean }> = [
      { key: 'ordersPlaced', unit: 'count', financial: false },
      { key: 'ordersDelivered', unit: 'count', financial: false },
      { key: 'cancellationRate', unit: 'percent', financial: false },
      { key: 'gmvMinor', unit: 'minor', financial: true },
      { key: 'averageOrderValueMinor', unit: 'minor', financial: true },
      { key: 'deliveryFeesMinor', unit: 'minor', financial: true },
      { key: 'hatlyRevenueMinor', unit: 'minor', financial: true },
      { key: 'hatlyFundedDiscountNetMinor', unit: 'minor', financial: true },
      { key: 'activeVendors', unit: 'count', financial: false },
      { key: 'activeDrivers', unit: 'count', financial: false },
      { key: 'medianDeliveryMinutes', unit: 'minutes', financial: false },
      { key: 'newCustomers', unit: 'count', financial: false },
    ];
    const kpis: KpiValue[] = defs
      .filter((d) => includeFinancial || !d.financial)
      .map((d) => {
        const value = current[d.key];
        const prev = previous ? previous[d.key] : null;
        return {
          key: d.key,
          value,
          previous: prev,
          deltaPct: value !== null && prev !== null && prev !== 0 ? Math.round(((value - prev) / Math.abs(prev)) * 1000) / 10 : null,
          unit: d.unit,
          financial: d.financial,
        };
      });

    // Point-in-time figures (as of now, not period-based).
    const [snap] = await this.ds.query(`
      SELECT
        (SELECT count(*) FROM dispatch_alerts WHERE resolved_at IS NULL AND deleted_at IS NULL)::int AS open_alerts,
        (SELECT coalesce(sum(e.amount_minor), 0) FROM financial_events e WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'
            AND NOT EXISTS (SELECT 1 FROM refund_payouts rp WHERE rp.financial_event_id = e.id))::bigint AS outstanding_refunds`);
    const snapshot: KpiValue[] = [{ key: 'openDispatchAlerts', value: num(snap.open_alerts), previous: null, deltaPct: null, unit: 'count', financial: false }];
    if (includeFinancial) snapshot.push({ key: 'outstandingRefundsMinor', value: num(snap.outstanding_refunds), previous: null, deltaPct: null, unit: 'minor', financial: true });

    return { asOf: new Date().toISOString(), timezone: REPORTING_TIMEZONE, from, to, previousFrom: compare ? prevRange.from : null, previousTo: compare ? prevRange.to : null, kpis: [...kpis, ...snapshot], ordersByStatus: await this.ordersByStatus(from, to) };
  }

  async timeseries(metric: 'orders' | 'gmv' | 'delivered', granularity: 'day' | 'week' | 'month', fromIn?: string, toIn?: string) {
    const today = await this.todayLocal();
    const to = assertDate(toIn, 'to') ?? today;
    const from = assertDate(fromIn, 'from') ?? new Date(Date.parse(`${to}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    assertMaxRange(from, to, 366);
    const p: unknown[] = [];
    const w: string[] = [];
    const bucket = (col: string) => `date_trunc('${granularity}', ${col} AT TIME ZONE '${REPORTING_TIMEZONE}')::date`;
    let sql: string;
    if (metric === 'orders') {
      addCairoRange(w, p, 'o.created_at', from, to);
      sql = `SELECT to_char(${bucket('o.created_at')}, 'YYYY-MM-DD') AS bucket, count(*)::bigint AS value FROM orders o WHERE ${w.join(' AND ')} GROUP BY 1 ORDER BY 1`;
    } else if (metric === 'gmv') {
      addCairoRange(w, p, 'o.created_at', from, to);
      sql = `SELECT to_char(${bucket('o.created_at')}, 'YYYY-MM-DD') AS bucket, coalesce(sum(s.subtotal_minor), 0)::bigint AS value
               FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id WHERE s.status <> 'CANCELLED' AND ${w.join(' AND ')} GROUP BY 1 ORDER BY 1`;
    } else {
      addCairoRange(w, p, 'd.delivered_at', from, to);
      sql = `SELECT to_char(${bucket('d.delivered_at')}, 'YYYY-MM-DD') AS bucket, count(*)::bigint AS value FROM deliveries d WHERE d.delivered_at IS NOT NULL AND ${w.join(' AND ')} GROUP BY 1 ORDER BY 1`;
    }
    const rows = await this.ds.query(sql, p);
    return { metric, granularity, from, to, points: rows.map((r: any) => ({ bucketStart: r.bucket, value: num(r.value) })) };
  }

  /** Unified alert feed. Each source is a real query; an alert exists only while its condition holds. */
  async alerts(opts: { includeSystem: boolean; includeFinancial: boolean }) {
    const alerts: Array<{ key: string; severity: 'critical' | 'warning' | 'info'; reason: string; entityType: string; entityId: string | null; since: string; detail: string | null; acknowledged: boolean }> = [];

    const dispatch = await this.ds.query(
      `SELECT a.id, a.order_id, a.reason, a.detail, a.created_at, o.order_number
         FROM dispatch_alerts a JOIN orders o ON o.id = a.order_id
        WHERE a.resolved_at IS NULL AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 100`,
    );
    for (const a of dispatch) {
      alerts.push({ key: `dispatch:${a.id}`, severity: a.reason === 'ASSIGNMENT_ERROR' ? 'critical' : 'warning', reason: `DISPATCH_${a.reason}`, entityType: 'order', entityId: a.order_id, since: new Date(a.created_at).toISOString(), detail: a.order_number, acknowledged: false });
    }

    const pending = await this.ds.query(
      `SELECT s.id, s.order_id, s.created_at, o.order_number FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        WHERE s.status = 'PENDING' AND s.deleted_at IS NULL AND o.status <> 'CANCELLED' AND s.created_at < now() - interval '5 minutes' ORDER BY s.created_at LIMIT 50`,
    );
    for (const s of pending) {
      alerts.push({ key: `pending-acceptance:${s.id}`, severity: 'warning', reason: 'PENDING_ACCEPTANCE_OVERDUE', entityType: 'order', entityId: s.order_id, since: new Date(s.created_at).toISOString(), detail: s.order_number, acknowledged: false });
    }

    const lowStock = await this.ds.query(
      `SELECT p.id, p.name, p.quantity, p.updated_at FROM products p
        WHERE p.deleted_at IS NULL AND p.is_available AND p.inventory_mode = 'TRACKED' AND p.quantity IS NOT NULL
          AND p.quantity <= coalesce(p.low_stock_threshold, 5) ORDER BY p.quantity, p.name LIMIT 50`,
    );
    for (const p of lowStock) {
      alerts.push({ key: `low-stock:${p.id}`, severity: p.quantity <= 0 ? 'warning' : 'info', reason: p.quantity <= 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK', entityType: 'product', entityId: p.id, since: new Date(p.updated_at).toISOString(), detail: `${p.name} (${p.quantity})`, acknowledged: false });
    }

    if (opts.includeFinancial) {
      const refunds = await this.ds.query(
        `SELECT e.id, e.order_id, e.amount_minor, e.created_at FROM financial_events e
          WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED' AND e.created_at < now() - interval '24 hours'
            AND NOT EXISTS (SELECT 1 FROM refund_payouts rp WHERE rp.financial_event_id = e.id) ORDER BY e.created_at LIMIT 50`,
      );
      for (const r of refunds) {
        alerts.push({ key: `refund-to-send:${r.id}`, severity: 'warning', reason: 'REFUND_NOT_SENT_24H', entityType: 'order', entityId: r.order_id, since: new Date(r.created_at).toISOString(), detail: String(r.amount_minor), acknowledged: false });
      }
    }

    if (opts.includeSystem) {
      const checks = await this.ds.query(
        `SELECT DISTINCT ON (integration_key) integration_key, status, detail, checked_at FROM integration_checks ORDER BY integration_key, checked_at DESC`,
      );
      for (const c of checks) {
        if (c.status === 'DOWN' || c.status === 'DEGRADED') {
          alerts.push({ key: `integration:${c.integration_key}`, severity: c.status === 'DOWN' ? 'critical' : 'warning', reason: `INTEGRATION_${c.status}`, entityType: 'integration', entityId: null, since: new Date(c.checked_at).toISOString(), detail: `${c.integration_key}${c.detail ? `: ${c.detail}` : ''}`, acknowledged: false });
        }
      }
      const failedExports = await this.ds.query(
        `SELECT id, report_id, finished_at, error_code FROM report_exports WHERE status = 'FAILED' AND finished_at > now() - interval '24 hours' ORDER BY finished_at DESC LIMIT 20`,
      );
      for (const f of failedExports) {
        alerts.push({ key: `export-failed:${f.id}`, severity: 'warning', reason: 'EXPORT_FAILED', entityType: 'export', entityId: f.id, since: new Date(f.finished_at).toISOString(), detail: `${f.report_id} ${f.error_code ?? ''}`.trim(), acknowledged: false });
      }
    }

    if (alerts.length > 0) {
      const acked = await this.ds.query(`SELECT alert_key FROM alert_acknowledgements WHERE alert_key = ANY($1)`, [alerts.map((a) => a.key)]);
      const set = new Set(acked.map((r: any) => r.alert_key));
      for (const a of alerts) a.acknowledged = set.has(a.key);
    }
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.since.localeCompare(b.since));
    return alerts;
  }

  async acknowledge(key: string, userId: string, note?: string): Promise<void> {
    await this.ds.query(
      `INSERT INTO alert_acknowledgements (alert_key, acknowledged_by_user_id, note) VALUES ($1, $2, $3)
       ON CONFLICT (alert_key, acknowledged_by_user_id) DO UPDATE SET note = EXCLUDED.note, acknowledged_at = now()`,
      [key.slice(0, 120), userId, note?.slice(0, 300) ?? null],
    );
  }

  /** Delivery-time service levels from real status data (no promised-time field exists, so no "on-time %" is invented). */
  async sla(from?: string, to?: string) {
    assertMaxRange(from, to, 366);
    const p: unknown[] = [];
    const w: string[] = [];
    addCairoRange(w, p, 'd.delivered_at', from, to);
    const [row] = await this.ds.query(
      `SELECT count(*)::int AS deliveries,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.picked_up_at - d.assigned_at)) / 60) AS p50_assign_to_pickup,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (d.picked_up_at - d.assigned_at)) / 60) AS p90_assign_to_pickup,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60) AS p50_pickup_to_delivered,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (d.delivered_at - d.picked_up_at)) / 60) AS p90_pickup_to_delivered,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.delivered_at - d.assigned_at)) / 60) AS p50_total,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (d.delivered_at - d.assigned_at)) / 60) AS p90_total,
              coalesce(avg(d.reassignment_count), 0)::float AS avg_reassignments
         FROM deliveries d WHERE d.delivered_at IS NOT NULL AND d.picked_up_at IS NOT NULL ${w.length ? `AND ${w.join(' AND ')}` : ''}`,
      p,
    );
    const r = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    return {
      deliveries: num(row.deliveries),
      assignToPickupMinutes: { p50: r(row.p50_assign_to_pickup), p90: r(row.p90_assign_to_pickup) },
      pickupToDeliveredMinutes: { p50: r(row.p50_pickup_to_delivered), p90: r(row.p90_pickup_to_delivered) },
      assignToDeliveredMinutes: { p50: r(row.p50_total), p90: r(row.p90_total) },
      averageReassignments: r(row.avg_reassignments),
    };
  }

  /** Global search: only the groups the caller may read; ≤ 5 results per group; PII masked unless allowed. */
  async search(q: string, allow: { orders: boolean; customers: boolean; vendors: boolean; products: boolean; drivers: boolean; pii: boolean }) {
    const term = likeTerm(q.trim());
    const groups: Array<{ type: string; items: Array<{ id: string; title: string; subtitle: string | null; url: string }> }> = [];
    if (allow.orders) {
      const rows = await this.ds.query(
        `SELECT o.id, o.order_number, o.status, o.total_minor FROM orders o WHERE o.order_number ILIKE $1 ESCAPE '\\' ORDER BY o.created_at DESC LIMIT 5`,
        [term],
      );
      groups.push({ type: 'orders', items: rows.map((r: any) => ({ id: r.id, title: r.order_number, subtitle: r.status, url: `/order-management?order=${r.id}` })) });
    }
    if (allow.customers) {
      const rows = await this.ds.query(
        `SELECT u.id, u.full_name, u.phone FROM users u WHERE u.role = 'CUSTOMER' AND u.deleted_at IS NULL AND (u.phone ILIKE $1 ESCAPE '\\' OR u.full_name ILIKE $1 ESCAPE '\\') ORDER BY u.created_at DESC LIMIT 5`,
        [term],
      );
      groups.push({
        type: 'customers',
        items: rows.map((r: any) => ({ id: r.id, title: allow.pii ? r.full_name ?? r.phone : maskName(r.full_name) ?? maskPhone(r.phone) ?? '—', subtitle: allow.pii ? r.phone : maskPhone(r.phone), url: `/customers/${r.id}` })),
      });
    }
    if (allow.vendors) {
      const rows = await this.ds.query(
        `SELECT v.id, v.name, v.name_ar FROM vendors v WHERE v.deleted_at IS NULL AND (v.name ILIKE $1 ESCAPE '\\' OR v.name_ar ILIKE $1 ESCAPE '\\') ORDER BY v.name LIMIT 5`,
        [term],
      );
      groups.push({ type: 'vendors', items: rows.map((r: any) => ({ id: r.id, title: r.name, subtitle: r.name_ar, url: `/vendors/${r.id}` })) });
    }
    if (allow.products) {
      const rows = await this.ds.query(
        `SELECT p.id, p.name, p.name_ar FROM products p WHERE p.deleted_at IS NULL AND (p.name ILIKE $1 ESCAPE '\\' OR p.name_ar ILIKE $1 ESCAPE '\\') ORDER BY p.name LIMIT 5`,
        [term],
      );
      groups.push({ type: 'products', items: rows.map((r: any) => ({ id: r.id, title: r.name, subtitle: r.name_ar, url: `/catalog?q=${encodeURIComponent(q)}` })) });
    }
    if (allow.drivers) {
      const rows = await this.ds.query(
        `SELECT d.id, u.full_name, u.phone FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.full_name ILIKE $1 ESCAPE '\\' OR u.phone ILIKE $1 ESCAPE '\\' ORDER BY u.full_name LIMIT 5`,
        [term],
      );
      groups.push({ type: 'drivers', items: rows.map((r: any) => ({ id: r.id, title: r.full_name ?? r.phone, subtitle: r.phone, url: `/drivers` })) });
    }
    return { groups: groups.filter((g) => g.items.length > 0) };
  }
}
