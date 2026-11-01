import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addCairoRange, assertDate, assertMaxRange, assertUuid, num, pageParams, REPORTING_TIMEZONE, returned } from '../common/platform-sql';
import { clampLimit, decodeCursor, encodeCursor } from '../common/cursor';
import { derivePaymentStatus, driverPeriodDue, remainingMinor, SettlementDirection, vendorPeriodDue } from './settlement-status';

const REVENUE_TYPES = ['VENDOR_COMMISSION_RECOGNIZED', 'DRIVER_COMMISSION_RECOGNIZED', 'HATLY_SERVICE_CHARGE_RECOGNIZED'];

export interface LedgerFilters {
  from?: string;
  to?: string;
  type?: string[];
  orderId?: string;
  vendorBranchId?: string;
  driverId?: string;
  cursor?: string;
  limit?: string | number;
}

const STATUS_SQL = (due: string, settled: string) => `CASE
  WHEN ${due} <= 0 THEN CASE WHEN ${settled} > 0 THEN 'OVERPAID' ELSE 'NOTHING_DUE' END
  WHEN ${settled} <= 0 THEN 'UNPAID' WHEN ${settled} < ${due} THEN 'PARTIAL' WHEN ${settled} = ${due} THEN 'PAID' ELSE 'OVERPAID' END`;

/**
 * Finance & accounting read models and settlement payments. Definitions follow docs/admin-revamp MS §8 as CORRECTED by the approved
 * B1/B5 rulings: a vendor settlement is Hatly's RECEIVABLE (commission owed by the vendor), never an amount owed to the vendor;
 * vendor and driver settlements are separate; a closed period is frozen and money movement against it is recorded ONLY as
 * settlement_payments (idempotent, partial payments, authorised overpayments, void-by-reversal, audited).
 */
@Injectable()
export class AdminFinanceService {
  constructor(private readonly ds: DataSource) {}

  // ---------------------------------------------------------------- ledger

  private ledgerWhere(f: LedgerFilters, params: unknown[]): string[] {
    const where: string[] = ['true'];
    addCairoRange(where, params, 'e.created_at', f.from, f.to);
    if (f.type?.length) {
      params.push(f.type);
      where.push(`e.type = ANY($${params.length})`);
    }
    const order = assertUuid(f.orderId, 'orderId');
    if (order) { params.push(order); where.push(`e.order_id = $${params.length}`); }
    const branch = assertUuid(f.vendorBranchId, 'vendorBranchId');
    if (branch) { params.push(branch); where.push(`e.vendor_branch_id = $${params.length}`); }
    const driver = assertUuid(f.driverId, 'driverId');
    if (driver) { params.push(driver); where.push(`e.driver_id = $${params.length}`); }
    return where;
  }

  private assertLedgerScope(f: LedgerFilters): void {
    if (!f.orderId && !f.from && !f.to) {
      throw new BadRequestException({ message: 'Choose a date range (or an order) for the ledger.', details: { code: 'RANGE_REQUIRED' } });
    }
    assertMaxRange(f.from, f.to, 366);
  }

  async ledger(f: LedgerFilters) {
    this.assertLedgerScope(f);
    const params: unknown[] = [];
    const where = this.ledgerWhere(f, params);
    const cur = decodeCursor(f.cursor);
    if (cur) {
      params.push(cur.at, cur.id);
      where.push(`(e.created_at, e.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
    }
    const limit = clampLimit(f.limit);
    params.push(limit + 1);
    const rows = await this.ds.query(
      `SELECT e.id, e.created_at, e.type, e.direction, e.amount_minor, e.order_id, o.order_number, e.vendor_branch_id, b.name AS branch_name,
              e.driver_id, e.related_event_id, e.reason, e.actor_user_id
         FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id LEFT JOIN vendor_branches b ON b.id = e.vendor_branch_id
        WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT $${params.length}`,
      params,
    );
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r: any) => ({
      id: r.id, createdAt: new Date(r.created_at).toISOString(), type: r.type, direction: r.direction, amountMinor: num(r.amount_minor),
      orderId: r.order_id, orderNumber: r.order_number, vendorBranchId: r.vendor_branch_id, branchName: r.branch_name, driverId: r.driver_id,
      relatedEventId: r.related_event_id, reason: r.reason,
    }));
    return { items, nextCursor: more ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id) : null };
  }

  async ledgerSummary(f: LedgerFilters) {
    this.assertLedgerScope(f);
    const params: unknown[] = [];
    const where = this.ledgerWhere(f, params);
    const rows = await this.ds.query(
      `SELECT e.type, e.direction, count(*)::int AS events, coalesce(sum(e.amount_minor), 0)::bigint AS total
         FROM financial_events e WHERE ${where.join(' AND ')} GROUP BY e.type, e.direction ORDER BY e.type`,
      params,
    );
    return { byType: rows.map((r: any) => ({ type: r.type, direction: r.direction, events: r.events, totalMinor: num(r.total) })) };
  }

  async ledgerEvent(id: string) {
    assertUuid(id, 'id');
    const [e] = await this.ds.query(
      `SELECT e.*, o.order_number FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id WHERE e.id = $1`,
      [id],
    );
    if (!e) throw new NotFoundException('Financial event not found.');
    const linked = await this.ds.query(
      `SELECT id, type, amount_minor, created_at FROM financial_events WHERE related_event_id = $1 OR id = $2 ORDER BY created_at`,
      [id, e.related_event_id ?? id],
    );
    const [payout] = await this.ds.query(`SELECT id, created_at, note FROM refund_payouts WHERE financial_event_id = $1`, [id]);
    return {
      id: e.id, createdAt: new Date(e.created_at).toISOString(), type: e.type, direction: e.direction, amountMinor: num(e.amount_minor), orderId: e.order_id,
      orderNumber: e.order_number, vendorBranchId: e.vendor_branch_id, driverId: e.driver_id, reason: e.reason, rateSnapshot: e.rate_snapshot,
      relatedEventId: e.related_event_id,
      linkedEvents: linked.filter((l: any) => l.id !== id).map((l: any) => ({ id: l.id, type: l.type, amountMinor: num(l.amount_minor), createdAt: new Date(l.created_at).toISOString() })),
      refundSent: payout ? { sentAt: new Date(payout.created_at).toISOString(), note: payout.note } : null,
    };
  }

  // ---------------------------------------------------------------- revenue / commissions / receivables

  async revenue(from: string | undefined, to: string | undefined, granularity: 'day' | 'week' | 'month') {
    assertMaxRange(from, to, 366);
    const params: unknown[] = [];
    const where: string[] = ['true'];
    addCairoRange(where, params, 'e.created_at', from, to);
    const rows = await this.ds.query(
      `SELECT to_char(date_trunc('${granularity}', e.created_at AT TIME ZONE '${REPORTING_TIMEZONE}')::date, 'YYYY-MM-DD') AS bucket,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'VENDOR_COMMISSION_RECOGNIZED'), 0)::bigint AS vendor_commission,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'DRIVER_COMMISSION_RECOGNIZED'), 0)::bigint AS driver_commission,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_SERVICE_CHARGE_RECOGNIZED'), 0)::bigint AS service_charge,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED'), 0)::bigint AS discount_recorded,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'), 0)::bigint AS discount_restored
         FROM financial_events e WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY 1`,
      params,
    );
    const buckets = rows.map((r: any) => {
      const vendor = num(r.vendor_commission), driver = num(r.driver_commission), service = num(r.service_charge);
      const rec = num(r.discount_recorded), res = num(r.discount_restored);
      return { bucket: r.bucket, vendorCommissionMinor: vendor, driverCommissionMinor: driver, serviceChargeMinor: service, discountRecordedMinor: rec, discountRestoredMinor: res, discountNetMinor: rec - res, hatlyRevenueMinor: vendor + driver + service - (rec - res) };
    });
    const sum = (k: keyof (typeof buckets)[number]) => buckets.reduce((s: number, b: any) => s + b[k], 0);
    return {
      definition: 'Hatly revenue = vendor commission + driver commission + service charge recognised, minus the net Hatly-funded discount (recorded − restored). Gross sales are not revenue.',
      buckets,
      totals: { vendorCommissionMinor: sum('vendorCommissionMinor'), driverCommissionMinor: sum('driverCommissionMinor'), serviceChargeMinor: sum('serviceChargeMinor'), discountNetMinor: sum('discountNetMinor'), hatlyRevenueMinor: sum('hatlyRevenueMinor') },
    };
  }

  /**
   * VendorLedger (B1): Hatly's RECEIVABLE commission from each vendor branch, mapped to real ledger entries:
   * recognised (Σ VENDOR_COMMISSION_RECOGNIZED events) = in closed periods + still open (not yet closed); collected = Σ recorded COLLECTION
   * payments against closed periods; outstanding = closed-period due − collected.
   */
  async vendorReceivables(from?: string, to?: string) {
    assertMaxRange(from, to, 366);
    const params: unknown[] = [];
    const where: string[] = ['true'];
    addCairoRange(where, params, 'e.created_at', from, to);
    const rows = await this.ds.query(
      `WITH rec AS (
         SELECT e.vendor_branch_id, sum(e.amount_minor)::bigint AS recognised FROM financial_events e
          WHERE e.type = 'VENDOR_COMMISSION_RECOGNIZED' AND e.vendor_branch_id IS NOT NULL AND ${where.join(' AND ')} GROUP BY 1),
       per AS (
         SELECT p.vendor_branch_id, sum(p.total_commission_owed_minor)::bigint AS closed_due,
                coalesce(sum((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED')), 0)::bigint AS collected
           FROM vendor_settlement_periods p WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL GROUP BY 1)
       SELECT b.id, b.name AS branch_name, v.name AS vendor_name, coalesce(rec.recognised, 0) AS recognised, coalesce(per.closed_due, 0) AS closed_due, coalesce(per.collected, 0) AS collected
         FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN rec ON rec.vendor_branch_id = b.id LEFT JOIN per ON per.vendor_branch_id = b.id
        WHERE b.deleted_at IS NULL AND (rec.recognised IS NOT NULL OR per.closed_due IS NOT NULL) ORDER BY v.name, b.name`,
      params,
    );
    const items = rows.map((r: any) => ({
      vendorBranchId: r.id, vendorName: r.vendor_name, branchName: r.branch_name, recognisedMinor: num(r.recognised), closedDueMinor: num(r.closed_due), collectedMinor: num(r.collected),
      outstandingMinor: num(r.closed_due) - num(r.collected),
    }));
    return {
      definition: 'Receivable = commission the vendor owes Hatly. Recognised ≠ collected; a closed period is not paid until collections are recorded against it.',
      items,
      totals: items.reduce((t: any, i: any) => ({ recognisedMinor: t.recognisedMinor + i.recognisedMinor, closedDueMinor: t.closedDueMinor + i.closedDueMinor, collectedMinor: t.collectedMinor + i.collectedMinor, outstandingMinor: t.outstandingMinor + i.outstandingMinor }), { recognisedMinor: 0, closedDueMinor: 0, collectedMinor: 0, outstandingMinor: 0 }),
    };
  }

  async hatlyFundedDiscounts(from?: string, to?: string, limit?: string | number) {
    assertMaxRange(from, to, 366);
    const params: unknown[] = [];
    const where: string[] = [`e.type IN ('HATLY_FUNDED_OFFER_DISCOUNT_RECORDED','HATLY_FUNDED_OFFER_DISCOUNT_RESTORED')`];
    addCairoRange(where, params, 'e.created_at', from, to);
    const [totals] = await this.ds.query(
      `SELECT coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED'), 0)::bigint AS recorded,
              coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'), 0)::bigint AS restored FROM financial_events e WHERE ${where.join(' AND ')}`,
      params,
    );
    const rows = await this.ds.query(
      `SELECT e.id, e.created_at, e.type, e.amount_minor, e.order_id, o.order_number, e.related_event_id FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id
        WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT ${clampLimit(limit, 100, 200)}`,
      params,
    );
    return {
      recordedMinor: num(totals.recorded), restoredMinor: num(totals.restored), netMinor: num(totals.recorded) - num(totals.restored),
      items: rows.map((r: any) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), type: r.type, amountMinor: num(r.amount_minor), orderId: r.order_id, orderNumber: r.order_number, relatedEventId: r.related_event_id })),
    };
  }

  async liabilities() {
    const [w] = await this.ds.query(
      `SELECT coalesce(sum(b.bal) FILTER (WHERE b.bal > 0), 0)::bigint AS wallet_total, count(*) FILTER (WHERE b.bal > 0)::int AS wallets,
              count(*) FILTER (WHERE b.bal < 0)::int AS negative
         FROM (SELECT customer_id, sum(amount_delta_minor) AS bal FROM wallet_transactions GROUP BY 1) b`,
    );
    const [l] = await this.ds.query(`SELECT coalesce(sum(b.pts) FILTER (WHERE b.pts > 0), 0)::bigint AS points FROM (SELECT customer_id, sum(points_delta) AS pts FROM loyalty_points_transactions GROUP BY 1) b`);
    const [rate] = await this.ds.query(`SELECT value FROM business_config WHERE key = 'LOYALTY_WALLET_CONVERSION_POINTS_PER_EGP' LIMIT 1`).catch(() => [undefined]);
    const pointsPerEgp = rate?.value !== undefined ? Number(typeof rate.value === 'object' ? (rate.value as any).value ?? rate.value : rate.value) : null;
    const [refunds] = await this.ds.query(
      `SELECT coalesce(sum(e.amount_minor), 0)::bigint AS outstanding, count(*)::int AS n FROM financial_events e
        WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED' AND NOT EXISTS (SELECT 1 FROM refund_payouts rp WHERE rp.financial_event_id = e.id)`,
    );
    const vendor = await this.ds.query(
      `SELECT p.total_commission_owed_minor AS due, coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED'), 0) AS settled
         FROM vendor_settlement_periods p WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL`,
    );
    const driver = await this.ds.query(
      `SELECT p.net_payable_minor AS net, coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED'), 0) AS settled
         FROM driver_settlement_periods p WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL`,
    );
    let vendorReceivable = 0;
    for (const v of vendor) vendorReceivable += remainingMinor(num(v.due), num(v.settled));
    let driverPayable = 0;
    let driverReceivable = 0;
    for (const d of driver) {
      const due = driverPeriodDue(num(d.net));
      const rem = remainingMinor(due.dueMinor, num(d.settled));
      if (due.direction === 'PAYOUT') driverPayable += rem;
      else driverReceivable += rem;
    }
    return {
      walletBalancesMinor: num(w.wallet_total), walletsWithBalance: w.wallets, negativeWalletBalances: w.negative,
      loyaltyPointsOutstanding: num(l.points), loyaltyPointsPerEgp: Number.isFinite(pointsPerEgp as number) ? pointsPerEgp : null,
      loyaltyLiabilityMinor: pointsPerEgp && Number.isFinite(pointsPerEgp) && pointsPerEgp > 0 ? Math.round((num(l.points) / pointsPerEgp) * 100) : null,
      refundsOutstandingMinor: num(refunds.outstanding), refundsOutstandingCount: refunds.n,
      vendorCommissionReceivableMinor: vendorReceivable, driverPayableMinor: driverPayable, driverReceivableMinor: driverReceivable,
      asOf: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------- reconciliation

  async reconciliation() {
    const checks: Array<{ id: string; title: string; status: 'BALANCED' | 'MISMATCH'; checked: number; discrepancies: Array<Record<string, unknown>> }> = [];

    // R2 — refunds: recorded − sent, never negative; each payout points at a real recorded refund.
    const orphanPayouts = await this.ds.query(
      `SELECT rp.id FROM refund_payouts rp LEFT JOIN financial_events e ON e.id = rp.financial_event_id WHERE e.id IS NULL OR e.type <> 'MANUAL_TRANSFER_REFUND_RECORDED'`,
    );
    const [refundCount] = await this.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE type = 'MANUAL_TRANSFER_REFUND_RECORDED'`);
    checks.push({ id: 'R2', title: 'Refunds: every payout belongs to a recorded refund (recorded − sent ≥ 0)', status: orphanPayouts.length ? 'MISMATCH' : 'BALANCED', checked: refundCount.n, discrepancies: orphanPayouts.map((r: any) => ({ payoutId: r.id })) });

    // R3 — closed vendor periods: stored totals equal the events/segments of the period.
    const vendorBad = await this.ds.query(
      `SELECT p.id, p.vendor_branch_id, p.total_commission_owed_minor AS stored_commission, p.gross_sales_minor AS stored_gross,
              coalesce((SELECT sum(e.amount_minor) FROM financial_events e WHERE e.vendor_branch_id = p.vendor_branch_id AND e.type = 'VENDOR_COMMISSION_RECOGNIZED' AND e.created_at >= p.period_start AND e.created_at < p.period_end), 0) AS recomputed_commission,
              coalesce((SELECT sum(s.subtotal_minor) FROM order_vendor_segments s WHERE s.vendor_branch_id = p.vendor_branch_id AND s.group_type = 'CATALOG' AND s.status <> 'CANCELLED' AND s.created_at >= p.period_start AND s.created_at < p.period_end), 0) AS recomputed_gross
         FROM vendor_settlement_periods p WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL`,
    );
    const vendorMismatch = vendorBad.filter((r: any) => num(r.stored_commission) !== num(r.recomputed_commission) || num(r.stored_gross) !== num(r.recomputed_gross));
    checks.push({ id: 'R3', title: 'Vendor settlements: stored commission and gross sales equal their ledger events and segments', status: vendorMismatch.length ? 'MISMATCH' : 'BALANCED', checked: vendorBad.length, discrepancies: vendorMismatch.map((r: any) => ({ periodId: r.id, storedCommissionMinor: num(r.stored_commission), recomputedCommissionMinor: num(r.recomputed_commission), storedGrossMinor: num(r.stored_gross), recomputedGrossMinor: num(r.recomputed_gross) })) });

    const driverBad = await this.ds.query(
      `SELECT p.id, p.total_commission_owed_minor AS stored_commission, p.total_reimbursements_owed_minor AS stored_reimb,
              coalesce((SELECT sum(e.amount_minor) FROM financial_events e WHERE e.driver_id = p.driver_id AND e.type = 'DRIVER_COMMISSION_RECOGNIZED' AND e.created_at >= p.period_start AND e.created_at < p.period_end), 0) AS recomputed_commission,
              coalesce((SELECT sum(e.amount_minor) FROM financial_events e WHERE e.driver_id = p.driver_id AND e.type = 'DRIVER_REIMBURSEMENT_OWED' AND e.created_at >= p.period_start AND e.created_at < p.period_end), 0) AS recomputed_reimb
         FROM driver_settlement_periods p WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL`,
    );
    const driverMismatch = driverBad.filter((r: any) => num(r.stored_commission) !== num(r.recomputed_commission) || num(r.stored_reimb) !== num(r.recomputed_reimb));
    checks.push({ id: 'R3D', title: 'Driver settlements: stored commission and reimbursements equal their ledger events', status: driverMismatch.length ? 'MISMATCH' : 'BALANCED', checked: driverBad.length, discrepancies: driverMismatch.map((r: any) => ({ periodId: r.id, storedCommissionMinor: num(r.stored_commission), recomputedCommissionMinor: num(r.recomputed_commission) })) });

    // R4 — Hatly-funded discount: every RESTORED event links to a RECORDED event of the same order and never exceeds it.
    const restoredBad = await this.ds.query(
      `SELECT r.id, r.order_id, r.amount_minor FROM financial_events r LEFT JOIN financial_events o ON o.id = r.related_event_id
        WHERE r.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED' AND (o.id IS NULL OR o.type <> 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED' OR o.order_id IS DISTINCT FROM r.order_id)`,
    );
    const overRestored = await this.ds.query(
      `SELECT o.id, o.amount_minor AS recorded, sum(r.amount_minor) AS restored FROM financial_events o JOIN financial_events r ON r.related_event_id = o.id
        WHERE o.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED' AND r.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED' GROUP BY o.id, o.amount_minor HAVING sum(r.amount_minor) > o.amount_minor`,
    );
    const [discountCount] = await this.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE type IN ('HATLY_FUNDED_OFFER_DISCOUNT_RECORDED','HATLY_FUNDED_OFFER_DISCOUNT_RESTORED')`);
    checks.push({ id: 'R4', title: 'Hatly-funded discounts: restored ≤ recorded and every restoration links to its original', status: restoredBad.length || overRestored.length ? 'MISMATCH' : 'BALANCED', checked: discountCount.n, discrepancies: [...restoredBad.map((r: any) => ({ eventId: r.id, issue: 'UNLINKED_RESTORATION' })), ...overRestored.map((r: any) => ({ eventId: r.id, issue: 'OVER_RESTORED', recordedMinor: num(r.recorded), restoredMinor: num(r.restored) }))] });

    // R5 — wallet ledger: no customer wallet below zero.
    const negative = await this.ds.query(`SELECT customer_id, sum(amount_delta_minor)::bigint AS bal FROM wallet_transactions GROUP BY 1 HAVING sum(amount_delta_minor) < 0`);
    const [walletCount] = await this.ds.query(`SELECT count(DISTINCT customer_id)::int AS n FROM wallet_transactions`);
    checks.push({ id: 'R5', title: 'Customer wallets: no ledger balance below zero', status: negative.length ? 'MISMATCH' : 'BALANCED', checked: walletCount.n, discrepancies: negative.map((r: any) => ({ customerId: r.customer_id, balanceMinor: num(r.bal) })) });

    // R6 — settlement payments: nothing overpaid without authorisation; one period per payment.
    const overpaid = await this.ds.query(
      `SELECT p.id, 'VENDOR' AS party, p.total_commission_owed_minor AS due, s.settled, s.unauth
         FROM vendor_settlement_periods p JOIN LATERAL (SELECT sum(amount_minor) AS settled, bool_or(overpayment_authorised) AS unauth FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED') s ON true
        WHERE s.settled > p.total_commission_owed_minor AND NOT coalesce(s.unauth, false)
       UNION ALL
       SELECT p.id, 'DRIVER', abs(p.net_payable_minor), s.settled, s.unauth
         FROM driver_settlement_periods p JOIN LATERAL (SELECT sum(amount_minor) AS settled, bool_or(overpayment_authorised) AS unauth FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED') s ON true
        WHERE s.settled > abs(p.net_payable_minor) AND NOT coalesce(s.unauth, false)`,
    );
    const [payCount] = await this.ds.query(`SELECT count(*)::int AS n FROM settlement_payments WHERE status = 'RECORDED'`);
    checks.push({ id: 'R6', title: 'Settlement payments: no period is overpaid without an authorisation', status: overpaid.length ? 'MISMATCH' : 'BALANCED', checked: payCount.n, discrepancies: overpaid.map((r: any) => ({ periodId: r.id, party: r.party, dueMinor: num(r.due), settledMinor: num(r.settled) })) });

    return { asOf: new Date().toISOString(), balanced: checks.every((c) => c.status === 'BALANCED'), checks };
  }

  // ---------------------------------------------------------------- payments / refunds lists

  async payments(q: { method?: string; status?: string; from?: string; to?: string; q?: string; cursor?: string; limit?: string | number }) {
    assertMaxRange(q.from, q.to, 366);
    const params: unknown[] = [];
    const where: string[] = ['true'];
    addCairoRange(where, params, 'p.created_at', q.from, q.to);
    if (q.method) { params.push(q.method); where.push(`p.method = $${params.length}`); }
    if (q.status) { params.push(q.status); where.push(`p.status = $${params.length}`); }
    if (q.q) { params.push(`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`); where.push(`o.order_number ILIKE $${params.length} ESCAPE '\\'`); }
    const cur = decodeCursor(q.cursor);
    if (cur) { params.push(cur.at, cur.id); where.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    const limit = clampLimit(q.limit, 50, 100);
    params.push(limit + 1);
    const rows = await this.ds.query(
      `SELECT p.id, p.created_at, p.method, p.status, p.amount_minor, p.electronic_method, p.order_id, o.order_number, p.claimed_at, p.verified_at, p.rejection_reason
         FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT $${params.length}`,
      params,
    );
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r: any) => ({ id: r.id, createdAt: new Date(r.created_at).toISOString(), method: r.method, status: r.status, amountMinor: num(r.amount_minor), electronicMethod: r.electronic_method, orderId: r.order_id, orderNumber: r.order_number, claimedAt: r.claimed_at, verifiedAt: r.verified_at, rejectionReason: r.rejection_reason }));
    return { items, nextCursor: more ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id) : null };
  }

  async refunds(q: { state?: 'TO_SEND' | 'SENT' | 'ALL'; from?: string; to?: string; cursor?: string; limit?: string | number }) {
    assertMaxRange(q.from, q.to, 366);
    const params: unknown[] = [];
    const where: string[] = [`e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'`];
    addCairoRange(where, params, 'e.created_at', q.from, q.to);
    if (q.state === 'TO_SEND') where.push('rp.id IS NULL');
    if (q.state === 'SENT') where.push('rp.id IS NOT NULL');
    const cur = decodeCursor(q.cursor);
    if (cur) { params.push(cur.at, cur.id); where.push(`(e.created_at, e.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`); }
    const limit = clampLimit(q.limit, 50, 100);
    params.push(limit + 1);
    const rows = await this.ds.query(
      `SELECT e.id, e.created_at, e.amount_minor, e.order_id, o.order_number, rp.created_at AS sent_at, rp.note
         FROM financial_events e JOIN orders o ON o.id = e.order_id LEFT JOIN refund_payouts rp ON rp.financial_event_id = e.id
        WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC, e.id DESC LIMIT $${params.length}`,
      params,
    );
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r: any) => ({ eventId: r.id, recordedAt: new Date(r.created_at).toISOString(), amountMinor: num(r.amount_minor), orderId: r.order_id, orderNumber: r.order_number, state: r.sent_at ? 'SENT' : 'TO_SEND', sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null, note: r.note }));
    const [totals] = await this.ds.query(
      `SELECT coalesce(sum(e.amount_minor) FILTER (WHERE rp.id IS NULL), 0)::bigint AS to_send, coalesce(sum(e.amount_minor) FILTER (WHERE rp.id IS NOT NULL), 0)::bigint AS sent
         FROM financial_events e LEFT JOIN refund_payouts rp ON rp.financial_event_id = e.id WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'`,
    );
    return { items, nextCursor: more ? encodeCursor(items[items.length - 1].recordedAt, items[items.length - 1].eventId) : null, summary: { toSendMinor: num(totals.to_send), sentMinor: num(totals.sent) } };
  }

  // ---------------------------------------------------------------- settlements

  private periodSelect(party: 'VENDOR' | 'DRIVER'): { from: string; dueExpr: string; settledExpr: string; table: string; fk: string } {
    if (party === 'VENDOR') {
      return {
        table: 'vendor_settlement_periods', fk: 'vendor_period_id',
        from: `vendor_settlement_periods p JOIN vendor_branches b ON b.id = p.vendor_branch_id JOIN vendors v ON v.id = b.vendor_id`,
        dueExpr: 'p.total_commission_owed_minor',
        settledExpr: `coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED'), 0)`,
      };
    }
    return {
      table: 'driver_settlement_periods', fk: 'driver_period_id',
      from: `driver_settlement_periods p JOIN drivers d ON d.id = p.driver_id JOIN users u ON u.id = d.user_id`,
      dueExpr: 'abs(p.net_payable_minor)',
      settledExpr: `coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED'), 0)`,
    };
  }

  async listPeriods(party: 'VENDOR' | 'DRIVER', q: { partyId?: string; paymentStatus?: string; from?: string; to?: string; page?: string | number; limit?: string | number }) {
    const s = this.periodSelect(party);
    const params: unknown[] = [];
    const where: string[] = [`p.status = 'CLOSED'`, 'p.deleted_at IS NULL'];
    addCairoRange(where, params, 'p.period_end', q.from, q.to);
    const id = assertUuid(q.partyId, 'partyId');
    if (id) { params.push(id); where.push(party === 'VENDOR' ? `p.vendor_branch_id = $${params.length}` : `p.driver_id = $${params.length}`); }
    const { page, limit, offset } = pageParams(q);
    const partyCols = party === 'VENDOR'
      ? `p.vendor_branch_id AS party_id, v.name AS vendor_name, b.name AS party_name, p.gross_sales_minor, p.total_commission_owed_minor`
      : `p.driver_id AS party_id, u.full_name AS party_name, p.total_earnings_minor, p.total_commission_owed_minor, p.total_reimbursements_owed_minor, p.net_payable_minor`;
    const base = `SELECT p.id, p.period_start, p.period_end, p.closed_at, ${partyCols}, ${s.dueExpr} AS due, ${s.settledExpr} AS settled FROM ${s.from} WHERE ${where.join(' AND ')}`;
    const wrapped = `SELECT t.*, ${STATUS_SQL('t.due', 't.settled')} AS payment_status FROM (${base}) t`;
    const filtered = q.paymentStatus ? `SELECT * FROM (${wrapped}) w WHERE w.payment_status = $${params.length + 1}` : wrapped;
    const fParams = q.paymentStatus ? [...params, q.paymentStatus] : params;
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM (${filtered}) c`, fParams);
    const rows = await this.ds.query(`SELECT * FROM (${filtered}) r ORDER BY r.period_end DESC, r.id LIMIT ${limit} OFFSET ${offset}`, fParams);
    const items = rows.map((r: any) => this.periodView(party, r));
    return { items, page, limit, total };
  }

  private periodView(party: 'VENDOR' | 'DRIVER', r: any) {
    const due = party === 'VENDOR' ? vendorPeriodDue(num(r.total_commission_owed_minor)) : driverPeriodDue(num(r.net_payable_minor));
    const settled = num(r.settled);
    return {
      id: r.id, party, partyId: r.party_id, partyName: r.party_name, vendorName: r.vendor_name ?? null,
      periodStart: new Date(r.period_start).toISOString(), periodEnd: new Date(r.period_end).toISOString(), closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
      grossSalesMinor: party === 'VENDOR' ? num(r.gross_sales_minor) : null,
      totalEarningsMinor: party === 'DRIVER' ? num(r.total_earnings_minor) : null,
      commissionMinor: num(r.total_commission_owed_minor),
      reimbursementsMinor: party === 'DRIVER' ? num(r.total_reimbursements_owed_minor) : null,
      netPayableMinor: party === 'DRIVER' ? num(r.net_payable_minor) : null,
      direction: due.direction, dueMinor: due.dueMinor, settledMinor: settled, remainingMinor: remainingMinor(due.dueMinor, settled),
      paymentStatus: derivePaymentStatus(due.dueMinor, settled),
    };
  }

  async periodStatement(party: 'VENDOR' | 'DRIVER', id: string) {
    assertUuid(id, 'id');
    const s = this.periodSelect(party);
    const partyCols = party === 'VENDOR'
      ? `p.vendor_branch_id AS party_id, v.name AS vendor_name, b.name AS party_name, p.gross_sales_minor, p.total_commission_owed_minor`
      : `p.driver_id AS party_id, u.full_name AS party_name, p.total_earnings_minor, p.total_commission_owed_minor, p.total_reimbursements_owed_minor, p.net_payable_minor`;
    const [r] = await this.ds.query(`SELECT p.id, p.period_start, p.period_end, p.closed_at, ${partyCols}, ${s.dueExpr} AS due, ${s.settledExpr} AS settled FROM ${s.from} WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
    if (!r) throw new NotFoundException('Settlement period not found.');
    const period = this.periodView(party, r);
    const payments = await this.ds.query(
      `SELECT x.*, u.full_name AS recorded_by_name FROM settlement_payments x LEFT JOIN users u ON u.id = x.recorded_by_user_id WHERE x.${s.fk} = $1 ORDER BY x.created_at`,
      [id],
    );
    let lines: Array<Record<string, unknown>> = [];
    let exceptions: string[] = [];
    if (party === 'VENDOR') {
      const commission = await this.ds.query(
        `SELECT e.id, e.created_at, e.amount_minor, e.order_id, o.order_number, e.rate_snapshot FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id
          WHERE e.vendor_branch_id = $1 AND e.type = 'VENDOR_COMMISSION_RECOGNIZED' AND e.created_at >= $2 AND e.created_at < $3 ORDER BY e.created_at`,
        [r.party_id, r.period_start, r.period_end],
      );
      const sales = await this.ds.query(
        `SELECT s.id, s.created_at, s.subtotal_minor, s.order_id, o.order_number, s.status FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
          WHERE s.vendor_branch_id = $1 AND s.group_type = 'CATALOG' AND s.status <> 'CANCELLED' AND s.created_at >= $2 AND s.created_at < $3 ORDER BY s.created_at`,
        [r.party_id, r.period_start, r.period_end],
      );
      const bySeg = new Map<string, number>();
      for (const c of commission) bySeg.set(c.order_id, (bySeg.get(c.order_id) ?? 0) + num(c.amount_minor));
      lines = sales.map((x: any) => ({ orderId: x.order_id, orderNumber: x.order_number, at: new Date(x.created_at).toISOString(), segmentSubtotalMinor: num(x.subtotal_minor), commissionMinor: bySeg.get(x.order_id) ?? 0 }));
      const lineCommission = commission.reduce((t: number, c: any) => t + num(c.amount_minor), 0);
      const lineGross = sales.reduce((t: number, x: any) => t + num(x.subtotal_minor), 0);
      if (lineCommission !== num(r.total_commission_owed_minor)) exceptions.push(`COMMISSION_MISMATCH stored=${num(r.total_commission_owed_minor)} lines=${lineCommission}`);
      if (lineGross !== num(r.gross_sales_minor)) exceptions.push(`GROSS_MISMATCH stored=${num(r.gross_sales_minor)} lines=${lineGross}`);
    } else {
      const events = await this.ds.query(
        `SELECT e.id, e.created_at, e.type, e.amount_minor, e.order_id, o.order_number, e.rate_snapshot FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id
          WHERE e.driver_id = $1 AND e.type IN ('DRIVER_COMMISSION_RECOGNIZED','DRIVER_REIMBURSEMENT_OWED') AND e.created_at >= $2 AND e.created_at < $3 ORDER BY e.created_at`,
        [r.party_id, r.period_start, r.period_end],
      );
      lines = events.map((e: any) => ({ eventId: e.id, orderId: e.order_id, orderNumber: e.order_number, at: new Date(e.created_at).toISOString(), type: e.type, amountMinor: num(e.amount_minor), earningsMinor: e.type === 'DRIVER_COMMISSION_RECOGNIZED' ? num((e.rate_snapshot as any)?.baseAmountMinor) : null }));
      const comm = events.filter((e: any) => e.type === 'DRIVER_COMMISSION_RECOGNIZED').reduce((t: number, e: any) => t + num(e.amount_minor), 0);
      const reimb = events.filter((e: any) => e.type === 'DRIVER_REIMBURSEMENT_OWED').reduce((t: number, e: any) => t + num(e.amount_minor), 0);
      if (comm !== num(r.total_commission_owed_minor)) exceptions.push(`COMMISSION_MISMATCH stored=${num(r.total_commission_owed_minor)} lines=${comm}`);
      if (reimb !== num(r.total_reimbursements_owed_minor)) exceptions.push(`REIMBURSEMENT_MISMATCH stored=${num(r.total_reimbursements_owed_minor)} lines=${reimb}`);
    }
    return {
      period, lines, exceptions,
      payments: payments.map((x: any) => ({ id: x.id, direction: x.direction, amountMinor: num(x.amount_minor), method: x.method, reference: x.reference, paidOn: x.paid_on instanceof Date ? x.paid_on.toISOString().slice(0, 10) : String(x.paid_on).slice(0, 10), status: x.status, overpaymentAuthorised: x.overpayment_authorised, overpaymentReason: x.overpayment_reason, recordedBy: x.recorded_by_name, voidedAt: x.voided_at, voidReason: x.void_reason, createdAt: new Date(x.created_at).toISOString() })),
      accountingNote: party === 'VENDOR'
        ? 'Vendor settlement is a receivable for Hatly: the commission the vendor owes. Gross sales are shown for reference and are not an amount Hatly owes the vendor.'
        : 'Driver settlement: net payable = earnings − commission + reimbursements. Positive: Hatly pays the driver. Negative: the driver owes Hatly.',
    };
  }

  async summary() {
    const l = await this.liabilities();
    return { vendorCommissionReceivableMinor: l.vendorCommissionReceivableMinor, driverPayableMinor: l.driverPayableMinor, driverReceivableMinor: l.driverReceivableMinor, asOf: l.asOf };
  }

  // ---------------------------------------------------------------- settlement payments (B5)

  async recordPayment(
    party: 'VENDOR' | 'DRIVER',
    periodId: string,
    input: { amountMinor: number; method: string; reference?: string; paidOn: string; allowOverpayment?: boolean; overpaymentReason?: string },
    actor: { id: string },
    idempotencyKey: string,
    mayAuthoriseOverpayment: boolean,
  ) {
    assertUuid(periodId, 'periodId');
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new BadRequestException({ message: 'amountMinor must be a positive integer.', details: { code: 'VALIDATION_FAILED' } });
    const paidOn = assertDate(input.paidOn, 'paidOn');
    if (!paidOn) throw new BadRequestException({ message: 'paidOn is required.', details: { code: 'VALIDATION_FAILED' } });
    const [today] = await this.ds.query(`SELECT to_char((now() AT TIME ZONE '${REPORTING_TIMEZONE}')::date, 'YYYY-MM-DD') AS d`);
    if (paidOn > today.d) throw new BadRequestException({ message: 'The payment date cannot be in the future.', details: { code: 'FUTURE_DATE' } });
    if (!input.method || input.method.length > 30) throw new BadRequestException({ message: 'method is required (max 30 characters).', details: { code: 'VALIDATION_FAILED' } });
    if (input.allowOverpayment && (!input.overpaymentReason || input.overpaymentReason.trim().length < 5)) {
      throw new BadRequestException({ message: 'An authorised overpayment needs a reason (at least 5 characters).', details: { code: 'OVERPAYMENT_REASON_REQUIRED' } });
    }
    const s = this.periodSelect(party);

    const existing = async (m = this.ds.manager) => (await m.query(`SELECT * FROM settlement_payments WHERE idempotency_key = $1`, [idempotencyKey]))[0];
    const replay = (row: any) => {
      if (row.party_type !== party || row[s.fk] !== periodId || num(row.amount_minor) !== input.amountMinor) {
        throw new ConflictException({ message: 'This Idempotency-Key was already used for a different payment.', details: { code: 'IDEMPOTENCY_CONFLICT' } });
      }
      return { payment: this.paymentView(row), replayed: true };
    };
    const prior = await existing();
    if (prior) return replay(prior);

    try {
      return await this.ds.transaction(async (m) => {
        const [period] = await m.query(`SELECT p.* FROM ${s.table} p WHERE p.id = $1 AND p.deleted_at IS NULL FOR UPDATE`, [periodId]);
        if (!period) throw new NotFoundException('Settlement period not found.');
        if (period.status !== 'CLOSED') throw new ConflictException({ message: 'Payments can only be recorded against a CLOSED period.', details: { code: 'PERIOD_NOT_CLOSED' } });
        const due = party === 'VENDOR' ? vendorPeriodDue(num(period.total_commission_owed_minor)) : driverPeriodDue(num(period.net_payable_minor));
        const [{ settled }] = await m.query(`SELECT coalesce(sum(amount_minor), 0)::bigint AS settled FROM settlement_payments WHERE ${s.fk} = $1 AND status = 'RECORDED'`, [periodId]);
        const remaining = remainingMinor(due.dueMinor, num(settled));
        if (due.dueMinor === 0) throw new ConflictException({ message: 'Nothing is due for this period.', details: { code: 'NOTHING_DUE' } });
        let overpay = false;
        if (input.amountMinor > remaining) {
          if (!input.allowOverpayment) {
            throw new BadRequestException({ message: `The amount exceeds what is still due (${remaining} minor units). To record an overpayment it must be explicitly authorised.`, details: { code: 'EXCEEDS_REMAINING', remainingMinor: remaining } });
          }
          if (!mayAuthoriseOverpayment) throw new ForbiddenException({ message: 'You are not authorised to approve an overpayment.', details: { code: 'OVERPAYMENT_NOT_AUTHORISED' } });
          overpay = true;
        }
        const [row] = await m.query(
          `INSERT INTO settlement_payments (party_type, ${s.fk}, direction, amount_minor, method, reference, paid_on, overpayment_authorised, overpayment_reason, recorded_by_user_id, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [party, periodId, due.direction as SettlementDirection, input.amountMinor, input.method, input.reference?.slice(0, 120) ?? null, paidOn, overpay, overpay ? input.overpaymentReason!.slice(0, 300) : null, actor.id, idempotencyKey],
        );
        return { payment: this.paymentView(row), replayed: false, overpaid: overpay };
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        const winner = await existing();
        if (winner) return replay(winner);
      }
      throw error;
    }
  }

  private paymentView(row: any) {
    return {
      id: row.id, partyType: row.party_type, periodId: row.vendor_period_id ?? row.driver_period_id, direction: row.direction, amountMinor: num(row.amount_minor), method: row.method,
      reference: row.reference, paidOn: row.paid_on instanceof Date ? row.paid_on.toISOString().slice(0, 10) : String(row.paid_on).slice(0, 10), status: row.status, overpaymentAuthorised: row.overpayment_authorised,
    };
  }

  async voidPayment(id: string, reason: string, actorId: string) {
    assertUuid(id, 'id');
    if (!reason || reason.trim().length < 5) throw new BadRequestException({ message: 'A void reason is required (at least 5 characters).', details: { code: 'VALIDATION_FAILED' } });
    const rows = returned(
      await this.ds.query(
        `UPDATE settlement_payments SET status = 'VOIDED', voided_by_user_id = $2, voided_at = now(), void_reason = $3, updated_at = now() WHERE id = $1 AND status = 'RECORDED' RETURNING *`,
        [id, actorId, reason.slice(0, 300)],
      ),
    );
    if (!rows[0]) {
      const [exists] = await this.ds.query(`SELECT status FROM settlement_payments WHERE id = $1`, [id]);
      if (!exists) throw new NotFoundException('Payment not found.');
      throw new ConflictException({ message: 'This payment was already voided.', details: { code: 'ALREADY_VOIDED' } });
    }
    return this.paymentView(rows[0]);
  }
}
