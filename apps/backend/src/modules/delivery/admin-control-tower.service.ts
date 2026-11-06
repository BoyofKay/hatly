import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrderStatus } from '../orders/order-status.enum';
import { BusinessConfigService } from '../business-config/business-config.service';

/** The order statuses that are still "in operation" (everything before DELIVERED / CANCELLED / FAILED_DELIVERY). */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.ASSIGNED_TO_DRIVER,
  OrderStatus.PICKED_UP,
  OrderStatus.ON_THE_WAY,
];

/** Statuses in which a driver is actually on the order (a READY_FOR_PICKUP delivery row may still name a RELEASED driver). */
const DRIVER_ON_ORDER_STATUSES: OrderStatus[] = [OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY];

/**
 * The most recent ASSIGNED_TO_DRIVER → READY_FOR_PICKUP event of order `o`, when that release is what put the order in its
 * current READY_FOR_PICKUP status (i.e. no later event entered READY_FOR_PICKUP). Facts only, from the status history.
 * A release by the timeout sweep is followed by a fresh ranking (re-assignment or a "no eligible driver" alert); a release
 * by the DRIVER is never retried automatically (PD-007 item 2 / PD-008 open question) — it waits for a manual assignment.
 */
const LATEST_READY_EVENT_SQL = `(SELECT e FROM order_status_events e
   WHERE e.order_id = o.id AND e.to_status = 'READY_FOR_PICKUP'
   ORDER BY e.created_at DESC, e.id DESC LIMIT 1)`;

/** The delivery stages the Control Tower lists — each one an existing order status set, never a new state. */
export const CONTROL_TOWER_STAGES = {
  AWAITING_ASSIGNMENT: [OrderStatus.READY_FOR_PICKUP],
  ASSIGNED: [OrderStatus.ASSIGNED_TO_DRIVER],
  IN_TRANSIT: [OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY],
  ALL: [OrderStatus.READY_FOR_PICKUP, OrderStatus.ASSIGNED_TO_DRIVER, OrderStatus.PICKED_UP, OrderStatus.ON_THE_WAY],
} as const;
export type ControlTowerStage = keyof typeof CONTROL_TOWER_STAGES;

export interface ControlTowerSummary {
  generatedAt: string;
  automaticDispatchEnabled: boolean;
  /** Active orders by their current status (delivery and pickup alike). */
  ordersByStatus: Record<string, number>;
  attention: {
    /** DELIVERY orders at READY_FOR_PICKUP — waiting for a driver. */
    awaitingAssignment: number;
    /** …of which have an open "no eligible driver" dispatch alert. */
    awaitingWithOpenNoDriverAlert: number;
    /**
     * …of which have NO open alert: either a dispatch attempt is still to come, automatic dispatch is off, or the PD-008
     * known gap (released by a timeout/driver and never retried). Reported as a fact — no retry interval is invented.
     */
    awaitingWithoutAlert: number;
    /**
     * DELIVERY orders back at READY_FOR_PICKUP after a driver was released (driver hand-back or timeout) that the system is NOT retrying (no open NO_ELIGIBLE_DRIVER / ASSIGNMENT_ERROR
     * alert — those are retried automatically): automatic assignment is off or the driver did not respond, so an admin must assign them.
     */
    releasedAwaitingManualAssignment: number;
    /** R16: ASSIGNED_TO_DRIVER orders whose driver has NOT acknowledged within the window (acceptDeadlineAt passed, acknowledgedAt null). */
    assignedPastAcceptDeadline: number;
    /** FAILED_DELIVERY orders with no recorded resolution — the Failed Deliveries queue (same definition). */
    failedDeliveriesUnresolved: number;
    /** PICKUP orders ready at the branch — the customer collects them; never a driver's job. */
    readyForCustomerPickup: number;
  };
  /**
   * Operations follow-up facts (Order operations milestone). Everything an operator must act on, as counts the Dashboard turns into the
   * navigation counter and the banner. Thresholds: a pending acceptance becomes an alert after PENDING_ACCEPTANCE_ALERT_MINUTES.
   */
  operations: {
    pendingAcceptanceAlertMinutes: number;
    /** Vendor segments still PENDING (all ages), and those older than the threshold. */
    pendingAcceptance: number;
    pendingAcceptanceOverdue: number;
    /** Segments accepted/preparing past their expected-ready time (`expectedReadyAt`). */
    preparationOverdue: number;
    /** Open dispatch alerts by stable reason code. */
    openDispatchAlerts: Record<'NO_ELIGIBLE_DRIVER' | 'AUTO_ASSIGN_DISABLED' | 'ASSIGNMENT_ERROR' | 'DRIVER_NOT_RESPONDING' | 'ACKNOWLEDGEMENT_OVERDUE', number>;
    /** Manual Transfer refunds recorded but not yet marked as sent. */
    refundsToSend: number;
    /** Active orders where some — not all — vendor parts were rejected. */
    partiallyRejectedActiveOrders: number;
    /** Everything above that needs a person (drives the navigation counter). */
    actionRequired: number;
  };
  /** Driver aggregates — only for callers who may see drivers (MANAGE_DRIVERS or ASSIGN_REASSIGN_ORDERS), else null. */
  drivers: {
    approved: number;
    onlineAndAvailable: number;
    onlineBusy: number;
    offline: number;
    pendingVerification: number;
  } | null;
}

export interface ControlTowerDeliveryRow {
  orderId: string;
  orderNumber: string;
  status: string;
  /** When the order entered its CURRENT status (its status history) — the "last meaningful event". */
  statusSince: string | null;
  createdAt: string;
  deliveryAddress: unknown;
  hasPendingHatlyServicePricing: boolean;
  /** Only while a driver is actually on the order (ASSIGNED_TO_DRIVER / PICKED_UP / ON_THE_WAY). */
  driver: { id: string; fullName: string; phone: string } | null;
  assignedAt: string | null;
  acceptDeadlineAt: string | null;
  /** R16: when the current driver acknowledged (null = not yet). */
  acknowledgedAt: string | null;
  acceptDeadlinePassed: boolean;
  reassignmentCount: number;
  openDispatchAlert: { id: string; reason: string; createdAt: string } | null;
  /**
   * Set while a READY_FOR_PICKUP order is waiting again because its driver was released (from its status history):
   * when, and by whom (`DRIVER` = the driver handed it back; `ADMIN` = the system timeout sweep). Null otherwise.
   */
  released: { at: string; byRole: string | null } | null;
}

/**
 * Admin Control Tower (read-only). Every number is a query over the existing domain — orders, their status history,
 * deliveries, dispatch alerts, failed-delivery resolutions, drivers — never a second source of truth, never a new state.
 * Set-based SQL only (one statement per figure group / page), so it stays cheap at realistic scale (no N+1).
 */
@Injectable()
export class AdminControlTowerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly businessConfigService: BusinessConfigService,
  ) {}

  /** A vendor segment waiting for acceptance longer than this raises an operations alert (approved initial value; centralized here). */
  static readonly PENDING_ACCEPTANCE_ALERT_MINUTES = 5;

  private async operationsFacts(): Promise<ControlTowerSummary['operations']> {
    const minutes = AdminControlTowerService.PENDING_ACCEPTANCE_ALERT_MINUTES;
    const [[segments], alertRows, [refunds], [partial]] = await Promise.all([
      this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE s.status = 'PENDING')::int AS pending,
           count(*) FILTER (WHERE s.status = 'PENDING' AND s.created_at < now() - ($1::int * interval '1 minute'))::int AS overdue,
           count(*) FILTER (WHERE s.status IN ('CONFIRMED','PREPARING') AND s.expected_ready_at IS NOT NULL AND s.expected_ready_at < now())::int AS prep_overdue
         FROM order_vendor_segments s JOIN orders o ON o.id = s.order_id
        WHERE s.deleted_at IS NULL AND o.status IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP','ASSIGNED_TO_DRIVER')`,
        [minutes],
      ),
      this.dataSource.query(`SELECT reason, count(*)::int AS n FROM dispatch_alerts WHERE resolved_at IS NULL AND deleted_at IS NULL GROUP BY reason`),
      this.dataSource.query(
        `SELECT count(*)::int AS n FROM financial_events e
          WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED' AND NOT EXISTS (SELECT 1 FROM refund_payouts p WHERE p.financial_event_id = e.id)`,
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS n FROM orders o
          WHERE o.deleted_at IS NULL AND o.status IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP','ASSIGNED_TO_DRIVER')
            AND EXISTS (SELECT 1 FROM order_vendor_segments s WHERE s.order_id = o.id AND s.status = 'CANCELLED')
            AND EXISTS (SELECT 1 FROM order_vendor_segments s WHERE s.order_id = o.id AND s.status <> 'CANCELLED')`,
      ),
    ]);
    const openDispatchAlerts = { NO_ELIGIBLE_DRIVER: 0, AUTO_ASSIGN_DISABLED: 0, ASSIGNMENT_ERROR: 0, DRIVER_NOT_RESPONDING: 0, ACKNOWLEDGEMENT_OVERDUE: 0 };
    for (const row of alertRows as Array<{ reason: keyof typeof openDispatchAlerts; n: number }>) {
      if (row.reason in openDispatchAlerts) openDispatchAlerts[row.reason] = Number(row.n);
    }
    const alertTotal = Object.values(openDispatchAlerts).reduce((a, b) => a + b, 0);
    return {
      pendingAcceptanceAlertMinutes: minutes,
      pendingAcceptance: Number(segments.pending),
      pendingAcceptanceOverdue: Number(segments.overdue),
      preparationOverdue: Number(segments.prep_overdue),
      openDispatchAlerts,
      refundsToSend: Number(refunds.n),
      partiallyRejectedActiveOrders: Number(partial.n),
      actionRequired: alertTotal + Number(segments.overdue) + Number(segments.prep_overdue) + Number(refunds.n),
    };
  }

  async summary(options: { includeDrivers: boolean }): Promise<ControlTowerSummary> {
    const [byStatus, [attention], driverCounts, automaticDispatchEnabled] = await Promise.all([
      this.dataSource.query(
        `SELECT o.status::text AS status, count(*)::int AS count
           FROM orders o
          WHERE o.deleted_at IS NULL AND o.status::text = ANY($1)
          GROUP BY o.status`,
        [ACTIVE_ORDER_STATUSES],
      ) as Promise<Array<{ status: string; count: number }>>,
      this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE o.status = 'READY_FOR_PICKUP' AND o.fulfillment_type = 'DELIVERY')::int AS "awaitingAssignment",
           count(*) FILTER (WHERE o.status = 'READY_FOR_PICKUP' AND o.fulfillment_type = 'DELIVERY' AND EXISTS (
             SELECT 1 FROM dispatch_alerts a WHERE a.order_id = o.id AND a.resolved_at IS NULL AND a.deleted_at IS NULL))::int AS "awaitingWithOpenNoDriverAlert",
           count(*) FILTER (WHERE o.status = 'ASSIGNED_TO_DRIVER' AND EXISTS (
             SELECT 1 FROM deliveries dl WHERE dl.order_id = o.id AND dl.accept_deadline_at < now() AND dl.acknowledged_at IS NULL))::int AS "assignedPastAcceptDeadline",
           count(*) FILTER (WHERE o.status = 'FAILED_DELIVERY' AND NOT EXISTS (
             SELECT 1 FROM failed_delivery_resolutions r WHERE r.order_id = o.id))::int AS "failedDeliveriesUnresolved",
           count(*) FILTER (WHERE o.status = 'READY_FOR_PICKUP' AND o.fulfillment_type = 'PICKUP')::int AS "readyForCustomerPickup",
           count(*) FILTER (WHERE o.status = 'READY_FOR_PICKUP' AND o.fulfillment_type = 'DELIVERY'
             AND (${LATEST_READY_EVENT_SQL}).from_status = 'ASSIGNED_TO_DRIVER'
             AND NOT EXISTS (SELECT 1 FROM dispatch_alerts a WHERE a.order_id = o.id AND a.resolved_at IS NULL AND a.deleted_at IS NULL
               AND a.reason IN ('NO_ELIGIBLE_DRIVER', 'ASSIGNMENT_ERROR'))
           )::int AS "releasedAwaitingManualAssignment"
         FROM orders o
        WHERE o.deleted_at IS NULL AND o.status IN ('READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'FAILED_DELIVERY')`,
      ),
      options.includeDrivers
        ? (this.dataSource.query(
            `SELECT
               count(*) FILTER (WHERE d.verification_status = 'APPROVED')::int AS approved,
               count(*) FILTER (WHERE d.verification_status = 'APPROVED' AND d.is_online AND d.is_available)::int AS "onlineAndAvailable",
               count(*) FILTER (WHERE d.verification_status = 'APPROVED' AND d.is_online AND NOT d.is_available)::int AS "onlineBusy",
               count(*) FILTER (WHERE d.verification_status = 'APPROVED' AND NOT d.is_online)::int AS offline,
               count(*) FILTER (WHERE d.verification_status = 'PENDING')::int AS "pendingVerification"
             FROM drivers d WHERE d.deleted_at IS NULL`,
          ) as Promise<Array<ControlTowerSummary['drivers']>>)
        : Promise.resolve(null),
      this.businessConfigService.isAutomaticDispatchEnabled(),
    ]);

    const ordersByStatus = Object.fromEntries(ACTIVE_ORDER_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    for (const row of byStatus) ordersByStatus[row.status] = row.count;

    return {
      generatedAt: new Date().toISOString(),
      automaticDispatchEnabled,
      ordersByStatus,
      attention: {
        awaitingAssignment: attention.awaitingAssignment,
        awaitingWithOpenNoDriverAlert: attention.awaitingWithOpenNoDriverAlert,
        awaitingWithoutAlert: attention.awaitingAssignment - attention.awaitingWithOpenNoDriverAlert,
        releasedAwaitingManualAssignment: attention.releasedAwaitingManualAssignment,
        assignedPastAcceptDeadline: attention.assignedPastAcceptDeadline,
        failedDeliveriesUnresolved: attention.failedDeliveriesUnresolved,
        readyForCustomerPickup: attention.readyForCustomerPickup,
      },
      operations: await this.operationsFacts(),
      drivers: driverCounts ? driverCounts[0] : null,
    };
  }

  /**
   * DELIVERY orders in a delivery stage, longest-in-current-status first (stable: id tie-break), server-side paginated.
   * `search` = an order number (exact) or the customer's phone / name (partial) — the admin order search's own rule.
   */
  async listDeliveries(params: {
    stage: ControlTowerStage;
    search?: string;
    driverId?: string;
    /** Only orders waiting again after a driver release (see `released`). */
    releasedOnly?: boolean;
    page: number;
    limit: number;
  }): Promise<{ data: ControlTowerDeliveryRow[]; page: number; limit: number; total: number }> {
    const where: string[] = [
      'o.deleted_at IS NULL',
      `o.fulfillment_type = 'DELIVERY'`,
      'o.status::text = ANY($1)',
    ];
    const args: unknown[] = [CONTROL_TOWER_STAGES[params.stage], DRIVER_ON_ORDER_STATUSES];
    const search = params.search?.trim();
    if (search) {
      args.push(search, `%${search}%`);
      where.push(`(upper(o.order_number) = upper($${args.length - 1}) OR c.phone ILIKE $${args.length} OR c.full_name ILIKE $${args.length})`);
    }
    if (params.driverId) {
      args.push(params.driverId);
      where.push(`(dl.driver_id = $${args.length} AND o.status::text = ANY($2))`);
    }
    if (params.releasedOnly) {
      where.push(`o.status = 'READY_FOR_PICKUP' AND (${LATEST_READY_EVENT_SQL}).from_status = 'ASSIGNED_TO_DRIVER'`);
    }
    args.push(params.limit, (params.page - 1) * params.limit);

    const rows: any[] = await this.dataSource.query(
      `SELECT o.id, o.order_number, o.status::text AS status, o.created_at, o.delivery_address_snapshot,
              o.has_pending_ad_hoc_pricing,
              CASE WHEN o.status::text = ANY($2) THEN dl.driver_id END AS driver_id,
              CASE WHEN o.status::text = ANY($2) THEN du.full_name END AS driver_name,
              CASE WHEN o.status::text = ANY($2) THEN du.phone END AS driver_phone,
              CASE WHEN o.status::text = ANY($2) THEN dl.assigned_at END AS assigned_at,
              CASE WHEN o.status = 'ASSIGNED_TO_DRIVER' THEN dl.accept_deadline_at END AS accept_deadline_at,
              CASE WHEN o.status = 'ASSIGNED_TO_DRIVER' THEN dl.acknowledged_at END AS acknowledged_at,
              COALESCE(dl.reassignment_count, 0) AS reassignment_count,
              (SELECT max(e.created_at) FROM order_status_events e WHERE e.order_id = o.id AND e.to_status = o.status::text) AS status_since,
              CASE WHEN o.status = 'READY_FOR_PICKUP' THEN (
                SELECT json_build_object('at', r.created_at, 'byRole', r.actor_role)
                  FROM (SELECT e.created_at, e.actor_role, e.from_status FROM order_status_events e
                         WHERE e.order_id = o.id AND e.to_status = 'READY_FOR_PICKUP'
                         ORDER BY e.created_at DESC, e.id DESC LIMIT 1) r
                 WHERE r.from_status = 'ASSIGNED_TO_DRIVER') END AS released,
              (SELECT json_build_object('id', a.id, 'reason', a.reason, 'createdAt', a.created_at)
                 FROM dispatch_alerts a
                WHERE a.order_id = o.id AND a.resolved_at IS NULL AND a.deleted_at IS NULL
                ORDER BY a.created_at DESC LIMIT 1) AS open_alert,
              count(*) OVER () AS total
         FROM orders o
         JOIN users c ON c.id = o.customer_id
         LEFT JOIN deliveries dl ON dl.order_id = o.id AND dl.deleted_at IS NULL
         LEFT JOIN drivers d ON d.id = dl.driver_id
         LEFT JOIN users du ON du.id = d.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY status_since ASC NULLS FIRST, o.id ASC
        LIMIT $${args.length - 1} OFFSET $${args.length}`,
      args,
    );

    const now = Date.now();
    return {
      page: params.page,
      limit: params.limit,
      total: rows.length > 0 ? Number(rows[0].total) : 0,
      data: rows.map((r) => ({
        orderId: r.id,
        orderNumber: r.order_number,
        status: r.status,
        statusSince: r.status_since ? new Date(r.status_since).toISOString() : null,
        createdAt: new Date(r.created_at).toISOString(),
        deliveryAddress: r.delivery_address_snapshot ?? null,
        hasPendingHatlyServicePricing: r.has_pending_ad_hoc_pricing === true,
        driver: r.driver_id ? { id: r.driver_id, fullName: r.driver_name, phone: r.driver_phone } : null,
        assignedAt: r.assigned_at ? new Date(r.assigned_at).toISOString() : null,
        acceptDeadlineAt: r.accept_deadline_at ? new Date(r.accept_deadline_at).toISOString() : null,
        acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
        acceptDeadlinePassed: r.accept_deadline_at && !r.acknowledged_at ? new Date(r.accept_deadline_at).getTime() < now : false,
        reassignmentCount: Number(r.reassignment_count ?? 0),
        openDispatchAlert: r.open_alert ?? null,
        released: r.released ? { at: new Date(r.released.at).toISOString(), byRole: r.released.byRole ?? null } : null,
      })),
    };
  }
}
