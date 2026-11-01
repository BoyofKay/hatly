import test from 'node:test';
import assert from 'node:assert/strict';
import { cairoNowLocal, cairoToIso } from './cairo-time.ts';

test('winter Cairo time is UTC+2 and summer follows the platform time-zone data (UTC+3 when daylight saving applies); the conversion round-trips', () => {
  assert.equal(cairoToIso('2026-01-15T10:00'), '2026-01-15T08:00:00.000Z');
  const summer = cairoToIso('2026-07-15T10:00')!;
  assert.ok(summer === '2026-07-15T07:00:00.000Z' || summer === '2026-07-15T08:00:00.000Z', `unexpected ${summer}`);
  const back = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(summer));
  assert.equal(back, '10:00');
});

test('the Cairo "now" value converts back to (about) the current instant', () => {
  const iso = cairoToIso(cairoNowLocal(0))!;
  assert.ok(Math.abs(Date.parse(iso) - Date.now()) < 120_000);
});

test('invalid input gives null', () => {
  assert.equal(cairoToIso(''), null);
  assert.equal(cairoToIso('nonsense'), null);
});
