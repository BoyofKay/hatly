/**
 * Pure decisions behind the Admin alarm (no browser APIs here, so they are unit-tested directly).
 *
 * RINGING — while at least one CRITICAL alert is neither acknowledged nor resolved, the alarm rings: at once when a new one appears, then
 * every `REPEAT_MS`; once the oldest has been ringing for `SLOW_AFTER_MS` the repeat slows to `SLOW_REPEAT_MS` (rate limit — the banner,
 * title and pushes continue). A HIGH alert chimes once when it appears and never repeats. A snooze silences sound only, for a bounded time.
 */
export const REPEAT_MS = 30_000;
export const SLOW_AFTER_MS = 10 * 60_000;
export const SLOW_REPEAT_MS = 120_000;
export const SNOOZE_MS = 10 * 60_000;

export interface AlarmAlert { id: string; priority: 'CRITICAL' | 'HIGH'; openedAt: string; acknowledgedAt: string | null; resolvedAt: string | null }

export const needsAttention = (a: AlarmAlert) => !a.acknowledgedAt && !a.resolvedAt;
export const ringing = <T extends AlarmAlert>(alerts: T[]): T[] => alerts.filter((a) => a.priority === 'CRITICAL' && needsAttention(a));

/** Alerts not seen by this page before (the very first load only records what is there — it never rings for history on page open). */
export function newSince<T extends AlarmAlert>(known: Set<string> | null, alerts: T[]): { fresh: T[]; known: Set<string> } {
  const next = new Set(known ?? []);
  const fresh: T[] = [];
  for (const a of alerts) {
    if (!next.has(a.id)) {
      next.add(a.id);
      if (known !== null && needsAttention(a)) fresh.push(a);
    }
  }
  return { fresh, known: next };
}

export type RingKind = 'critical' | 'high' | null;

/** What to play now, if anything. `lastRingAt` is shared across tabs (see alarm-leader), so several tabs never multiply the sound. */
export function decideRing(p: { alerts: AlarmAlert[]; fresh: AlarmAlert[]; now: number; lastRingAt: number; snoozedUntil: number }): RingKind {
  if (p.now < p.snoozedUntil) return null;
  const open = ringing(p.alerts);
  if (p.fresh.some((a) => a.priority === 'CRITICAL')) return 'critical';
  if (open.length > 0) {
    const oldest = Math.min(...open.map((a) => Date.parse(a.openedAt) || p.now));
    const every = p.now - oldest > SLOW_AFTER_MS ? SLOW_REPEAT_MS : REPEAT_MS;
    if (p.now - p.lastRingAt >= every - 500) return 'critical';
    return null;
  }
  if (p.fresh.some((a) => a.priority === 'HIGH')) return 'high';
  return null;
}
