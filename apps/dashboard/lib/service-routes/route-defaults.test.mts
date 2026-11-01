// Focused tests for the Hatly / Wasally default route location helpers. Run: node --experimental-strip-types --test lib/service-routes/route-defaults.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_ROUTE_DEFAULT_FORM,
  ROUTE_DEFAULT_DEFS,
  buildRouteDefault,
  formFromValue,
  isValidRouteDefault,
  missingDefaults,
  statusOf,
} from './route-defaults.ts';

const good = { latitude: 30.4181, longitude: 31.5622, label: 'Demo point' };

test('there are exactly three defaults: Hatly origin + destination and Wasally destination — and no Wasally origin', () => {
  assert.deepEqual(
    ROUTE_DEFAULT_DEFS.map((d) => `${d.service}:${d.role}`),
    ['Hatly:Origin', 'Hatly:Destination', 'Wasally:Destination'],
  );
  assert.equal(new Set(ROUTE_DEFAULT_DEFS.map((d) => d.key)).size, 3);
});

test('a stored value is classified: unset, usable, or set-but-invalid', () => {
  assert.equal(statusOf(null), 'NOT_CONFIGURED');
  assert.equal(statusOf(undefined), 'NOT_CONFIGURED');
  assert.equal(statusOf(good), 'CONFIGURED');
  assert.equal(statusOf({ latitude: 0, longitude: 0, label: 'Null Island' }), 'INVALID');
  assert.equal(statusOf({ latitude: 30.4, longitude: 31.5 }), 'INVALID');
  assert.equal(statusOf('Belbeis'), 'INVALID');
});

test('the same rules as the backend: numbers inside Egypt and a label of 1-120 characters', () => {
  assert.equal(isValidRouteDefault(good), true);
  assert.equal(isValidRouteDefault({ ...good, latitude: '30.4' }), false);
  assert.equal(isValidRouteDefault({ ...good, label: '   ' }), false);
  assert.equal(isValidRouteDefault({ ...good, label: 'x'.repeat(121) }), false);
  assert.equal(isValidRouteDefault({ ...good, latitude: 48.8, longitude: 2.3 }), false);
  assert.equal(isValidRouteDefault({ ...good, longitude: Number.NaN }), false);
});

test('a valid form becomes a trimmed value with real numbers', () => {
  const r = buildRouteDefault({ latitude: ' 30.4181 ', longitude: '31.5622', label: '  Demo point  ' });
  assert.deepEqual(r, { ok: true, value: good });
});

// Swapped values are only caught when they fall outside Egypt (30.4 / 31.5 and 31.5 / 30.4 are both inside it); the message says so.
test('every bad input is refused with a reason an admin can act on', () => {
  const cases: Array<[Partial<typeof EMPTY_ROUTE_DEFAULT_FORM>, RegExp]> = [
    [{ latitude: '30.4', longitude: '31.5', label: '' }, /label/i],
    [{ latitude: '30.4', longitude: '31.5', label: 'x'.repeat(121) }, /120/],
    [{ latitude: 'abc', longitude: '31.5', label: 'A' }, /decimal/i],
    [{ latitude: '', longitude: '31.5', label: 'A' }, /decimal/i],
    [{ latitude: '48.8', longitude: '2.3', label: 'A' }, /latitude/i],
    [{ latitude: '30.4', longitude: '2.3', label: 'A' }, /longitude/i],
  ];
  for (const [over, re] of cases) {
    const r = buildRouteDefault({ ...EMPTY_ROUTE_DEFAULT_FORM, ...over });
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match((r as { error: string }).error, re, JSON.stringify(over));
  }
});

test('the form is pre-filled only from a usable value; an invalid stored value starts blank', () => {
  assert.deepEqual(formFromValue(good), { latitude: '30.4181', longitude: '31.5622', label: 'Demo point' });
  assert.deepEqual(formFromValue({ latitude: 0, longitude: 0, label: 'x' }), EMPTY_ROUTE_DEFAULT_FORM);
  assert.deepEqual(formFromValue(null), EMPTY_ROUTE_DEFAULT_FORM);
});

test('missingDefaults lists exactly what the owner still has to enter', () => {
  const [hatlyOrigin, hatlyDestination, wasallyDestination] = ROUTE_DEFAULT_DEFS;
  assert.equal(missingDefaults({}).length, 3);
  const partial = missingDefaults({ [hatlyOrigin.key]: good, [wasallyDestination.key]: { latitude: 0, longitude: 0, label: 'bad' } });
  assert.deepEqual(partial.map((d) => d.key), [hatlyDestination.key, wasallyDestination.key]);
  assert.equal(missingDefaults({ [hatlyOrigin.key]: good, [hatlyDestination.key]: good, [wasallyDestination.key]: good }).length, 0);
});
