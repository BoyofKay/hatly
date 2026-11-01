import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminAuditAction, AdminAuditService } from '../audit/admin-audit.service';
import { VendorStaffAuthorizationService } from '../vendors/vendor-staff-authorization.service';
import { BusinessConfigService } from '../business-config/business-config.service';
import { Actor, CAIRO, UUID_RE, bad, notFound, num } from './vendor-ops.shared';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FREQUENCIES = ['WEEKLY', 'MONTHLY'];

/**
 * The Vendor Financial Centre: a read-only statement of what the platform has RECORDED about a vendor's own branches, with each concept kept apart
 * and nothing netted into a balance the business has not defined:
 *
 *  - vendor sales: the goods value of completed, non-cancelled parts (segment subtotals);
 *  - Hatly commission receivable: the commission events Hatly recognised on those parts — what the vendor owes HATLY (the vendor ledger is a
 *    receivable of Hatly, never a gross amount payable to the vendor);
 *  - how customers paid for those parts, by payment method (a fact about collection, not a balance);
 *  - cancelled parts, whose goods were never counted as sales;
 *  - closed settlement periods and the settlement payments recorded against them, exactly as stored;
 *  - monthly history of the above.
 *
 * Not recorded by the platform today, and therefore shown as such rather than estimated: money a driver pays a vendor at pickup, and any
 * "net payable to the vendor". The settlement frequency is a per-vendor contractual term set by Hatly; without one it is "not configured".
 */
@Injectable()
export class VendorFinanceService {
  constructor(
    private readonly ds: DataSource,
    private readonly vendorAuth: VendorStaffAuthorizationService,
    private readonly audit: AdminAuditService,
    private readonly businessConfig: BusinessConfigService,
  ) {}

  async statement(user: Actor, q: { from?: string; to?: string; branchId?: string }) {
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    let ids = owned;
    if (q.branchId) {
      if (!UUID_RE.test(q.branchId) || !owned.includes(q.branchId)) throw notFound('Branch not found.');
      ids = [q.branchId];
    }
    if ((q.from && !DATE_RE.test(q.from)) || (q.to && !DATE_RE.test(q.to))) throw bad('Dates must be YYYY-MM-DD.');
    if (ids.length === 0) return this.empty();
    const range = (col: string, v: unknown[]) => {
      v.push(q.from || null, q.to || null);
      const a = v.length - 1, b = v.length;
      return `(${col} AT TIME ZONE '${CAIRO}')::date >= COALESCE($${a}::date, ((now() AT TIME ZONE '${CAIRO}')::date - 30)) AND (${col} AT TIME ZONE '${CAIRO}')::date <= COALESCE($${b}::date, (now() AT TIME ZONE '${CAIRO}')::date)`;
    };
    const done = `LEFT JOIN LATERAL (SELECT min(created_at) AS at FROM order_status_events WHERE order_id = o.id AND to_status IN ('DELIVERED','COLLECTED')) d ON true`;
    const commission = `(SELECT sum(f.amount_minor) FROM financial_events f WHERE f.order_vendor_segment_id = g.id AND f.type = 'VENDOR_COMMISSION_RECOGNIZED' AND f.direction = 'RECEIVABLE')`;

    const v1: unknown[] = [ids];
    const completed = `g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND g.status <> 'CANCELLED' AND o.status IN ('DELIVERED','COLLECTED') AND ${range('coalesce(d.at, o.updated_at)', v1)}`;
    const [sales] = await this.ds.query(`SELECT count(*)::int AS parts, coalesce(sum(g.subtotal_minor),0) AS goods, coalesce(sum(${commission}),0) AS commission FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id ${done} WHERE ${completed}`, v1);
    const byMethod = await this.ds.query(`SELECT o.payment_method AS method, count(*)::int AS parts, coalesce(sum(g.subtotal_minor),0) AS goods FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id ${done} WHERE ${completed} GROUP BY o.payment_method ORDER BY goods DESC`, v1);

    const v2: unknown[] = [ids];
    const [cancelled] = await this.ds.query(`SELECT count(*)::int AS parts, coalesce(sum(g.subtotal_minor),0) AS goods FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id WHERE g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND g.status = 'CANCELLED' AND ${range('g.updated_at', v2)}`, v2);

    const settlements = await this.ds.query(
      `SELECT s.id, b.name AS branch_name, s.frequency, s.period_start, s.period_end, s.gross_sales_minor, s.total_commission_owed_minor, s.closed_at,
              (SELECT coalesce(json_agg(json_build_object('id', p.id, 'direction', p.direction, 'amountMinor', p.amount_minor, 'method', p.method, 'paidOn', p.paid_on, 'status', p.status) ORDER BY p.paid_on, p.created_at), '[]'::json)
                 FROM settlement_payments p WHERE p.vendor_period_id = s.id) AS payments
         FROM vendor_settlement_periods s JOIN vendor_branches b ON b.id = s.vendor_branch_id WHERE s.vendor_branch_id = ANY($1) AND s.deleted_at IS NULL ORDER BY s.period_end DESC LIMIT 24`,
      [ids],
    );

    const history = await this.ds.query(
      `SELECT to_char((coalesce(d.at, o.updated_at) AT TIME ZONE '${CAIRO}'), 'YYYY-MM') AS month, count(*)::int AS parts, coalesce(sum(g.subtotal_minor),0) AS goods, coalesce(sum(${commission}),0) AS commission
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id ${done}
        WHERE g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND g.status <> 'CANCELLED' AND o.status IN ('DELIVERED','COLLECTED') AND coalesce(d.at, o.updated_at) >= now() - interval '12 months'
        GROUP BY 1 ORDER BY 1 DESC`,
      [ids],
    );

    const [terms] = await this.ds.query(`SELECT t.frequency, t.updated_at FROM vendor_settlement_terms t WHERE t.vendor_id IN (SELECT vendor_id FROM vendor_branches WHERE id = ANY($1)) ORDER BY t.updated_at DESC LIMIT 1`, [ids]);
    const branches = await this.ds.query(`SELECT id, name, commission_rate_basis_points FROM vendor_branches WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY name`, [ids]);

    return {
      terms: { settlementFrequency: terms?.frequency ?? null, updatedAt: terms?.updated_at ?? null, platformDefaultFrequency: await this.platformDefault() },
      branches: branches.map((b: any) => ({ id: b.id, name: b.name, commissionRateBasisPoints: num(b.commission_rate_basis_points) })),
      sales: { parts: sales.parts, goodsMinor: num(sales.goods) },
      commissionReceivable: { minor: num(sales.commission), note: 'Commission recognised by Hatly on the completed parts above — owed by the vendor to Hatly.' },
      customerPayments: byMethod.map((m: any) => ({ method: m.method, parts: m.parts, goodsMinor: num(m.goods) })),
      cancelledParts: { parts: cancelled.parts, goodsMinor: num(cancelled.goods) },
      driverPaymentsToVendor: { recorded: false },
      netPayableToVendor: { defined: false },
      settlements: settlements.map((s: any) => ({ id: s.id, branchName: s.branch_name, frequency: s.frequency, periodStart: s.period_start, periodEnd: s.period_end, grossSalesMinor: num(s.gross_sales_minor), commissionOwedMinor: num(s.total_commission_owed_minor), closedAt: s.closed_at, payments: (s.payments ?? []).map((p: any) => ({ ...p, amountMinor: num(p.amountMinor) })) })),
      history: history.map((h: any) => ({ month: h.month, parts: h.parts, goodsMinor: num(h.goods), commissionMinor: num(h.commission) })),
    };
  }

  /** The platform-wide settlement frequency, used for any vendor without a contractual one. Null when Hatly never configured it. */
  private async platformDefault(): Promise<string | null> {
    try {
      return await this.businessConfig.getVendorSettlementFrequency();
    } catch {
      return null;
    }
  }

  /** Integer minor units → "12.50" by string arithmetic only (the platform never does money maths in floats). */
  private egp(minor: unknown): string {
    if (minor == null) return '';
    const n = BigInt(String(minor));
    const neg = n < 0n;
    const abs = neg ? -n : n;
    return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  }

  /** A CSV cell that can never be read as a spreadsheet formula (prefixed) and is quoted when needed. */
  private cell(v: unknown): string {
    let t = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }

  /**
   * The completed parts of the caller's own branches as CSV — order number, completion day (Cairo), branch, payment method, goods and the
   * commission Hatly recognised. Never any customer data. Up to 20,000 rows; a longer range is refused so nothing is silently cut.
   */
  async exportCsv(user: Actor, q: { from?: string; to?: string; branchId?: string }): Promise<string> {
    const owned = await this.vendorAuth.getOwnedBranchIds(user.id);
    let ids = owned;
    if (q.branchId) {
      if (!UUID_RE.test(q.branchId) || !owned.includes(q.branchId)) throw notFound('Branch not found.');
      ids = [q.branchId];
    }
    if ((q.from && !DATE_RE.test(q.from)) || (q.to && !DATE_RE.test(q.to))) throw bad('Dates must be YYYY-MM-DD.');
    const header = ['order_number', 'completed_on', 'branch', 'payment_method', 'goods_egp', 'commission_owed_to_hatly_egp'];
    if (ids.length === 0) return header.join(',') + '\n';
    const commission = `(SELECT sum(f.amount_minor) FROM financial_events f WHERE f.order_vendor_segment_id = g.id AND f.type = 'VENDOR_COMMISSION_RECOGNIZED' AND f.direction = 'RECEIVABLE')`;
    const rows = await this.ds.query(
      `SELECT o.order_number, to_char((coalesce(d.at, o.updated_at) AT TIME ZONE '${CAIRO}')::date, 'YYYY-MM-DD') AS completed_on, b.name AS branch, o.payment_method, g.subtotal_minor, ${commission} AS commission_minor
         FROM order_vendor_segments g JOIN orders o ON o.id = g.order_id JOIN vendor_branches b ON b.id = g.vendor_branch_id
         LEFT JOIN LATERAL (SELECT min(created_at) AS at FROM order_status_events WHERE order_id = o.id AND to_status IN ('DELIVERED','COLLECTED')) d ON true
        WHERE g.vendor_branch_id = ANY($1) AND g.group_type = 'CATALOG' AND g.status <> 'CANCELLED' AND o.status IN ('DELIVERED','COLLECTED')
          AND (coalesce(d.at, o.updated_at) AT TIME ZONE '${CAIRO}')::date >= COALESCE($2::date, ((now() AT TIME ZONE '${CAIRO}')::date - 30))
          AND (coalesce(d.at, o.updated_at) AT TIME ZONE '${CAIRO}')::date <= COALESCE($3::date, (now() AT TIME ZONE '${CAIRO}')::date)
        ORDER BY completed_on DESC, o.order_number LIMIT 20001`,
      [ids, q.from || null, q.to || null],
    );
    if (rows.length > 20000) throw bad('That range has more than 20,000 rows. Choose a shorter range.', 'EXPORT_TOO_LARGE');
    const lines = rows.map((r: any) => [r.order_number, r.completed_on, r.branch, r.payment_method, this.egp(r.subtotal_minor), this.egp(r.commission_minor)].map((c) => this.cell(c)).join(','));
    return '\ufeff' + [header.join(','), ...lines].join('\n') + '\n';
  }

  private empty() {
    return { terms: { settlementFrequency: null, updatedAt: null }, branches: [], sales: { parts: 0, goodsMinor: 0 }, commissionReceivable: { minor: 0, note: '' }, customerPayments: [], cancelledParts: { parts: 0, goodsMinor: 0 }, driverPaymentsToVendor: { recorded: false }, netPayableToVendor: { defined: false }, settlements: [], history: [] };
  }

  // ----------------------------------------------------------------------------------------------------------------------- Admin: terms

  async getTerms(vendorId: string) {
    if (!UUID_RE.test(vendorId ?? '')) throw notFound('Vendor not found.');
    const [v] = await this.ds.query(`SELECT id, name FROM vendors WHERE id = $1 AND deleted_at IS NULL`, [vendorId]);
    if (!v) throw notFound('Vendor not found.');
    const [t] = await this.ds.query(`SELECT t.frequency, t.updated_at, u.full_name AS updated_by FROM vendor_settlement_terms t JOIN users u ON u.id = t.updated_by_user_id WHERE t.vendor_id = $1`, [vendorId]);
    return { vendorId, vendorName: v.name, frequency: t?.frequency ?? null, updatedAt: t?.updated_at ?? null, updatedBy: t?.updated_by ?? null };
  }

  /** `frequency: null` clears the term back to "not configured". Only WEEKLY or MONTHLY exist; any other value is refused. */
  async setTerms(actor: Actor, vendorId: string, frequency: unknown) {
    const before = await this.getTerms(vendorId);
    if (frequency !== null && !FREQUENCIES.includes(String(frequency))) throw bad('The settlement frequency must be WEEKLY or MONTHLY (or empty for "not configured").');
    if (frequency === null) await this.ds.query(`DELETE FROM vendor_settlement_terms WHERE vendor_id = $1`, [vendorId]);
    else await this.ds.query(`INSERT INTO vendor_settlement_terms (vendor_id, frequency, updated_by_user_id) VALUES ($1,$2,$3) ON CONFLICT (vendor_id) DO UPDATE SET frequency = EXCLUDED.frequency, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`, [vendorId, frequency, actor.id]);
    await this.audit.record({ actorUserId: actor.id, actorRole: actor.role, action: AdminAuditAction.VENDOR_SETTLEMENT_TERMS_SET, targetType: 'vendor', targetId: vendorId, metadata: { from: before.frequency ?? 'NOT_CONFIGURED', to: frequency === null ? 'NOT_CONFIGURED' : String(frequency) } });
    return this.getTerms(vendorId);
  }
}
