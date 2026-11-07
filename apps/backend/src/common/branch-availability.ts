/**
 * Whether a branch is OPEN right now for customers (R9, decision register 2026-11-06): the manual open/closed switch, no active (not cancelled)
 * closure covering this instant, AND — when the branch has weekly opening hours — inside them. A closure is an overlay and never rewrites the
 * switch, so when it ends the branch is exactly as open as the switch and the hours say.
 *
 * Opening hours: `{ mon: { open: 'HH:mm', close: 'HH:mm' }, … }` in Cairo time. A branch with NO hours configured (`{}`) has no hour limit
 * (nothing is invented); once any day is configured, a day that is not listed is a closed day. `close` earlier than `open` means the branch
 * stays open past midnight (e.g. 18:00–02:00 — the early hours belong to the previous day's span); `open` = `close` means open all day.
 */
export const CAIRO_TZ = 'Africa/Cairo';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const; // index = JS getDay() / Postgres EXTRACT(dow)

const hoursOpenSql = (alias: string) => {
  const local = `(now() AT TIME ZONE '${CAIRO_TZ}')`;
  const today = `(ARRAY['sun','mon','tue','wed','thu','fri','sat'])[EXTRACT(dow FROM ${local})::int + 1]`;
  const yesterday = `(ARRAY['sun','mon','tue','wed','thu','fri','sat'])[((EXTRACT(dow FROM ${local})::int + 6) % 7) + 1]`;
  const t = `to_char(${local}, 'HH24:MI')`;
  const o = (d: string) => `(${alias}.opening_hours -> ${d} ->> 'open')`;
  const c = (d: string) => `(${alias}.opening_hours -> ${d} ->> 'close')`;
  return `(COALESCE(${alias}.opening_hours, '{}'::jsonb) = '{}'::jsonb
    OR (${o(today)} IS NOT NULL AND (
         (${o(today)} = ${c(today)})
      OR (${o(today)} < ${c(today)} AND ${t} >= ${o(today)} AND ${t} < ${c(today)})
      OR (${o(today)} > ${c(today)} AND ${t} >= ${o(today)})))
    OR (${o(yesterday)} IS NOT NULL AND ${o(yesterday)} > ${c(yesterday)} AND ${t} < ${c(yesterday)}))`;
};

export const effectiveOpenSql = (alias = 'b') =>
  `(${alias}.is_open AND NOT EXISTS (SELECT 1 FROM vendor_branch_closures vbc WHERE vbc.vendor_branch_id = ${alias}.id AND vbc.cancelled_at IS NULL AND vbc.starts_at <= now() AND vbc.ends_at > now()) AND ${hoursOpenSql(alias)})`;

/** The ids (out of `ids`) that have an active closure right now. `query` is any object with a pg-style `query(sql, params)`. */
export async function branchIdsUnderClosure(db: { query: (sql: string, params?: unknown[]) => Promise<any> }, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows: Array<{ vendor_branch_id: string }> = await db.query(
    `SELECT DISTINCT vendor_branch_id FROM vendor_branch_closures WHERE vendor_branch_id = ANY($1) AND cancelled_at IS NULL AND starts_at <= now() AND ends_at > now()`,
    [ids],
  );
  return new Set(rows.map((r) => r.vendor_branch_id));
}

type Hours = Record<string, { open?: unknown; close?: unknown } | null | undefined> | null | undefined;

/** Cairo-local weekday key, the previous weekday key and HH:mm of an instant. */
export function cairoClock(at: Date): { day: (typeof DAYS)[number]; previousDay: (typeof DAYS)[number]; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: CAIRO_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at);
  const weekday = (parts.find((p) => p.type === 'weekday')?.value ?? 'Sun').slice(0, 3).toLowerCase() as (typeof DAYS)[number];
  const hour = (parts.find((p) => p.type === 'hour')?.value ?? '00').replace('24', '00');
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const idx = DAYS.indexOf(weekday);
  return { day: weekday, previousDay: DAYS[(idx + 6) % 7], time: `${hour}:${minute}` };
}

/** The same rule as the SQL above, for a branch already loaded. */
export function isWithinOpeningHours(hours: Hours, at: Date = new Date()): boolean {
  if (!hours || typeof hours !== 'object' || Object.keys(hours).length === 0) return true;
  const { day, previousDay, time } = cairoClock(at);
  const span = (d: string) => {
    const h = hours[d];
    return h && typeof h.open === 'string' && typeof h.close === 'string' ? { open: h.open, close: h.close } : null;
  };
  const today = span(day);
  if (today) {
    if (today.open === today.close) return true;
    if (today.open < today.close && time >= today.open && time < today.close) return true;
    if (today.open > today.close && time >= today.open) return true;
  }
  const prev = span(previousDay);
  return !!prev && prev.open > prev.close && time < prev.close;
}
