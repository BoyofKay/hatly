/**
 * Whether a branch is OPEN right now for customers: the manual open/closed switch AND no active (not cancelled) closure covering this instant.
 * A closure is an overlay and never rewrites the switch, so when it ends the branch is exactly as open as the switch says.
 */
export const effectiveOpenSql = (alias = 'b') =>
  `(${alias}.is_open AND NOT EXISTS (SELECT 1 FROM vendor_branch_closures vbc WHERE vbc.vendor_branch_id = ${alias}.id AND vbc.cancelled_at IS NULL AND vbc.starts_at <= now() AND vbc.ends_at > now()))`;

/** The ids (out of `ids`) that have an active closure right now. `query` is any object with a pg-style `query(sql, params)`. */
export async function branchIdsUnderClosure(db: { query: (sql: string, params?: unknown[]) => Promise<any> }, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows: Array<{ vendor_branch_id: string }> = await db.query(
    `SELECT DISTINCT vendor_branch_id FROM vendor_branch_closures WHERE vendor_branch_id = ANY($1) AND cancelled_at IS NULL AND starts_at <= now() AND ends_at > now()`,
    [ids],
  );
  return new Set(rows.map((r) => r.vendor_branch_id));
}
