/** Read-only segment history for the order views (admin sees names; vendor sees roles; the customer sees only what happened and why). */
export interface SegmentHistoryEntry {
  id: string;
  segmentId: string;
  fromStatus: string | null;
  toStatus: string;
  at: string;
  /** Hatly operations acted on the vendor's behalf. */
  onBehalfOfVendor: boolean;
  /** 'SYSTEM' when the platform itself made the change (automatic acceptance, Hatly/Wasally readiness). */
  actorRole: string;
  actorName?: string | null;
  actorUserId?: string | null;
  reason: string | null;
}

type Query = (sql: string, params?: unknown[]) => Promise<any[]>;

export async function loadSegmentHistory(query: Query, orderId: string, detail: 'FULL' | 'ROLE' | 'PUBLIC'): Promise<Map<string, SegmentHistoryEntry[]>> {
  return loadHistory(query, 'ev.order_id = $1', [orderId], detail);
}

/** Same, for a set of segments (the vendor's order list). */
export async function loadSegmentHistoryForSegments(query: Query, segmentIds: string[], detail: 'FULL' | 'ROLE' | 'PUBLIC'): Promise<Map<string, SegmentHistoryEntry[]>> {
  if (segmentIds.length === 0) return new Map();
  return loadHistory(query, 'ev.segment_id = ANY($1::uuid[])', [segmentIds], detail);
}

async function loadHistory(query: Query, where: string, params: unknown[], detail: 'FULL' | 'ROLE' | 'PUBLIC'): Promise<Map<string, SegmentHistoryEntry[]>> {
  const rows = await query(
    `SELECT ev.id, ev.segment_id, ev.from_status, ev.to_status, ev.created_at, ev.on_behalf_of_vendor, ev.actor_role, ev.actor_user_id, ev.reason, u.full_name
       FROM order_vendor_segment_events ev LEFT JOIN users u ON u.id = ev.actor_user_id
      WHERE ${where} ORDER BY ev.created_at ASC, ev.id ASC`,
    params,
  );
  const bySegment = new Map<string, SegmentHistoryEntry[]>();
  for (const r of rows) {
    const entry: SegmentHistoryEntry = {
      id: r.id,
      segmentId: r.segment_id,
      fromStatus: r.from_status ?? null,
      toStatus: r.to_status,
      at: new Date(r.created_at).toISOString(),
      onBehalfOfVendor: !!r.on_behalf_of_vendor,
      actorRole: r.actor_role ?? 'SYSTEM',
      reason: r.reason ?? null,
    };
    if (detail === 'FULL') {
      entry.actorName = r.full_name ?? null;
      entry.actorUserId = r.actor_user_id ?? null;
    }
    // The customer is told WHAT happened and WHY, never which staff member did it.
    if (detail === 'PUBLIC') entry.actorRole = r.on_behalf_of_vendor ? 'HATLY' : r.actor_role ? 'VENDOR' : 'SYSTEM';
    const list = bySegment.get(entry.segmentId) ?? [];
    list.push(entry);
    bySegment.set(entry.segmentId, list);
  }
  return bySegment;
}
