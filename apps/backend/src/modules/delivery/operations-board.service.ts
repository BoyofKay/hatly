import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminDispatchService } from './admin-dispatch.service';
import { ACTIVE_DRIVER_ORDER_STATUSES } from './driver-capacity';

const num = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Same figure the Control Tower and the ops alerts use for "the store has not accepted" (approved initial value). */
export const STORE_ACCEPT_ALERT_MINUTES = 5;
/** How many "needs a driver" orders get a suggested driver per board read (the ranking is a real query each). */
const SUGGESTION_LIMIT = 25;
/** The newest live orders the board carries; when there are more, the response says so (never silently cut). */
export const BOARD_LIMIT = 500;
const LIVE = `o.deleted_at IS NULL
          AND (o.status IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP','ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY')
               OR (o.status = 'FAILED_DELIVERY' AND NOT EXISTS (SELECT 1 FROM failed_delivery_resolutions f WHERE f.order_id = o.id)))`;

export type BoardReason =
  | 'FAILED_DELIVERY' | 'STORE_NOT_ACCEPTED' | 'DRIVER_OFFLINE' | 'NEEDS_DRIVER' | 'VERIFY_TRANSFER' | 'NEW'
  | 'DRIVER_NOT_ACKNOWLEDGED' | 'PREPARATION_LATE' | 'READY_FOR_CUSTOMER' | 'PREPARING' | 'WITH_DRIVER';

/** Higher = more urgent. Display ordering only — no business rule is defined here. */
const SCORE: Record<BoardReason, number> = {
  FAILED_DELIVERY: 100, STORE_NOT_ACCEPTED: 95, DRIVER_OFFLINE: 92, NEEDS_DRIVER: 90, VERIFY_TRANSFER: 85, NEW: 80,
  DRIVER_NOT_ACKNOWLEDGED: 75, PREPARATION_LATE: 70, READY_FOR_CUSTOMER: 50, PREPARING: 30, WITH_DRIVER: 10,
};

/**
 * The Operations board (stage 1 of the Admin simplification, 2026-11-13): every live order in ONE list, most urgent first, each with WHY it is
 * on the list and the facts needed to do the next step from the row itself (the store parts and their status, the driver, a suggested driver).
 * Read-only. Every action the page offers is an existing endpoint (on-behalf segment transitions, assign/reassign) with its own permission
 * check; nothing here decides or changes anything. R2: a manual-transfer order that is not verified yet shows "verify the transfer" and no
 * store actions.
 */
@Injectable()
export class OperationsBoardService {
  constructor(
    private readonly ds: DataSource,
    private readonly dispatch: AdminDispatchService,
  ) {}

  async board(opts: { withSuggestions?: boolean } = {}) {
    const rows: any[] = await this.ds.query(
      `SELECT o.id, o.order_number, o.status, o.fulfillment_type, o.payment_method, o.total_minor, o.amount_due_minor, o.created_at,
              o.delivery_address_snapshot ->> 'areaLabel' AS area, o.delivery_address_snapshot ->> 'line1' AS line1,
              (SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
              d.id AS delivery_id, d.driver_id, d.assigned_at, d.acknowledged_at, d.accept_deadline_at, u.full_name AS driver_name, u.phone AS driver_phone,
              dr.is_online AS driver_online,
              EXISTS (SELECT 1 FROM failed_delivery_resolutions f WHERE f.order_id = o.id) AS failure_resolved,
              EXISTS (SELECT 1 FROM ops_alerts a WHERE a.order_id = o.id AND a.category = 'DRIVER_OFFLINE' AND a.resolved_at IS NULL) AS driver_offline_alert,
              (SELECT coalesce(json_agg(json_build_object(
                  'id', s.id, 'status', s.status, 'groupType', s.group_type, 'vendorName', v.name, 'vendorNameAr', v.name_ar, 'branchName', b.name,
                  'placeName', s.ad_hoc_place_name_snapshot, 'createdAt', s.created_at, 'expectedReadyAt', s.expected_ready_at, 'subtotalMinor', s.subtotal_minor
                ) ORDER BY s.created_at), '[]'::json)
                 FROM order_vendor_segments s LEFT JOIN vendor_branches b ON b.id = s.vendor_branch_id LEFT JOIN vendors v ON v.id = b.vendor_id
                WHERE s.order_id = o.id AND s.deleted_at IS NULL) AS segments
         FROM orders o
         LEFT JOIN deliveries d ON d.order_id = o.id AND d.deleted_at IS NULL
         LEFT JOIN drivers dr ON dr.id = d.driver_id
         LEFT JOIN users u ON u.id = dr.user_id
        WHERE ${LIVE}
        ORDER BY o.created_at DESC
        LIMIT ${BOARD_LIMIT}`,
    );
    const [{ total }] = await this.ds.query(`SELECT count(*)::int AS total FROM orders o WHERE ${LIVE}`);
    const now = Date.now();
    const items = rows.map((r) => {
      const segments = (r.segments ?? []) as any[];
      const live = segments.filter((s) => s.status !== 'CANCELLED');
      const unverifiedTransfer = r.payment_method === 'MANUAL_TRANSFER' && r.payment_status !== 'PAID';
      const pending = live.filter((s) => s.status === 'PENDING');
      const lateAccept = pending.some((s) => now - Date.parse(s.createdAt) > STORE_ACCEPT_ALERT_MINUTES * 60_000);
      const lateReady = live.some((s) => ['CONFIRMED', 'PREPARING'].includes(s.status) && s.expectedReadyAt && Date.parse(s.expectedReadyAt) < now);
      const withDriver = ACTIVE_DRIVER_ORDER_STATUSES.includes(r.status);
      const assignedButReleased = r.status === 'READY_FOR_PICKUP'; // a delivery row may still name a released driver — not "with" them
      let reason: BoardReason;
      if (r.status === 'FAILED_DELIVERY') reason = 'FAILED_DELIVERY';
      else if (unverifiedTransfer && ['PENDING', 'CONFIRMED', 'PREPARING'].includes(r.status)) reason = 'VERIFY_TRANSFER';
      else if (lateAccept) reason = 'STORE_NOT_ACCEPTED';
      else if (withDriver && r.driver_offline_alert) reason = 'DRIVER_OFFLINE';
      else if (r.status === 'READY_FOR_PICKUP' && r.fulfillment_type === 'DELIVERY') reason = 'NEEDS_DRIVER';
      else if (r.status === 'READY_FOR_PICKUP') reason = 'READY_FOR_CUSTOMER';
      else if (pending.length > 0) reason = 'NEW';
      else if (r.status === 'ASSIGNED_TO_DRIVER' && !r.acknowledged_at && r.accept_deadline_at && Date.parse(r.accept_deadline_at) < now) reason = 'DRIVER_NOT_ACKNOWLEDGED';
      else if (lateReady) reason = 'PREPARATION_LATE';
      else if (withDriver) reason = 'WITH_DRIVER';
      else reason = 'PREPARING';
      return {
        id: r.id, orderNumber: r.order_number, status: r.status, fulfillmentType: r.fulfillment_type, paymentMethod: r.payment_method,
        paymentStatus: r.payment_status ?? null, unverifiedTransfer, totalMinor: num(r.total_minor), amountDueMinor: num(r.amount_due_minor),
        createdAt: iso(r.created_at), area: r.area ?? r.line1 ?? null,
        reason, score: SCORE[reason],
        segments: segments.map((s) => ({ ...s, createdAt: iso(s.createdAt), expectedReadyAt: iso(s.expectedReadyAt), subtotalMinor: num(s.subtotalMinor) })),
        driver: r.driver_id && !assignedButReleased
          ? { id: r.driver_id, name: r.driver_name, phone: r.driver_phone, online: Boolean(r.driver_online), acknowledgedAt: iso(r.acknowledged_at), assignedAt: iso(r.assigned_at) }
          : null,
        suggestedDrivers: [] as Array<{ id: string; name: string; active: number; capacity: number }>,
      };
    });
    items.sort((a, b) => b.score - a.score || Date.parse(a.createdAt!) - Date.parse(b.createdAt!));

    if (opts.withSuggestions !== false) {
      const needing = items.filter((i) => i.reason === 'NEEDS_DRIVER').slice(0, SUGGESTION_LIMIT);
      for (const item of needing) item.suggestedDrivers = await this.dispatch.suggestDrivers(item.id, 3).catch(() => []);
    }
    const counts: Record<string, number> = {};
    for (const i of items) counts[i.reason] = (counts[i.reason] ?? 0) + 1;
    return { items, counts, totalLive: total, truncated: total > items.length, generatedAt: new Date(now).toISOString() };
  }
}
