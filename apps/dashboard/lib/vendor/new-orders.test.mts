// Run: node --experimental-strip-types --test lib/vendor/new-orders.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countAwaitingAcceptance, findNewOrderIds, titleWithCount } from './new-orders.ts';

const order = (id: string, ...statuses: string[]) => ({ id, segments: statuses.map((status) => ({ status })) }) as never;

test('only orders not seen before are new', () => {
  assert.deepEqual(findNewOrderIds(new Set(['a', 'b']), [order('a'), order('b'), order('c')]), ['c']);
  assert.deepEqual(findNewOrderIds(new Set(), [order('a')]), ['a']);
  assert.deepEqual(findNewOrderIds(new Set(['a']), []), []);
});

test('an order awaits acceptance while any of the vendor\'s parts is PENDING', () => {
  assert.equal(countAwaitingAcceptance([order('a', 'PENDING'), order('b', 'CONFIRMED'), order('c', 'CANCELLED', 'PENDING')]), 2);
  assert.equal(countAwaitingAcceptance([]), 0);
});

test('the tab title carries the count only when something waits', () => {
  assert.equal(titleWithCount('Hatly Vendor', 0), 'Hatly Vendor');
  assert.equal(titleWithCount('Hatly Vendor', 3), '(3) Hatly Vendor');
});
