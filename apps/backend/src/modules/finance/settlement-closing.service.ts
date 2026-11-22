import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'crypto';
import { courierOrderLine, courierTotals, CourierOrderLine, UnresolvedReason } from './courier-settlement-math';
import { BusinessConfigService } from '../business-config/business-config.service';
import { derivePaymentStatus, driverPeriodDue, remainingMinor, vendorPeriodDue } from '../admin-platform/finance/settlement-status';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const notFound = (what: string) => new NotFoundException({ message: `${what} not found.`, details: { code: 'NOT_FOUND' } });
const assertUuid = (id: string, what: string) => {
  if (!UUID_RE.test(id ?? '')) throw notFound(what);
};
/** Minutes east of UTC that Africa/Cairo observes at `at` (handles Egyptian summer time). */
const cairoOffsetMinutes = (at: Date) => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2';
  const m = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(name);
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 120;
};
/** The first instant of the Cairo calendar day `YYYY-MM-DD`. */
export const cairoMidnight = (day: string) => {
  const utcMidnight = new Date(`${day}T00:00:00Z`);
  const guess = new Date(utcMidnight.getTime() - cairoOffsetMinutes(utcMidnight) * 60_000);
  return new Date(utcMidnight.getTime() - cairoOffsetMinutes(guess) * 60_000);
};

/** The money parts of a courier line, as stored (driver_settlement_period_orders) — one column each (R31). */
export const COURIER_MONEY_COLUMNS: Array<[keyof CourierOrderLine, string]> = [
  ['feeEntitlementMinor', 'fee_entitlement_minor'], ['commissionMinor', 'commission_minor'], ['courierCompensationMinor', 'courier_compensation_minor'],
  ['goodsPaidToStoresMinor', 'goods_paid_to_stores_minor'], ['goodsPassThroughMinor', 'goods_pass_through_minor'], ['goodsReimbursementMinor', 'goods_reimbursement_minor'],
  ['cashCollectedMinor', 'cash_collected_minor'], ['cashHeldMinor', 'cash_held_minor'], ['changeKeptMinor', 'change_kept_minor'],
  ['collectedByHatlyMinor', 'collected_by_hatly_minor'], ['netToCourierMinor', 'net_to_courier_minor'],
];
/** Period totals stored on driver_settlement_periods (net goes to the existing net_payable_minor; commission to total_commission_owed_minor). */
const COURIER_PERIOD_COLUMNS = COURIER_MONEY_COLUMNS.filter(([k]) => k !== 'netToCourierMinor' && k !== 'commissionMinor');

export interface CourierPreviewLine extends CourierOrderLine {
  orderId: string;
  orderNumber: string;
  paymentMethod: string;
  deliveredAt: string | null;
  deliveryId: string | null;
  commissionEventId: string | null;
}
export interface UnresolvedItem {
  orderId: string;
  orderNumber: string;
  status: string;
  reason: UnresolvedReason | 'IN_PROGRESS' | 'FAILED_DELIVERY_NEEDS_RESOLUTION' | 'CANCELLED_AFTER_EXPENSE_NEEDS_DECISION';
}

/**
 * Courier shift closing and vendor period closing (2026-11-13).
 *
 * COURIER (R29, register default window): a closing settles every DELIVERED order of the courier that no closing has settled yet, with the
 * per-order arithmetic in courier-settlement-math.ts. Orders still on the road, failed deliveries waiting for Operations (R36), orders
 * cancelled after the courier had paid a store (R45) and delivered orders that cannot be computed (no commission rate R43, legacy
 * pay-at-delivery R20, change claim under review) are listed as UNRESOLVED and carried to a later closing — never silently settled.
 *
 * VENDOR (R32/R33/R35): a closing covers every non-cancelled catalog part of the branch handed over (driver pickup or customer collection —
 * the moment the vendor commission is recognised) up to the chosen end, not yet covered by a closing. The amount due is the commission the
 * vendor owes Hatly (R32: the courier pays the vendor at pickup, so Hatly holds no vendor money; nothing is netted). Parts without a
 * commission rate are listed and flagged (R43) with no commission assumed.
 *
 * SAFETY: the same order (courier) / segment (vendor) can belong to ONE closing only — UNIQUE indexes, a per-party advisory lock in the
 * closing transaction, and an optional preview token: if what is eligible changed since the operator's preview, the close is refused.
 * Closings never change an order's status and never edit or create financial events; payments against a closing use the existing
 * settlement_payments (partial / void with reason).
 */
@Injectable()
export class SettlementClosingService {
  constructor(
    private readonly ds: DataSource,
    private readonly businessConfig: BusinessConfigService,
  ) {}

  // ================================================================================================================================ courier

  /** Couriers for the closing screen: every active courier, with how many delivered orders wait for a closing and when they last closed. */
  async openCouriers() {
    const rows: any[] = await this.ds.query(
      `SELECT d.id, u.full_name, u.phone,
              (SELECT count(*)::int FROM deliveries dl JOIN orders o ON o.id = dl.order_id
                WHERE dl.driver_id = d.id AND o.status = 'DELIVERED' AND o.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM driver_settlement_period_orders x WHERE x.order_id = o.id)
                  AND NOT EXISTS (SELECT 1 FROM driver_settlement_periods p WHERE p.driver_id = d.id AND p.method_version = 1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL
                                   AND EXISTS (SELECT 1 FROM financial_events le WHERE le.order_id = o.id AND le.driver_id = d.id
                                                AND le.type IN ('DRIVER_COMMISSION_RECOGNIZED','DRIVER_REIMBURSEMENT_OWED')
                                                AND le.created_at >= p.period_start AND le.created_at < p.period_end))) AS delivered_open,
              (SELECT count(*)::int FROM deliveries dl JOIN orders o ON o.id = dl.order_id
                WHERE dl.driver_id = d.id AND o.deleted_at IS NULL AND o.status IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY')) AS in_progress,
              (SELECT max(p.closed_at) FROM driver_settlement_periods p WHERE p.driver_id = d.id AND p.status = 'CLOSED' AND p.deleted_at IS NULL) AS last_closed_at
         FROM drivers d JOIN users u ON u.id = d.user_id
        WHERE d.deleted_at IS NULL
        ORDER BY 4 DESC, u.full_name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.full_name, phone: r.phone, deliveredOpen: r.delivered_open, inProgress: r.in_progress, lastClosedAt: iso(r.last_closed_at) }));
  }

  /**
   * Stage 3 (2026-11-13) "Drivers today": one row per courier for the office — today's activity, what the NEXT closing would settle (the same
   * figures as the preview: courierFacts + courierTotals, nothing recomputed) and what is still unpaid on earlier closings (the stored due
   * amount less the recorded payments, as the statement derives it). Read-only.
   */
  async couriersToday() {
    const rows: any[] = await this.ds.query(
      `SELECT d.id, u.full_name, u.phone, d.is_online, d.last_seen_at,
              (SELECT count(*)::int FROM deliveries x JOIN orders o ON o.id = x.order_id
                WHERE x.driver_id = d.id AND x.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY')) AS in_progress,
              GREATEST(1, COALESCE(d.capacity_override, (SELECT v.max_active_deliveries FROM vehicle_types v WHERE v.id = d.vehicle_type_id), 1))::int AS capacity,
              (SELECT count(DISTINCT se.order_id)::int FROM order_status_events se JOIN deliveries x ON x.order_id = se.order_id AND x.driver_id = d.id
                WHERE se.to_status = 'DELIVERED' AND (se.created_at AT TIME ZONE 'Africa/Cairo')::date = (now() AT TIME ZONE 'Africa/Cairo')::date) AS delivered_today,
              (SELECT count(*)::int FROM deliveries dl JOIN orders o ON o.id = dl.order_id
                WHERE dl.driver_id = d.id AND o.status = 'DELIVERED' AND o.deleted_at IS NULL
                  AND NOT EXISTS (SELECT 1 FROM driver_settlement_period_orders x WHERE x.order_id = o.id)) AS delivered_unsettled,
              (SELECT row_to_json(p) FROM (SELECT reference, closed_at FROM driver_settlement_periods
                WHERE driver_id = d.id AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1) p) AS last_closing
         FROM drivers d JOIN users u ON u.id = d.user_id
        WHERE d.deleted_at IS NULL
        ORDER BY u.full_name`,
    );
    const unpaid: any[] = await this.ds.query(
      `SELECT p.id, p.driver_id, p.reference, p.closed_at, p.net_payable_minor,
              coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED'), 0) AS settled
         FROM driver_settlement_periods p
        WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL AND p.net_payable_minor <> 0
        ORDER BY p.closed_at`,
    );
    const unpaidBy = new Map<string, Array<{ periodId: string; reference: string | null; closedAt: string | null; direction: 'PAYOUT' | 'COLLECTION'; remainingMinor: number }>>();
    for (const u of unpaid) {
      const due = driverPeriodDue(num(u.net_payable_minor));
      const remaining = remainingMinor(due.dueMinor, num(u.settled));
      if (remaining <= 0) continue;
      unpaidBy.set(u.driver_id, [...(unpaidBy.get(u.driver_id) ?? []), { periodId: u.id, reference: u.reference, closedAt: iso(u.closed_at), direction: due.direction, remainingMinor: remaining }]);
    }
    const out = [];
    for (const r of rows) {
      // the closing figures are a real query per courier: only for those with delivered orders not in a closing yet
      const { lines, unresolved } = r.delivered_unsettled > 0 ? await this.courierFacts(this.ds.manager, r.id) : { lines: [] as CourierOrderLine[], unresolved: [] as Array<{ reason: string }> };
      const totals = courierTotals(lines);
      const owed = unpaidBy.get(r.id) ?? [];
      const item = {
        id: r.id, name: r.full_name, phone: r.phone, online: Boolean(r.is_online), lastSeenAt: iso(r.last_seen_at),
        inProgress: r.in_progress, capacity: r.capacity, deliveredToday: r.delivered_today,
        open: { orders: totals.orders, codOrders: totals.codOrders, electronicOrders: totals.electronicOrders, netToCourierMinor: totals.netToCourierMinor, cashHeldMinor: totals.cashHeldMinor, held: unresolved.filter((u) => u.reason !== 'IN_PROGRESS').length },
        unpaidClosings: owed,
        lastClosing: r.last_closing ? { reference: r.last_closing.reference, closedAt: iso(r.last_closing.closed_at) } : null,
      };
      out.push({ ...item, relevant: item.online || item.inProgress > 0 || item.deliveredToday > 0 || item.open.orders > 0 || item.open.held > 0 || owed.length > 0 });
    }
    // the ones the office must deal with first: something to close, then something unpaid, then the rest
    out.sort((a, b) => Number(b.open.orders > 0) - Number(a.open.orders > 0) || Number(b.unpaidClosings.length > 0) - Number(a.unpaidClosings.length > 0) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    return out;
  }

  /** Vendor branches for the closing screen, with how many handed-over parts wait for a closing. */
  async openVendorBranches() {
    const rows: any[] = await this.ds.query(
      `SELECT b.id, b.name AS branch_name, v.name AS vendor_name, v.name_ar AS vendor_name_ar, coalesce(t.frequency, NULL) AS frequency,
              (SELECT count(*)::int FROM order_vendor_segments s
                WHERE s.vendor_branch_id = b.id AND s.deleted_at IS NULL AND s.group_type = 'CATALOG' AND s.status <> 'CANCELLED'
                  AND EXISTS (SELECT 1 FROM order_status_events se WHERE se.order_id = s.order_id AND se.to_status IN ('PICKED_UP','COLLECTED'))
                  AND NOT EXISTS (SELECT 1 FROM vendor_settlement_period_lines x WHERE x.segment_id = s.id)) AS parts_open,
              (SELECT max(p.closed_at) FROM vendor_settlement_periods p WHERE p.vendor_branch_id = b.id AND p.status = 'CLOSED' AND p.deleted_at IS NULL) AS last_closed_at
         FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN vendor_settlement_terms t ON t.vendor_id = v.id
        WHERE b.deleted_at IS NULL AND v.deleted_at IS NULL
        ORDER BY 6 DESC, v.name, b.name`,
    );
    return rows.map((r) => ({ id: r.id, vendorName: r.vendor_name, vendorNameAr: r.vendor_name_ar, branchName: r.branch_name, frequency: r.frequency, partsOpen: r.parts_open, lastClosedAt: iso(r.last_closed_at) }));
  }

  private async courierFacts(m: EntityManager, driverId: string) {
    // Delivered orders of this courier not yet settled by a closing; legacy (event-window) closings keep what they covered.
    const rows: any[] = await m.query(
      `SELECT o.id, o.order_number, o.payment_method, o.total_minor, o.amount_due_minor, d.id AS delivery_id,
              (SELECT max(se.created_at) FROM order_status_events se WHERE se.order_id = o.id AND se.to_status = 'DELIVERED') AS delivered_at,
              coalesce((SELECT sum(s.subtotal_minor) FROM order_vendor_segments s
                         WHERE s.order_id = o.id AND s.deleted_at IS NULL AND s.group_type = 'CATALOG' AND s.vendor_branch_id IS NOT NULL AND s.status <> 'CANCELLED'), 0)
              + coalesce((SELECT sum(a.amount_minor) FROM ad_hoc_purchase_records a JOIN order_items i ON i.id = a.order_item_id
                         JOIN order_vendor_segments g ON g.id = i.order_vendor_segment_id WHERE g.order_id = o.id), 0) AS goods,
              coalesce((SELECT sum(r.remainder_amount_minor) FROM driver_cash_remainders r WHERE r.order_id = o.id AND r.status = 'APPROVED'), 0) AS change_approved,
              EXISTS (SELECT 1 FROM driver_cash_remainders r WHERE r.order_id = o.id AND r.status = 'PENDING_REVIEW') AS change_pending,
              e.id AS commission_event_id, e.amount_minor AS commission, (e.rate_snapshot ->> 'baseAmountMinor') AS fee
         FROM orders o
         JOIN deliveries d ON d.order_id = o.id AND d.deleted_at IS NULL
         LEFT JOIN financial_events e ON e.order_id = o.id AND e.type = 'DRIVER_COMMISSION_RECOGNIZED' AND e.driver_id = $1 AND e.deleted_at IS NULL
        WHERE d.driver_id = $1 AND o.deleted_at IS NULL AND o.status = 'DELIVERED'
          AND NOT EXISTS (SELECT 1 FROM driver_settlement_period_orders x WHERE x.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM driver_settlement_periods p
                           WHERE p.driver_id = $1 AND p.method_version = 1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL
                             AND EXISTS (SELECT 1 FROM financial_events le WHERE le.order_id = o.id AND le.driver_id = $1
                                          AND le.type IN ('DRIVER_COMMISSION_RECOGNIZED','DRIVER_REIMBURSEMENT_OWED')
                                          AND le.created_at >= p.period_start AND le.created_at < p.period_end))
        ORDER BY delivered_at NULLS LAST, o.order_number`,
      [driverId],
    );
    const lines: CourierPreviewLine[] = [];
    const unresolved: UnresolvedItem[] = [];
    for (const r of rows) {
      const res = courierOrderLine({
        paymentMethod: r.payment_method,
        totalMinor: num(r.total_minor),
        amountDueMinor: r.amount_due_minor == null ? null : num(r.amount_due_minor),
        goodsPaidToStoresMinor: num(r.goods),
        approvedChangeMinor: num(r.change_approved),
        feeEntitlementMinor: r.commission_event_id && r.fee != null ? num(r.fee) : null,
        commissionMinor: r.commission_event_id ? num(r.commission) : null,
        changePendingReview: Boolean(r.change_pending),
      });
      if ('unresolved' in res) unresolved.push({ orderId: r.id, orderNumber: r.order_number, status: 'DELIVERED', reason: res.unresolved });
      else lines.push({ orderId: r.id, orderNumber: r.order_number, paymentMethod: r.payment_method, deliveredAt: iso(r.delivered_at), deliveryId: r.delivery_id, commissionEventId: r.commission_event_id, ...res.line });
    }
    // Not yet settleable at all: still with the courier, or waiting for an Operations decision.
    const open: any[] = await m.query(
      `SELECT o.id, o.order_number, o.status,
              EXISTS (SELECT 1 FROM financial_events e WHERE e.order_id = o.id AND e.type = 'CANCELLATION_WITH_PRIOR_EXPENSE_RECORDED' AND e.deleted_at IS NULL) AS cancelled_after_expense,
              EXISTS (SELECT 1 FROM failed_delivery_resolutions f WHERE f.order_id = o.id) AS failed_resolved
         FROM orders o JOIN deliveries d ON d.order_id = o.id AND d.deleted_at IS NULL
        WHERE d.driver_id = $1 AND o.deleted_at IS NULL AND o.status IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY','FAILED_DELIVERY','CANCELLED')
          AND NOT EXISTS (SELECT 1 FROM driver_settlement_period_orders x WHERE x.order_id = o.id)
        ORDER BY o.created_at`,
      [driverId],
    );
    for (const r of open) {
      if (r.status === 'FAILED_DELIVERY') {
        if (!r.failed_resolved) unresolved.push({ orderId: r.id, orderNumber: r.order_number, status: r.status, reason: 'FAILED_DELIVERY_NEEDS_RESOLUTION' });
      } else if (r.status === 'CANCELLED') {
        if (r.cancelled_after_expense) unresolved.push({ orderId: r.id, orderNumber: r.order_number, status: r.status, reason: 'CANCELLED_AFTER_EXPENSE_NEEDS_DECISION' });
      } else {
        unresolved.push({ orderId: r.id, orderNumber: r.order_number, status: r.status, reason: 'IN_PROGRESS' });
      }
    }
    return { lines, unresolved };
  }

  private static token(ids: Array<{ id: string; net: number }>): string {
    return createHash('sha256').update(ids.map((x) => `${x.id}:${x.net}`).sort().join('|')).digest('hex').slice(0, 32);
  }

  async courierPreview(driverId: string, m: EntityManager = this.ds.manager) {
    assertUuid(driverId, 'Courier');
    const [driver] = await m.query(`SELECT d.id, d.user_id, u.full_name, u.phone, d.commission_rate_basis_points FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = $1 AND d.deleted_at IS NULL`, [driverId]);
    if (!driver) throw notFound('Courier');
    // Owner decision 2026-11-22: money lent to the driver (employee loan) is his liability and is handed back at settlement — shown here so
    // the closing never misses it. Informational: it does not change the closing amounts; repayments are recorded on the loan itself.
    const loanRows: Array<{ id: string; borrowed: string; repaid: string; issued_at: Date; reason: string | null }> = await m.query(
      `SELECT l.id, l.borrowed_amount_minor AS borrowed, COALESCE((SELECT sum(r.amount_minor) FROM employee_loan_repayments r WHERE r.employee_loan_id = l.id), 0) AS repaid, l.issued_at, l.reason
         FROM employee_loans l WHERE l.employee_user_id = $1 AND l.deleted_at IS NULL ORDER BY l.issued_at`,
      [driver.user_id],
    );
    const loans = loanRows
      .map((l) => ({ id: l.id, borrowedMinor: Number(l.borrowed), outstandingMinor: Number(l.borrowed) - Number(l.repaid), issuedAt: iso(l.issued_at), reason: l.reason }))
      .filter((l) => l.outstandingMinor > 0);
    const [prev] = await m.query(`SELECT period_end, reference FROM driver_settlement_periods WHERE driver_id = $1 AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1`, [driverId]);
    const { lines, unresolved } = await this.courierFacts(m, driverId);
    const totals = courierTotals(lines);
    return {
      courier: { id: driver.id, userId: driver.user_id, name: driver.full_name, commissionRateBasisPoints: driver.commission_rate_basis_points },
      previousClosing: prev ? { periodEnd: iso(prev.period_end), reference: prev.reference } : null,
      lines,
      unresolved,
      totals,
      direction: totals.netToCourierMinor >= 0 ? 'PAYOUT' : 'COLLECTION',
      loans: { outstandingMinor: loans.reduce((s, l) => s + l.outstandingMinor, 0), items: loans },
      previewToken: SettlementClosingService.token(lines.map((l) => ({ id: l.orderId, net: l.netToCourierMinor }))),
    };
  }

  async closeCourier(driverId: string, actorUserId: string, opts: { previewToken?: string } = {}) {
    assertUuid(driverId, 'Courier');
    try {
      return await this.ds.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtext('driver-settlement:' || $1))`, [driverId]);
        const preview = await this.courierPreview(driverId, m);
        if (opts.previewToken && opts.previewToken !== preview.previewToken) {
          throw new ConflictException({ message: 'The orders to settle changed since your preview (they may have just been settled by another closing). Review the new preview and confirm again.', details: { code: 'PREVIEW_CHANGED' } });
        }
        if (preview.lines.length === 0) throw new BadRequestException({ message: 'No delivered orders to settle since the last closing.', details: { code: 'NOTHING_TO_CLOSE' } });
        const now = new Date();
        const firstDelivered = preview.lines.map((l) => l.deliveredAt).filter(Boolean).sort()[0];
        const periodStart = preview.previousClosing?.periodEnd ?? firstDelivered ?? now.toISOString();
        const start = new Date(periodStart) < now ? periodStart : new Date(now.getTime() - 1).toISOString();
        const t = preview.totals;
        // total_earnings_minor = fee entitlement (as before); total_reimbursements_owed_minor = goods Hatly owes back (R26) — never COD pass-through.
        const extraCols = COURIER_PERIOD_COLUMNS.map(([, c]) => c);
        const base = [driverId, start, now.toISOString(), t.feeEntitlementMinor, t.commissionMinor, t.goodsReimbursementMinor, t.netToCourierMinor, actorUserId, t.orders, preview.unresolved.length];
        const extraVals = COURIER_PERIOD_COLUMNS.map(([k]) => t[k as keyof typeof t]);
        const [p] = await m.query(
          `INSERT INTO driver_settlement_periods
             (driver_id, frequency, period_start, period_end, status, total_earnings_minor, total_commission_owed_minor, total_reimbursements_owed_minor,
              net_payable_minor, closed_at, closed_by_user_id, reference, method_version, orders_count, unresolved_count, ${extraCols.join(', ')})
           VALUES ($1, 'DAILY', $2, $3, 'CLOSED', $4, $5, $6, $7, $3, $8,
                   'CS-' || to_char($3::timestamptz AT TIME ZONE 'Africa/Cairo', 'YYYYMMDD') || '-' || upper(left(replace(uuid_generate_v4()::text, '-', ''), 6)),
                   2, $9, $10, ${extraCols.map((_, i) => `$${base.length + 1 + i}`).join(', ')})
           RETURNING *`,
          [...base, ...extraVals],
        );
        const lineCols = COURIER_MONEY_COLUMNS.map(([, c]) => c);
        for (const l of preview.lines) {
          const head = [p.id, l.orderId, l.deliveryId, l.commissionEventId, l.paymentMethod, l.paymentFlow, l.deliveredAt];
          await m.query(
            `INSERT INTO driver_settlement_period_orders (period_id, order_id, delivery_id, commission_event_id, payment_method, payment_flow, delivered_at, ${lineCols.join(', ')})
             VALUES (${[...head, ...lineCols].map((_, i) => `$${i + 1}`).join(', ')})`,
            [...head, ...COURIER_MONEY_COLUMNS.map(([k]) => l[k])],
          );
        }
        const { previewToken: _t, ...rest } = preview;
        return {
          ...rest,
          id: p.id, reference: p.reference, status: p.status, frequency: p.frequency, methodVersion: 2,
          periodStart: iso(p.period_start), periodEnd: iso(p.period_end), closedAt: iso(p.closed_at), closedByUserId: p.closed_by_user_id,
          totalEarningsMinor: num(p.total_earnings_minor), totalCommissionOwedMinor: num(p.total_commission_owed_minor),
          totalReimbursementsOwedMinor: num(p.total_reimbursements_owed_minor), netPayableMinor: num(p.net_payable_minor),
        };
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException({ message: 'These orders were just settled by another closing. Refresh to see it.', details: { code: 'ALREADY_SETTLED' } });
      }
      throw error;
    }
  }

  /**
   * The money state of specific delivered orders of one courier — the SAME numbers the Admin preview / closing show (Driver App history):
   *  SETTLED (in a closing by the order method: its stored line + reference), PENDING (eligible: the line the next closing will settle),
   *  EXCLUDED (cannot be settled yet: the reason), LEGACY_SETTLED (covered by a period closed before 2026-11-13 — kept as stored).
   */
  async courierOrderStates(driverId: string, orderIds: string[]) {
    const out = new Map<string, { state: 'SETTLED' | 'PENDING' | 'EXCLUDED' | 'LEGACY_SETTLED'; reference?: string; closedAt?: string | null; reason?: string; line?: Record<string, unknown> }>();
    if (orderIds.length === 0) return out;
    const settled: any[] = await this.ds.query(
      `SELECT l.*, p.reference, p.closed_at FROM driver_settlement_period_orders l JOIN driver_settlement_periods p ON p.id = l.period_id WHERE l.order_id = ANY($1)`,
      [orderIds],
    );
    for (const r of settled) {
      out.set(r.order_id, { state: 'SETTLED', reference: r.reference, closedAt: iso(r.closed_at), line: { paymentFlow: r.payment_flow, ...Object.fromEntries(COURIER_MONEY_COLUMNS.map(([k, c]) => [k, num(r[c])])) } });
    }
    if (out.size < orderIds.length) {
      const { lines, unresolved } = await this.courierFacts(this.ds.manager, driverId);
      for (const l of lines) if (orderIds.includes(l.orderId) && !out.has(l.orderId)) {
        const { orderId: _o, orderNumber: _n, deliveredAt: _d, deliveryId: _dl, commissionEventId: _e, paymentMethod: _m, ...line } = l;
        out.set(l.orderId, { state: 'PENDING', line });
      }
      for (const u of unresolved) if (orderIds.includes(u.orderId) && !out.has(u.orderId)) out.set(u.orderId, { state: 'EXCLUDED', reason: u.reason });
    }
    for (const id of orderIds) if (!out.has(id)) out.set(id, { state: 'LEGACY_SETTLED' });
    return out;
  }

  // ================================================================================================================================= vendor

  private async vendorFacts(m: EntityManager, branchId: string, periodEnd: string) {
    const [prev] = await m.query(`SELECT period_end, reference FROM vendor_settlement_periods WHERE vendor_branch_id = $1 AND status = 'CLOSED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1`, [branchId]);
    const rows: any[] = await m.query(
      `SELECT s.id AS segment_id, o.id AS order_id, o.order_number, o.fulfillment_type, s.subtotal_minor, h.at AS handed_over_at,
              e.id AS commission_event_id, e.amount_minor AS commission
         FROM order_vendor_segments s
         JOIN orders o ON o.id = s.order_id AND o.deleted_at IS NULL
         JOIN LATERAL (SELECT min(se.created_at) AS at FROM order_status_events se WHERE se.order_id = o.id AND se.to_status IN ('PICKED_UP','COLLECTED')) h ON h.at IS NOT NULL
         LEFT JOIN financial_events e ON e.order_vendor_segment_id = s.id AND e.type = 'VENDOR_COMMISSION_RECOGNIZED' AND e.deleted_at IS NULL
        WHERE s.vendor_branch_id = $1 AND s.deleted_at IS NULL AND s.group_type = 'CATALOG' AND s.status <> 'CANCELLED'
          AND h.at < $2::timestamptz
          AND NOT EXISTS (SELECT 1 FROM vendor_settlement_period_lines x WHERE x.segment_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM vendor_settlement_periods p
                           WHERE p.vendor_branch_id = $1 AND p.method_version = 1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL
                             AND coalesce(e.created_at, h.at) >= p.period_start AND coalesce(e.created_at, h.at) < p.period_end)
        ORDER BY h.at, o.order_number`,
      [branchId, periodEnd],
    );
    const lines = rows.map((r) => ({
      segmentId: r.segment_id, orderId: r.order_id, orderNumber: r.order_number, fulfillmentType: r.fulfillment_type, handedOverAt: iso(r.handed_over_at),
      segmentSubtotalMinor: num(r.subtotal_minor), commissionMinor: r.commission_event_id ? num(r.commission) : null, commissionEventId: r.commission_event_id,
      rateUndefined: !r.commission_event_id,
    }));
    return { prev, lines };
  }

  /** No end → now. A Cairo date `YYYY-MM-DD` → up to the END of that day (Cairo). An instant → that instant. Never later than now. */
  static resolveEnd(periodEnd: string | undefined, now = new Date()): Date {
    if (!periodEnd) return now;
    let end: Date;
    if (DATE_RE.test(periodEnd)) {
      const next = new Date(`${periodEnd}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      end = cairoMidnight(next.toISOString().slice(0, 10));
    } else {
      end = new Date(periodEnd);
    }
    if (Number.isNaN(end.getTime())) throw new BadRequestException({ message: 'Invalid period end.', details: { code: 'VALIDATION_FAILED' } });
    return end > now ? now : end;
  }

  async vendorPreview(branchId: string, periodEnd?: string, m: EntityManager = this.ds.manager) {
    assertUuid(branchId, 'Branch');
    const [branch] = await m.query(`SELECT b.id, b.name AS branch_name, v.name AS vendor_name, v.name_ar AS vendor_name_ar, b.commission_rate_basis_points FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 AND b.deleted_at IS NULL`, [branchId]);
    if (!branch) throw notFound('Branch');
    const end = SettlementClosingService.resolveEnd(periodEnd);
    const { prev, lines } = await this.vendorFacts(m, branchId, end.toISOString());
    const totals = {
      parts: lines.length,
      orders: new Set(lines.map((l) => l.orderId)).size,
      grossSalesMinor: lines.reduce((t, l) => t + l.segmentSubtotalMinor, 0),
      commissionOwedByVendorMinor: lines.reduce((t, l) => t + (l.commissionMinor ?? 0), 0),
      rateUndefinedParts: lines.filter((l) => l.rateUndefined).length,
      collectedByHatlyForVendorMinor: 0,
    };
    return {
      branch: { id: branch.id, vendorName: branch.vendor_name, vendorNameAr: branch.vendor_name_ar, branchName: branch.branch_name, commissionRateBasisPoints: branch.commission_rate_basis_points },
      previousClosing: prev ? { periodEnd: iso(prev.period_end), reference: prev.reference } : null,
      periodEnd: end.toISOString(),
      lines,
      totals,
      direction: 'COLLECTION' as const,
      accountingNote: 'R32/R25/R26: the courier pays the store at pickup, so Hatly holds no money for the store; the amount due is the commission the store owes Hatly. Nothing is netted.',
      previewToken: SettlementClosingService.token(lines.map((l) => ({ id: l.segmentId, net: l.commissionMinor ?? -1 }))),
    };
  }

  async closeVendor(branchId: string, actorUserId: string, opts: { periodEnd?: string; previewToken?: string } = {}) {
    assertUuid(branchId, 'Branch');
    try {
      return await this.ds.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtext('vendor-settlement:' || $1))`, [branchId]);
        const preview = await this.vendorPreview(branchId, opts.periodEnd, m);
        if (opts.previewToken && opts.previewToken !== preview.previewToken) {
          throw new ConflictException({ message: 'The store parts to settle changed since your preview (they may have just been settled by another closing). Review the new preview and confirm again.', details: { code: 'PREVIEW_CHANGED' } });
        }
        if (preview.lines.length === 0) throw new BadRequestException({ message: 'No new activity to settle since the last closed period.', details: { code: 'NOTHING_TO_CLOSE' } });
        const end = new Date(preview.periodEnd);
        const firstHandover = preview.lines.map((l) => l.handedOverAt).filter(Boolean).sort()[0]!;
        let start = new Date(preview.previousClosing?.periodEnd ?? firstHandover);
        if (start >= end) start = new Date(end.getTime() - 1);
        const [term] = await m.query(`SELECT t.frequency FROM vendor_settlement_terms t JOIN vendor_branches b ON b.vendor_id = t.vendor_id WHERE b.id = $1`, [branchId]);
        const frequency = term?.frequency ?? (await this.businessConfig.getVendorSettlementFrequency());
        const t = preview.totals;
        const [p] = await m.query(
          `INSERT INTO vendor_settlement_periods (vendor_branch_id, frequency, period_start, period_end, status, gross_sales_minor, total_commission_owed_minor, closed_at,
             closed_by_user_id, reference, method_version, orders_count, rate_undefined_count)
           VALUES ($1, $2, $3, $4, 'CLOSED', $5, $6, now(), $7,
                   'VS-' || to_char($4::timestamptz AT TIME ZONE 'Africa/Cairo', 'YYYYMMDD') || '-' || upper(left(replace(uuid_generate_v4()::text, '-', ''), 6)),
                   2, $8, $9)
           RETURNING *`,
          [branchId, String(frequency), start.toISOString(), end.toISOString(), t.grossSalesMinor, t.commissionOwedByVendorMinor, actorUserId, t.orders, t.rateUndefinedParts],
        );
        for (const l of preview.lines) {
          await m.query(
            `INSERT INTO vendor_settlement_period_lines (period_id, segment_id, order_id, commission_event_id, handed_over_at, fulfillment_type, segment_subtotal_minor, commission_minor)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [p.id, l.segmentId, l.orderId, l.commissionEventId, l.handedOverAt, l.fulfillmentType, l.segmentSubtotalMinor, l.commissionMinor],
          );
        }
        const { previewToken: _t, ...rest } = preview;
        return {
          ...rest,
          id: p.id, reference: p.reference, status: p.status, frequency: p.frequency, methodVersion: 2, vendorBranchId: branchId,
          periodStart: iso(p.period_start), periodEnd: iso(p.period_end), closedAt: iso(p.closed_at), closedByUserId: p.closed_by_user_id,
          grossSalesMinor: num(p.gross_sales_minor), totalCommissionOwedMinor: num(p.total_commission_owed_minor),
        };
      });
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictException({ message: 'These store parts were just settled by another closing. Refresh to see it.', details: { code: 'ALREADY_SETTLED' } });
      }
      throw error;
    }
  }

  // ============================================================================================================== statements (any period)

  private static range(from?: string, to?: string) {
    if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) throw new BadRequestException({ message: 'Dates must be YYYY-MM-DD.', details: { code: 'VALIDATION_FAILED' } });
    return { from: from ?? '1970-01-01', to: to ?? '2999-12-31' };
  }

  /** Every closing of one courier whose close time falls in [from, to] (Cairo dates), with its orders, payments and what is still open. */
  async courierStatement(driverId: string, from?: string, to?: string) {
    assertUuid(driverId, 'Courier');
    const r = SettlementClosingService.range(from, to);
    const [driver] = await this.ds.query(`SELECT d.id, u.full_name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = $1`, [driverId]);
    if (!driver) throw notFound('Courier');
    const periods: any[] = await this.ds.query(
      `SELECT p.*, u.full_name AS closed_by_name,
              coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED'), 0) AS settled
         FROM driver_settlement_periods p LEFT JOIN users u ON u.id = p.closed_by_user_id
        WHERE p.driver_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL
          AND (p.closed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
        ORDER BY p.closed_at`,
      [driverId, r.from, r.to],
    );
    const ids = periods.map((p) => p.id);
    const lines: any[] = ids.length
      ? await this.ds.query(`SELECT l.*, o.order_number FROM driver_settlement_period_orders l JOIN orders o ON o.id = l.order_id WHERE l.period_id = ANY($1) ORDER BY l.delivered_at, o.order_number`, [ids])
      : [];
    const [earlier] = await this.ds.query(
      `SELECT coalesce(sum(CASE WHEN p.net_payable_minor >= 0 THEN 1 ELSE -1 END * greatest(0, abs(p.net_payable_minor) - coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED'), 0))), 0) AS open
         FROM driver_settlement_periods p WHERE p.driver_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL AND (p.closed_at AT TIME ZONE 'Africa/Cairo')::date < $2::date`,
      [driverId, r.from],
    );
    const view = periods.map((p) => {
      const due = driverPeriodDue(num(p.net_payable_minor));
      const settled = num(p.settled);
      return {
        id: p.id, reference: p.reference, methodVersion: p.method_version, periodStart: iso(p.period_start), periodEnd: iso(p.period_end), closedAt: iso(p.closed_at), closedBy: p.closed_by_name,
        orders: p.orders_count, unresolvedAtClose: p.unresolved_count,
        feeEntitlementMinor: num(p.fee_entitlement_minor ?? p.total_earnings_minor), commissionMinor: num(p.total_commission_owed_minor),
        reimbursementsMinor: num(p.total_reimbursements_owed_minor), netToCourierMinor: num(p.net_payable_minor),
        // closed before 2026-11-13 (method 1): only the stored legacy totals exist — the parts below stay null, never recomputed
        ...Object.fromEntries(COURIER_PERIOD_COLUMNS.filter(([k]) => k !== 'feeEntitlementMinor').map(([k, c]) => [k, p.method_version === 2 ? num(p[c]) : null])),
        direction: due.direction, dueMinor: due.dueMinor, settledMinor: settled, remainingMinor: remainingMinor(due.dueMinor, settled), paymentStatus: derivePaymentStatus(due.dueMinor, settled),
      };
    });
    const signedRemaining = view.reduce((t, p) => t + (p.direction === 'PAYOUT' ? 1 : -1) * p.remainingMinor, 0);
    return {
      courier: { id: driver.id, name: driver.full_name },
      from: r.from, to: r.to,
      periods: view,
      lines: lines.map((l) => ({
        periodId: l.period_id, orderId: l.order_id, orderNumber: l.order_number, paymentMethod: l.payment_method, paymentFlow: l.payment_flow, deliveredAt: iso(l.delivered_at),
        ...(Object.fromEntries(COURIER_MONEY_COLUMNS.map(([k, c]) => [k, num(l[c])])) as Omit<CourierOrderLine, 'paymentFlow'>),
      })),
      totals: {
        closings: view.length,
        orders: view.reduce((t, p) => t + (p.orders ?? 0), 0),
        feeEntitlementMinor: view.reduce((t, p) => t + p.feeEntitlementMinor, 0),
        commissionMinor: view.reduce((t, p) => t + p.commissionMinor, 0),
        // parts are summed over closings made by the order method; legacy closings contribute only fee, commission and net
        ...Object.fromEntries(COURIER_PERIOD_COLUMNS.filter(([k]) => k !== 'feeEntitlementMinor').map(([k]) => [k, view.reduce((t, p: any) => t + (p[k] ?? 0), 0)])),
        legacyClosings: view.filter((p) => p.methodVersion !== 2).length,
        netToCourierMinor: view.reduce((t, p) => t + p.netToCourierMinor, 0),
        settledMinor: view.reduce((t, p) => t + p.settledMinor, 0),
        /** > 0: Hatly still owes the courier; < 0: the courier still owes Hatly (closings in this range). */
        signedRemainingMinor: signedRemaining,
        /** Same, for closings made before this range (still open today). */
        signedRemainingBeforeRangeMinor: num(earlier?.open),
      },
    };
  }

  async vendorStatement(branchId: string, from?: string, to?: string) {
    assertUuid(branchId, 'Branch');
    const r = SettlementClosingService.range(from, to);
    const [branch] = await this.ds.query(`SELECT b.id, b.name AS branch_name, v.name AS vendor_name, v.name_ar AS vendor_name_ar FROM vendor_branches b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1`, [branchId]);
    if (!branch) throw notFound('Branch');
    const periods: any[] = await this.ds.query(
      `SELECT p.*, u.full_name AS closed_by_name,
              coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED'), 0) AS settled
         FROM vendor_settlement_periods p LEFT JOIN users u ON u.id = p.closed_by_user_id
        WHERE p.vendor_branch_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL
          AND (p.closed_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $2::date AND $3::date
        ORDER BY p.closed_at`,
      [branchId, r.from, r.to],
    );
    const ids = periods.map((p) => p.id);
    const lines: any[] = ids.length
      ? await this.ds.query(`SELECT l.*, o.order_number FROM vendor_settlement_period_lines l JOIN orders o ON o.id = l.order_id WHERE l.period_id = ANY($1) ORDER BY l.handed_over_at, o.order_number`, [ids])
      : [];
    const view = periods.map((p) => {
      const due = vendorPeriodDue(num(p.total_commission_owed_minor));
      const settled = num(p.settled);
      return {
        id: p.id, reference: p.reference, methodVersion: p.method_version, periodStart: iso(p.period_start), periodEnd: iso(p.period_end), closedAt: iso(p.closed_at), closedBy: p.closed_by_name,
        frequency: p.frequency, orders: p.orders_count, rateUndefinedParts: p.rate_undefined_count, grossSalesMinor: num(p.gross_sales_minor), commissionOwedByVendorMinor: num(p.total_commission_owed_minor),
        dueMinor: due.dueMinor, settledMinor: settled, remainingMinor: remainingMinor(due.dueMinor, settled), paymentStatus: derivePaymentStatus(due.dueMinor, settled),
      };
    });
    const [earlier] = await this.ds.query(
      `SELECT coalesce(sum(greatest(0, p.total_commission_owed_minor - coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED'), 0))), 0) AS open
         FROM vendor_settlement_periods p WHERE p.vendor_branch_id = $1 AND p.status = 'CLOSED' AND p.deleted_at IS NULL AND (p.closed_at AT TIME ZONE 'Africa/Cairo')::date < $2::date`,
      [branchId, r.from],
    );
    return {
      branch: { id: branch.id, vendorName: branch.vendor_name, vendorNameAr: branch.vendor_name_ar, branchName: branch.branch_name },
      from: r.from, to: r.to,
      periods: view,
      lines: lines.map((l) => ({
        periodId: l.period_id, segmentId: l.segment_id, orderId: l.order_id, orderNumber: l.order_number, fulfillmentType: l.fulfillment_type, handedOverAt: iso(l.handed_over_at),
        segmentSubtotalMinor: num(l.segment_subtotal_minor), commissionMinor: l.commission_minor == null ? null : num(l.commission_minor), rateUndefined: l.commission_minor == null,
      })),
      totals: {
        closings: view.length,
        orders: view.reduce((t, p) => t + (p.orders ?? 0), 0),
        grossSalesMinor: view.reduce((t, p) => t + p.grossSalesMinor, 0),
        commissionOwedByVendorMinor: view.reduce((t, p) => t + p.commissionOwedByVendorMinor, 0),
        settledMinor: view.reduce((t, p) => t + p.settledMinor, 0),
        remainingMinor: view.reduce((t, p) => t + p.remainingMinor, 0),
        remainingBeforeRangeMinor: num(earlier?.open),
        collectedByHatlyForVendorMinor: 0,
      },
      accountingNote: 'The amount due is the commission the store owes Hatly (R32). Hatly holds no store money: the courier pays the store at pickup.',
    };
  }
}
