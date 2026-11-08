import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRing, newSince, ringing, REPEAT_MS, SLOW_AFTER_MS, SLOW_REPEAT_MS } from './alarm-logic.ts';

const NOW = Date.parse('2026-11-08T10:00:00Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const crit = (id: string, msAgo = 0, extra: Record<string, unknown> = {}) => ({ id, priority: 'CRITICAL' as const, openedAt: at(msAgo), acknowledgedAt: null, resolvedAt: null, ...extra });
const high = (id: string) => ({ id, priority: 'HIGH' as const, openedAt: at(0), acknowledgedAt: null, resolvedAt: null });

test('the first load records history without treating it as new; later loads report only unseen, unacknowledged alerts', () => {
  const first = newSince(null, [crit('a'), crit('b')]);
  assert.deepEqual(first.fresh, []);
  const second = newSince(first.known, [crit('a'), crit('b'), crit('c'), crit('d', 0, { acknowledgedAt: at(0) })]);
  assert.deepEqual(second.fresh.map((a) => a.id), ['c']);
  assert.deepEqual(newSince(second.known, [crit('c')]).fresh, []);
});

test('a new critical alert rings at once; then it repeats every 30 s while unacknowledged — never faster, even from several tabs', () => {
  const alerts = [crit('a')];
  assert.equal(decideRing({ alerts, fresh: alerts, now: NOW, lastRingAt: NOW - 1000, snoozedUntil: 0 }), 'critical');
  assert.equal(decideRing({ alerts, fresh: [], now: NOW, lastRingAt: NOW - 10_000, snoozedUntil: 0 }), null);
  assert.equal(decideRing({ alerts, fresh: [], now: NOW, lastRingAt: NOW - REPEAT_MS, snoozedUntil: 0 }), 'critical');
});

test('acknowledged or resolved alerts never ring; an open alert from before the page opened still rings on schedule', () => {
  assert.equal(decideRing({ alerts: [crit('a', 0, { acknowledgedAt: at(0) })], fresh: [], now: NOW, lastRingAt: 0, snoozedUntil: 0 }), null);
  assert.equal(decideRing({ alerts: [crit('a', 0, { resolvedAt: at(0) })], fresh: [], now: NOW, lastRingAt: 0, snoozedUntil: 0 }), null);
  assert.equal(decideRing({ alerts: [crit('a', 60_000)], fresh: [], now: NOW, lastRingAt: 0, snoozedUntil: 0 }), 'critical');
  assert.deepEqual(ringing([crit('a'), high('b'), crit('c', 0, { acknowledgedAt: at(0) })]).map((a) => a.id), ['a']);
});

test('after 10 minutes of ringing the repeat slows to every 2 minutes (rate limit)', () => {
  const old = [crit('a', SLOW_AFTER_MS + 1000)];
  assert.equal(decideRing({ alerts: old, fresh: [], now: NOW, lastRingAt: NOW - REPEAT_MS, snoozedUntil: 0 }), null);
  assert.equal(decideRing({ alerts: old, fresh: [], now: NOW, lastRingAt: NOW - SLOW_REPEAT_MS, snoozedUntil: 0 }), 'critical');
});

test('a HIGH alert chimes once and never repeats; a snooze silences everything until it ends', () => {
  assert.equal(decideRing({ alerts: [high('h')], fresh: [high('h')], now: NOW, lastRingAt: 0, snoozedUntil: 0 }), 'high');
  assert.equal(decideRing({ alerts: [high('h')], fresh: [], now: NOW, lastRingAt: 0, snoozedUntil: 0 }), null);
  assert.equal(decideRing({ alerts: [crit('a')], fresh: [crit('a')], now: NOW, lastRingAt: 0, snoozedUntil: NOW + 1000 }), null);
  assert.equal(decideRing({ alerts: [crit('a')], fresh: [], now: NOW, lastRingAt: 0, snoozedUntil: NOW - 1 }), 'critical');
});
