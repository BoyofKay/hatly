/**
 * R18 (decision register 2026-11-06): how many active orders a driver may carry, and whether they have room for one more.
 *
 * - Capacity = the driver's Admin override, else their vehicle type's `max_active_deliveries`, else 1 (never below 1).
 * - Active = deliveries of orders ASSIGNED_TO_DRIVER / PICKED_UP / ON_THE_WAY that name the driver. (A delivery row left behind by an
 *   Operations release names the old driver while its order is READY_FOR_PICKUP again — it is not counted.)
 * - `drivers.is_available` = active < capacity. Every place that changes a driver's active deliveries or capacity recomputes it here, inside
 *   its own transaction, so the ranking / eligibility readers of `is_available` stay correct with no further change.
 * `includeOrderId` counts an order whose status has not been written yet (the assignment in progress); `excludeOrderId` leaves out one that is
 * leaving the driver (a release / delivery / cancellation in progress).
 */
export const ACTIVE_DRIVER_ORDER_STATUSES = ['ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY'];

const CAPACITY_SQL = `GREATEST(1, COALESCE(d.capacity_override, (SELECT v.max_active_deliveries FROM vehicle_types v WHERE v.id = d.vehicle_type_id), 1))`;
/**
 * Early dispatch (owner decision 2026-11-22): an order the driver was pre-assigned to while the store prepares it counts too — the
 * delivery carries `early_assigned_at` and the order is still Confirmed / Preparing / Ready.
 */
export const EARLY_ASSIGNED_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'];
/** SQL condition: delivery `x` of order `o` is with its driver right now (active, or pre-assigned). Uses no parameters. */
export const ACTIVE_DELIVERY_CONDITION = (x = 'x', o = 'o') =>
  `(${o}.status::text IN ('ASSIGNED_TO_DRIVER','PICKED_UP','ON_THE_WAY') OR (${x}.early_assigned_at IS NOT NULL AND ${o}.status::text IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP')))`;

const ACTIVE_SQL = (driverRef: string) => `(SELECT count(*) FROM deliveries x JOIN orders o ON o.id = x.order_id
   WHERE x.driver_id = ${driverRef} AND x.deleted_at IS NULL
     AND (((o.status::text = ANY($2::text[]) OR (x.early_assigned_at IS NOT NULL AND o.status::text IN ('PENDING','CONFIRMED','PREPARING','READY_FOR_PICKUP')))
           AND o.id IS DISTINCT FROM $3::uuid) OR o.id = $4::uuid))`;

type Db = { query: (sql: string, params?: unknown[]) => Promise<any> };

export async function recomputeDriverAvailability(db: Db, driverIds: string[], opts: { includeOrderId?: string | null; excludeOrderId?: string | null } = {}): Promise<void> {
  const ids = [...new Set(driverIds.filter(Boolean))];
  if (ids.length === 0) return;
  await db.query(
    `UPDATE drivers d SET is_available = (${ACTIVE_SQL('d.id')} < ${CAPACITY_SQL}) WHERE d.id = ANY($1::uuid[])`,
    [ids, ACTIVE_DRIVER_ORDER_STATUSES, opts.excludeOrderId ?? null, opts.includeOrderId ?? null],
  );
}

/** Recompute every driver on a vehicle type (its capacity changed). */
export async function recomputeDriversOfVehicleType(db: Db, vehicleTypeId: string): Promise<void> {
  const rows: Array<{ id: string }> = await db.query(`SELECT id FROM drivers WHERE vehicle_type_id = $1`, [vehicleTypeId]);
  await recomputeDriverAvailability(db, rows.map((r) => r.id));
}

/** The driver's capacity and active load (for Admin views). */
export async function driverLoad(db: Db, driverId: string): Promise<{ capacity: number; active: number; override: number | null; vehicleCapacity: number | null }> {
  const [r] = await db.query(
    `SELECT ${CAPACITY_SQL} AS capacity, ${ACTIVE_SQL('d.id')} AS active, d.capacity_override AS override,
            (SELECT v.max_active_deliveries FROM vehicle_types v WHERE v.id = d.vehicle_type_id) AS vehicle_capacity
       FROM drivers d WHERE d.id = $1::uuid`,
    [driverId, ACTIVE_DRIVER_ORDER_STATUSES, null, null],
  );
  return { capacity: Number(r?.capacity ?? 1), active: Number(r?.active ?? 0), override: r?.override ?? null, vehicleCapacity: r?.vehicle_capacity ?? null };
}
