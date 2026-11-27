import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByOrder, unreadByOrder } from './group-by-order.ts';

const a = (id: string, orderId: string | null, at: string, isRead = false, severity = 'INFO') => ({ id, orderId, orderNumber: orderId ? `HT-${orderId}` : null, isRead, createdAt: at, severity });

test('one group per order, newest first; non-order alerts stay alone', () => {
  const g = groupByOrder([
    a('1', '7', '2026-11-27T10:00:00Z'),
    a('2', '8', '2026-11-27T10:05:00Z', true),
    a('3', '7', '2026-11-27T10:10:00Z', false, 'CRITICAL'),
    a('4', null, '2026-11-27T09:00:00Z'),
  ]);
  assert.deepEqual(g.map((x) => x.key), ['o:7', 'o:8', 'a:4']);
  assert.deepEqual(g[0].items.map((x) => x.id), ['3', '1']);
  assert.equal(g[0].unread, 2);
  assert.equal(g[0].critical, true);
  assert.equal(g[1].unread, 0);
});

test('unread count per order', () => {
  const m = unreadByOrder([a('1', '7', '2026-11-27T10:00:00Z'), a('2', '7', '2026-11-27T10:01:00Z', true), a('3', '9', '2026-11-27T10:02:00Z')]);
  assert.equal(m.get('7'), 1);
  assert.equal(m.get('9'), 1);
});
