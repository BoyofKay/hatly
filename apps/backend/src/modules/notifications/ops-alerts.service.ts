import { Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { driverCashExposure, driverRiskLimits } from '../delivery/driver-financial-risk';
import { Permission } from '../permissions/permission.enum';
import { StaffAlertsService, StaffAlertCategory } from './staff-alerts.service';
import { AdminPushService, opsAlertHref } from './web-push/admin-push.service';

export type OpsAlertCategory =
  | 'NEW_ORDER' | 'ACCEPTANCE_OVERDUE' | 'PREPARATION_LATE' | 'DRIVER_ACK_OVERDUE' | 'NO_DRIVER' | 'DRIVER_NOT_RESPONDING' | 'ASSIGNMENT_ERROR' | 'FAILED_DELIVERY'
  | 'DRIVER_OFFLINE' | 'DRIVER_LONG_SHIFT' | 'DRIVER_CASH_EXPOSURE';
export type OpsAlertPriority = 'CRITICAL' | 'HIGH';

/**
 * Thresholds are NOT defined here — each condition uses the one the platform already applies:
 *  - store acceptance: AdminControlTowerService.PENDING_ACCEPTANCE_ALERT_MINUTES (5, approved initial value) — passed in, same figure the Control Tower counts;
 *  - preparation: the segment's own `expected_ready_at`;
 *  - driver acknowledgement and "needs a driver": the dispatch alerts AutomaticDispatchService already raises (R15/R16, configured window);
 *  - failed delivery: FAILED_DELIVERY with no resolution yet (same as the Control Tower);
 *  - driver offline (2026-11-13): the driver holding an active order switched to offline, or — only when the optional setting
 *    DRIVER_PRESENCE_STALE_MINUTES is set — their app has not called the API for that long. One alert per order per incident
 *    (key: order, driver, incident time); resolved when the driver is back, the order moves to another driver, or it ends.
 * The only numbers here are notification behaviour (how often to repeat an unacknowledged critical push, how often to scan), not business rules.
 */
const ACTIVE = `('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP','ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY')`;
/** R2: an InstaPay / Vodafone Cash order reaches the store (and so needs acceptance) only once its payment is verified. */
const VISIBLE_TO_STORE = `(o.payment_method <> 'MANUAL_TRANSFER' OR EXISTS (SELECT 1 FROM payments vp WHERE vp.order_id = o.id AND vp.status = 'PAID'))`;
const DISPATCH_CATEGORY: Record<string, OpsAlertCategory> = {
  ACKNOWLEDGEMENT_OVERDUE: 'DRIVER_ACK_OVERDUE', NO_ELIGIBLE_DRIVER: 'NO_DRIVER', AUTO_ASSIGN_DISABLED: 'NO_DRIVER', DRIVER_NOT_RESPONDING: 'DRIVER_NOT_RESPONDING', ASSIGNMENT_ERROR: 'ASSIGNMENT_ERROR',
};
/** Inbox (bell) rows are written for the conditions that had none before; dispatch and failed-delivery events already write their own. */
const INBOX_CATEGORY: Partial<Record<OpsAlertCategory, StaffAlertCategory>> = {
  NEW_ORDER: 'OPS_NEW_ORDER', ACCEPTANCE_OVERDUE: 'OPS_ACCEPTANCE_OVERDUE', PREPARATION_LATE: 'OPS_PREPARATION_LATE', DRIVER_ACK_OVERDUE: 'OPS_DRIVER_ACK_OVERDUE',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => new NotFoundException({ message: 'Alert not found.', details: { code: 'ALERT_NOT_FOUND' } });

interface RaiseInput {
  key: string;
  category: OpsAlertCategory;
  priority: OpsAlertPriority;
  orderId: string | null;
  orderNumber: string | null;
  segmentId?: string | null;
  dispatchAlertId?: string | null;
  detail?: string | null;
  /** When the condition began (the order was placed, the acceptance deadline passed, …); defaults to now. Ages and ordering use it. */
  openedAt?: Date | string | null;
}

/**
 * Operations alerts: one row per condition needing attention ("HT-100036 is new", "the store has not accepted HT-100036").
 *
 * LIFECYCLE — raised (idempotent on `alert_key`, in the transaction of the business change when there is one, otherwise by the scan) →
 * pushed to every registered Admin device of the Operations staff (round 0) → repeated for CRITICAL alerts until someone ACKNOWLEDGES it
 * (a person has seen it; stops repeats and the alarm for everyone) → RESOLVED automatically when the condition is gone (the store accepted,
 * the order ended, the dispatch alert closed …). Acknowledging never resolves; nothing here changes an order, a payment or an assignment.
 */
@Injectable()
export class OpsAlertsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OpsAlertsService.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  /** Same figure as AdminControlTowerService.PENDING_ACCEPTANCE_ALERT_MINUTES (kept equal by a unit test; no import to avoid a module cycle). */
  static readonly PENDING_ACCEPTANCE_ALERT_MINUTES = 5;
  readonly repeatMinutes = Math.max(1, Number(process.env.OPS_ALERT_REPEAT_MINUTES ?? 3) || 3);
  readonly maxPushRounds = Math.max(0, Number(process.env.OPS_ALERT_MAX_PUSH_ROUNDS ?? 5) || 5);

  constructor(
    private readonly ds: DataSource,
    private readonly staffAlerts: StaffAlertsService,
    private readonly push: AdminPushService,
  ) {}

  onApplicationBootstrap(): void {
    const interval = Number(process.env.OPS_ALERT_SCAN_INTERVAL_MS ?? 30_000);
    if (process.env.JOBS_WORKER_ENABLED === 'false' || !(interval > 0)) return;
    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.scan();
    } catch (error) {
      this.logger.error(`Ops alert scan failed: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  // --------------------------------------------------------------------------------------------------------------------------------- raise

  /** Raises an alert once per key. Never throws (a failed alert must never undo the business change it describes). Returns the new id, or null. */
  async raise(m: EntityManager, a: RaiseInput): Promise<string | null> {
    try {
      return await m.transaction(async (sp) => {
        const rows = await sp.query(
          `INSERT INTO ops_alerts (alert_key, category, priority, order_id, order_number, segment_id, dispatch_alert_id, detail, push_rounds, last_pushed_at, opened_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, now(), LEAST(now(), COALESCE($9::timestamptz, now()))) ON CONFLICT ON CONSTRAINT "UQ_ops_alerts_key" DO NOTHING RETURNING id`,
          [a.key.slice(0, 200), a.category, a.priority, a.orderId, a.orderNumber, a.segmentId ?? null, a.dispatchAlertId ?? null, a.detail?.slice(0, 300) ?? null, a.openedAt ?? null],
        );
        if (rows.length === 0) return null;
        const id: string = rows[0].id;
        const recipients = await this.staffAlerts.recipientsHolding(sp, [Permission.MANAGE_ORDER_FULFILMENT]);
        const inbox = INBOX_CATEGORY[a.category];
        if (inbox) {
          await this.staffAlerts.alert(sp, {
            eventKey: `ops:${a.key}`, category: inbox, requiredAction: a.category === 'NEW_ORDER' && a.priority === 'CRITICAL' ? 'ACCEPT_ORDER' : undefined,
            recipients, orderId: a.orderId, orderNumber: a.orderNumber,
          } as Parameters<StaffAlertsService['alert']>[1]);
        }
        await this.push.enqueueAlert(sp, id, 0, recipients);
        return id;
      });
    } catch (error) {
      this.logger.error(`Could not raise ops alert ${a.category} (${a.key}): ${(error as Error).message}`);
      return null;
    }
  }

  /** A new order reached the stores (placement, or — R2 — verification of its manual transfer). Called in that transaction. */
  async raiseNewOrder(m: EntityManager, order: { id: string; orderNumber?: string | null }): Promise<void> {
    const [{ pending }] = await m.query(`SELECT count(*)::int AS pending FROM order_vendor_segments WHERE order_id = $1 AND status = 'PENDING' AND deleted_at IS NULL`, [order.id]);
    await this.raise(m, {
      key: `new-order:${order.id}`, category: 'NEW_ORDER', priority: pending > 0 ? 'CRITICAL' : 'HIGH', orderId: order.id, orderNumber: order.orderNumber ?? null,
      detail: pending > 0 ? null : 'Accepted automatically',
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------------------- scan

  /** Raises what the conditions show, resolves what is over, repeats unacknowledged critical pushes. Idempotent; safe to run concurrently. */
  async scan(): Promise<{ raised: number; resolved: number; repeated: number }> {
    let raised = 0;
    const candidates: RaiseInput[] = [];
    const minutes = OpsAlertsService.PENDING_ACCEPTANCE_ALERT_MINUTES;

    // Safety net for NEW_ORDER (the in-transaction call is the primary path): recent orders a store must still accept.
    for (const r of await this.ds.query(
      `SELECT o.id, o.order_number, o.created_at AS began FROM orders o
        WHERE o.deleted_at IS NULL AND o.created_at > now() - interval '24 hours' AND o.status IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP') AND ${VISIBLE_TO_STORE}
          AND EXISTS (SELECT 1 FROM order_vendor_segments s WHERE s.order_id = o.id AND s.status = 'PENDING' AND s.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM ops_alerts x WHERE x.alert_key = 'new-order:' || o.id::text)
        LIMIT 200`,
    )) candidates.push({ key: `new-order:${r.id}`, category: 'NEW_ORDER', priority: 'CRITICAL', orderId: r.id, orderNumber: r.order_number, openedAt: r.began });

    for (const r of await this.ds.query(
      `SELECT s.id AS segment_id, o.id, o.order_number, s.created_at + ($1::int * interval '1 minute') AS began FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        WHERE s.deleted_at IS NULL AND o.deleted_at IS NULL AND s.status = 'PENDING' AND s.created_at < now() - ($1::int * interval '1 minute')
          AND o.status IN ${ACTIVE} AND ${VISIBLE_TO_STORE}
          AND NOT EXISTS (SELECT 1 FROM ops_alerts x WHERE x.alert_key = 'acceptance-overdue:' || s.id::text)
        LIMIT 200`,
      [minutes],
    )) candidates.push({ key: `acceptance-overdue:${r.segment_id}`, category: 'ACCEPTANCE_OVERDUE', priority: 'CRITICAL', orderId: r.id, orderNumber: r.order_number, segmentId: r.segment_id, detail: `${minutes}`, openedAt: r.began });

    for (const r of await this.ds.query(
      `SELECT s.id AS segment_id, o.id, o.order_number, s.expected_ready_at AS began, floor(extract(epoch FROM s.expected_ready_at))::bigint AS due FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        WHERE s.deleted_at IS NULL AND o.deleted_at IS NULL AND s.status IN ('CONFIRMED','PREPARING') AND s.expected_ready_at IS NOT NULL AND s.expected_ready_at < now()
          AND o.status IN ${ACTIVE}
          AND NOT EXISTS (SELECT 1 FROM ops_alerts x WHERE x.alert_key = 'prep-late:' || s.id::text || ':' || floor(extract(epoch FROM s.expected_ready_at))::bigint::text)
        LIMIT 200`,
    )) candidates.push({ key: `prep-late:${r.segment_id}:${r.due}`, category: 'PREPARATION_LATE', priority: 'HIGH', orderId: r.id, orderNumber: r.order_number, segmentId: r.segment_id, openedAt: r.began });

    for (const r of await this.ds.query(
      `SELECT a.id AS alert_id, a.reason, a.created_at AS began, o.id, o.order_number FROM dispatch_alerts a JOIN orders o ON o.id = a.order_id
        WHERE a.resolved_at IS NULL AND a.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status IN ${ACTIVE}
          AND NOT EXISTS (SELECT 1 FROM ops_alerts x WHERE x.alert_key = 'dispatch:' || a.id::text)
        LIMIT 200`,
    )) {
      const category = DISPATCH_CATEGORY[r.reason];
      if (category) candidates.push({ key: `dispatch:${r.alert_id}`, category, priority: 'CRITICAL', orderId: r.id, orderNumber: r.order_number, dispatchAlertId: r.alert_id, detail: r.reason, openedAt: r.began });
    }

    for (const r of await this.ds.query(
      `SELECT o.id, o.order_number, o.updated_at AS began FROM orders o
        WHERE o.deleted_at IS NULL AND o.status = 'FAILED_DELIVERY' AND NOT EXISTS (SELECT 1 FROM failed_delivery_resolutions f WHERE f.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM ops_alerts x WHERE x.alert_key = 'failed:' || o.id::text)
        LIMIT 200`,
    )) candidates.push({ key: `failed:${r.id}`, category: 'FAILED_DELIVERY', priority: 'CRITICAL', orderId: r.id, orderNumber: r.order_number, openedAt: r.began });

    candidates.push(...(await this.driverOfflineCandidates()));
    candidates.push(...(await this.driverRiskCandidates()));

    for (const c of candidates) if (await this.raise(this.ds.manager, c)) raised++;
    const resolved = await this.resolveEnded();
    const repeated = await this.repeatUnacknowledged();
    return { raised, resolved, repeated };
  }

  /** Minutes of app silence that count as "not reachable", or null when the optional setting is unset (that alert is then off). */
  async presenceStaleMinutes(): Promise<number | null> {
    const [row] = await this.ds.query(`SELECT value FROM business_config WHERE key = 'DRIVER_PRESENCE_STALE_MINUTES'`);
    const v = row?.value;
    return typeof v === 'number' && Number.isInteger(v) && v >= 2 ? v : null;
  }

  /**
   * DRIVER_OFFLINE: an active order (assigned / picked up / on the way) whose driver is OFFLINE (their own switch) or SILENT (no API call
   * for DRIVER_PRESENCE_STALE_MINUTES, when set). The key names the incident — `driver-offline:<order>:<driver>:<since>` — so the same
   * incident never raises twice, and a later, separate disconnection raises a fresh alert. Detail = reason|last-seen ISO (no personal data).
   */
  async driverOfflineCandidates(): Promise<RaiseInput[]> {
    const stale = await this.presenceStaleMinutes();
    const rows = await this.ds.query(
      `SELECT o.id, o.order_number, d.id AS driver_id, d.last_seen_at,
              CASE WHEN NOT d.is_online THEN 'OFFLINE' ELSE 'SILENT' END AS reason,
              CASE WHEN NOT d.is_online THEN coalesce(d.online_changed_at, dl.assigned_at, o.updated_at) ELSE coalesce(d.last_seen_at, dl.assigned_at) END AS since
         FROM orders o JOIN deliveries dl ON dl.order_id = o.id AND dl.deleted_at IS NULL JOIN drivers d ON d.id = dl.driver_id
        WHERE o.deleted_at IS NULL AND o.status IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY')
          AND (NOT d.is_online OR ($1::int IS NOT NULL AND coalesce(d.last_seen_at, dl.assigned_at) < now() - ($1::int * interval '1 minute')))
        LIMIT 200`,
      [stale],
    );
    const out: RaiseInput[] = [];
    for (const r of rows) {
      const since = new Date(r.since);
      const key = `driver-offline:${r.id}:${r.driver_id}:${Math.floor(since.getTime() / 1000)}`;
      const [exists] = await this.ds.query(`SELECT 1 FROM ops_alerts WHERE alert_key = $1`, [key]);
      if (exists) continue;
      out.push({
        key, category: 'DRIVER_OFFLINE', priority: 'CRITICAL', orderId: r.id, orderNumber: r.order_number,
        detail: `${r.reason}|${r.last_seen_at ? new Date(r.last_seen_at).toISOString() : ''}`, openedAt: since,
      });
    }
    return out;
  }

  /** Driver-level conditions are deliberately separate from individual orders. */
  async driverRiskCandidates(): Promise<RaiseInput[]> {
    const out: RaiseInput[] = [];
    const shifts = await this.ds.query(
      `SELECT sh.id, sh.driver_id, sh.started_at, floor(extract(epoch FROM (now()-sh.started_at))/60)::int AS minutes
         FROM driver_shifts sh WHERE sh.ended_at IS NULL AND sh.started_at <= now()-interval '14 hours'`);
    for (const sh of shifts) {
      const key = `driver-long-shift:${sh.id}`;
      out.push({key, category:'DRIVER_LONG_SHIFT', priority:'HIGH', orderId:null, orderNumber:null,
        detail:`Driver ${sh.driver_id} · ${sh.minutes} min on duty`, openedAt:sh.started_at});
    }
    const limits = await driverRiskLimits(this.ds);
    const threshold = limits.warningMinor ?? limits.capMinor;
    const drivers = await this.ds.query('SELECT id FROM drivers WHERE deleted_at IS NULL');
    for (const d of drivers) {
      const prefix = `driver-cash:${d.id}:`;
      const [last] = await this.ds.query(
        'SELECT id,resolved_at FROM ops_alerts WHERE alert_key LIKE $1 ORDER BY opened_at DESC,id DESC LIMIT 1',[prefix+'%']);
      if (threshold === null) {
        if(last && !last.resolved_at) await this.ds.query("UPDATE ops_alerts SET resolved_at=now(),updated_at=now(),resolution='CASH_EXPOSURE_CLEARED' WHERE id=$1 AND resolved_at IS NULL",[last.id]);
        continue;
      }
      const exposure=await driverCashExposure(this.ds,d.id);
      if(exposure.outstandingMinor < threshold) {
        if(last && !last.resolved_at) await this.ds.query("UPDATE ops_alerts SET resolved_at=now(),updated_at=now(),resolution='CASH_EXPOSURE_CLEARED' WHERE id=$1 AND resolved_at IS NULL",[last.id]);
        continue;
      }
      if(last && !last.resolved_at) continue;
      out.push({key:prefix+(last?.id??'first'),category:'DRIVER_CASH_EXPOSURE',
        priority:limits.capMinor!==null&&exposure.outstandingMinor>=limits.capMinor?'CRITICAL':'HIGH',
        orderId:null,orderNumber:null,detail:`Driver ${d.id} · ${(exposure.outstandingMinor/100).toFixed(2)} EGP outstanding`});
    }
    return out;
  }

  /** Closes every open alert whose condition no longer holds. Set-based; records why. */
  async resolveEnded(): Promise<number> {
    const stale = await this.presenceStaleMinutes();
    const [rows] = await this.ds.query(
      `UPDATE ops_alerts x SET resolved_at = now(), updated_at = now(), resolution = r.resolution
         FROM (
           SELECT a.id, CASE
               WHEN a.category = 'DRIVER_LONG_SHIFT' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM driver_shifts sh WHERE sh.id::text=split_part(a.alert_key,':',2) AND sh.ended_at IS NULL) THEN 'SHIFT_ENDED' END
               WHEN a.category = 'FAILED_DELIVERY' THEN CASE WHEN o.status <> 'FAILED_DELIVERY' OR EXISTS (SELECT 1 FROM failed_delivery_resolutions f WHERE f.order_id = o.id) THEN 'FAILED_DELIVERY_HANDLED' END
               WHEN o.status NOT IN ${ACTIVE} THEN 'ORDER_ENDED'
               WHEN a.category = 'NEW_ORDER' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM order_vendor_segments s WHERE s.order_id = o.id AND s.status = 'PENDING' AND s.deleted_at IS NULL) THEN 'STORE_RESPONDED' END
               WHEN a.category = 'ACCEPTANCE_OVERDUE' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM order_vendor_segments s WHERE s.id = a.segment_id AND s.status = 'PENDING' AND s.deleted_at IS NULL) THEN 'STORE_RESPONDED' END
               WHEN a.category = 'DRIVER_OFFLINE' THEN CASE
                   WHEN o.status NOT IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY') THEN 'DRIVER_RELEASED'
                   WHEN NOT EXISTS (SELECT 1 FROM deliveries dl WHERE dl.order_id = o.id AND dl.deleted_at IS NULL AND dl.driver_id::text = split_part(a.alert_key, ':', 3)) THEN 'DRIVER_REASSIGNED'
                   WHEN EXISTS (SELECT 1 FROM drivers d WHERE d.id::text = split_part(a.alert_key, ':', 3) AND d.is_online
                                  AND ($1::int IS NULL OR d.last_seen_at >= now() - ($1::int * interval '1 minute'))) THEN 'DRIVER_RECONNECTED'
                 END
               WHEN a.category = 'PREPARATION_LATE' THEN CASE WHEN NOT EXISTS (SELECT 1 FROM order_vendor_segments s WHERE s.id = a.segment_id AND s.status IN ('CONFIRMED','PREPARING') AND s.deleted_at IS NULL AND s.expected_ready_at < now()) THEN 'PREPARATION_DONE' END
               WHEN a.dispatch_alert_id IS NOT NULL THEN CASE
                   WHEN NOT EXISTS (SELECT 1 FROM dispatch_alerts d WHERE d.id = a.dispatch_alert_id AND d.resolved_at IS NULL AND d.deleted_at IS NULL) THEN 'DISPATCH_ALERT_CLOSED'
                   WHEN a.category = 'DRIVER_ACK_OVERDUE' AND (o.status <> 'ASSIGNED_TO_DRIVER' OR EXISTS (SELECT 1 FROM deliveries dl WHERE dl.order_id = o.id AND dl.deleted_at IS NULL AND dl.acknowledged_at IS NOT NULL)) THEN 'DRIVER_ACKNOWLEDGED'
                   WHEN a.category = 'NO_DRIVER' AND o.status NOT IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP') THEN 'DRIVER_ASSIGNED'
                 END
             END AS resolution
           FROM ops_alerts a LEFT JOIN orders o ON o.id = a.order_id
          WHERE a.resolved_at IS NULL
         ) r
        WHERE x.id = r.id AND r.resolution IS NOT NULL
        RETURNING x.id`,
      [stale],
    );
    return rows.length;
  }

  /** Re-sends an unacknowledged, unresolved CRITICAL alert every `repeatMinutes`, at most `maxPushRounds` times after the first push. */
  async repeatUnacknowledged(): Promise<number> {
    const [due] = await this.ds.query(
      `UPDATE ops_alerts SET push_rounds = push_rounds + 1, last_pushed_at = now(), updated_at = now()
        WHERE id IN (SELECT id FROM ops_alerts WHERE priority = 'CRITICAL' AND acknowledged_at IS NULL AND resolved_at IS NULL AND push_rounds < $1
                       AND (last_pushed_at IS NULL OR last_pushed_at < now() - ($2::int * interval '1 minute')) ORDER BY opened_at LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING id, push_rounds`,
      [this.maxPushRounds, this.repeatMinutes],
    );
    if (due.length === 0) return 0;
    const recipients = await this.staffAlerts.recipientsHolding(this.ds.manager, [Permission.MANAGE_ORDER_FULFILMENT]);
    for (const a of due) await this.push.enqueueAlert(this.ds.manager, a.id, a.push_rounds, recipients);
    return due.length;
  }

  // ------------------------------------------------------------------------------------------------------------------------- read and act

  async list(state: string | undefined) {
    const recent = state === 'recent';
    const rows = await this.ds.query(
      `SELECT a.*, u.full_name AS acknowledged_by_name FROM ops_alerts a LEFT JOIN users u ON u.id = a.acknowledged_by_user_id
        WHERE ${recent ? `a.opened_at > now() - interval '7 days'` : 'a.resolved_at IS NULL'}
        ORDER BY (a.resolved_at IS NULL) DESC, a.opened_at DESC, a.id
        LIMIT ${recent ? 200 : 300}`,
    );
    const items = rows.map(toView);
    // For open "new order" / "store has not accepted" alerts: the store parts still waiting for acceptance, so Operations can accept on the
    // store's behalf straight from the alert (the same PATCH admin/orders/segments/:id/status the order page uses — no new rule).
    const waiting = items.filter((a: any) => !a.resolvedAt && (a.category === 'NEW_ORDER' || a.category === 'ACCEPTANCE_OVERDUE') && a.orderId);
    if (waiting.length > 0) {
      const parts: Array<{ order_id: string; segment_id: string; vendor_name: string | null; vendor_name_ar: string | null; branch_name: string | null }> = await this.ds.query(
        `SELECT s.order_id, s.id AS segment_id, v.name AS vendor_name, v.name_ar AS vendor_name_ar, b.name AS branch_name
           FROM order_vendor_segments s
           LEFT JOIN vendor_branches b ON b.id = s.vendor_branch_id
           LEFT JOIN vendors v ON v.id = b.vendor_id
          WHERE s.order_id = ANY($1) AND s.status = 'PENDING' AND s.deleted_at IS NULL
          ORDER BY s.created_at, s.id`,
        [[...new Set(waiting.map((a: any) => a.orderId))]],
      );
      for (const a of waiting as any[]) {
        a.pendingParts = parts
          .filter((p) => p.order_id === a.orderId && (a.category === 'NEW_ORDER' || !a.segmentId || p.segment_id === a.segmentId))
          .map((p) => ({ segmentId: p.segment_id, vendorName: p.vendor_name, vendorNameAr: p.vendor_name_ar, branchName: p.branch_name }));
      }
    }
    return { items, serverTime: new Date().toISOString() };
  }

  /** Records that a person saw the alert: stops the repeats and the alarm for everyone. Idempotent (the first acknowledgement is kept). Never resolves. */
  async acknowledge(id: string, userId: string) {
    if (!UUID_RE.test(id)) throw notFound();
    await this.ds.query(
      `UPDATE ops_alerts SET acknowledged_at = now(), acknowledged_by_user_id = $2, updated_at = now() WHERE id = $1 AND acknowledged_at IS NULL`,
      [id, userId],
    );
    const [row] = await this.ds.query(`SELECT a.*, u.full_name AS acknowledged_by_name FROM ops_alerts a LEFT JOIN users u ON u.id = a.acknowledged_by_user_id WHERE a.id = $1`, [id]);
    if (!row) throw notFound();
    return toView(row);
  }

  async lastAcknowledgedBy(userId: string): Promise<string | null> {
    const [row] = await this.ds.query(`SELECT max(acknowledged_at) AS at FROM ops_alerts WHERE acknowledged_by_user_id = $1`, [userId]);
    return row?.at ?? null;
  }
}

function toView(r: any) {
  return {
    id: r.id, category: r.category as OpsAlertCategory, priority: r.priority as OpsAlertPriority, orderId: r.order_id, orderNumber: r.order_number, detail: r.detail,
    openedAt: r.opened_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by_user_id ? { id: r.acknowledged_by_user_id, name: r.acknowledged_by_name ?? null } : null,
    resolvedAt: r.resolved_at, resolution: r.resolution, pushRounds: r.push_rounds, href: opsAlertHref(r), segmentId: r.segment_id ?? null,
    pendingParts: [] as Array<{ segmentId: string; vendorName: string | null; vendorNameAr: string | null; branchName: string | null }>,
  };
}
