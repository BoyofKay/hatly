import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChangeFeed } from './change-feed.ts';
import type { ChangesPage } from './change-feed.ts';

const page = (over: Partial<ChangesPage> = {}): ChangesPage => ({ cursor: 'v1.1.1', changes: [], hasMore: false, reset: false, ...over });
const change = (id: string) => ({ entity: 'SEGMENT', id, orderId: 'o', kind: 'STATUS', seq: '1' });

function harness(fetchPage: (since?: string) => Promise<ChangesPage>, extra: Record<string, unknown> = {}) {
  let reloads = 0;
  let clock = 0;
  const modes: string[] = [];
  const feed = new ChangeFeed({ fetchPage, reload: async () => void reloads++, onMode: (m) => modes.push(m), isVisible: () => true, now: () => clock, setTimer: () => 0, clearTimer: () => undefined, ...extra });
  return { feed, reloads: () => reloads, advance: (ms: number) => void (clock += ms), modes };
}

test('asks for the cursor BEFORE the first full load, then loads once', async () => {
  const calls: Array<string | undefined> = [];
  const order: string[] = [];
  const h = harness(async (since) => (calls.push(since), order.push('feed'), page({ cursor: 'v1.5.5' })), { reload: async () => void order.push('reload') });
  await h.feed.start();
  h.feed.stop();
  assert.deepEqual(order, ['feed', 'reload']);
  assert.deepEqual(calls, [undefined]);
  assert.equal(h.feed.currentCursor, 'v1.5.5');
  assert.equal(h.feed.currentMode, 'feed');
});

test('an idle feed never reloads the list; a change reloads it once and moves the cursor', async () => {
  let n = 0;
  const h = harness(async (since) => {
    if (since === undefined) return page({ cursor: 'c0' });
    n++;
    return n === 2 ? page({ cursor: 'c2', changes: [change('a')] }) : page({ cursor: since });
  });
  await h.feed.start();
  assert.equal(h.reloads(), 1);
  await h.feed.tick();
  await h.feed.tick(); // idle, then a change
  assert.equal(h.reloads(), 2);
  assert.equal(h.feed.currentCursor, 'c2');
  await h.feed.tick();
  assert.equal(h.reloads(), 2);
  h.feed.stop();
});

test('pages with more changes are drained in one go', async () => {
  const pages = [page({ cursor: 'c1', changes: [change('a')], hasMore: true }), page({ cursor: 'c2', changes: [change('b')], hasMore: true }), page({ cursor: 'c3', changes: [change('c')] })];
  let i = 0;
  const seen: string[] = [];
  const h = harness(async (since) => (since === undefined ? page({ cursor: 'c0' }) : pages[i++]), { onChanges: (c: Array<{ id: string }>) => seen.push(...c.map((x) => x.id)) });
  await h.feed.start();
  await h.feed.tick();
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(h.feed.currentCursor, 'c3');
  h.feed.stop();
});

test('a reset (cursor pruned or foreign) reloads once and continues from the fresh cursor', async () => {
  const h = harness(async (since) => (since === 'c0' ? page({ cursor: 'fresh', reset: true }) : page({ cursor: since ?? 'c0' })));
  await h.feed.start();
  assert.equal(h.reloads(), 1);
  await h.feed.tick();
  assert.equal(h.reloads(), 2);
  assert.equal(h.feed.currentCursor, 'fresh');
  h.feed.stop();
});

test('falls back to the old full-list polling when the endpoint is unavailable, and tries the feed again later', async () => {
  let available = false;
  const h = harness(async () => {
    if (!available) throw new Error('404');
    return page({ cursor: 'c0' });
  });
  await h.feed.start();
  assert.equal(h.feed.currentMode, 'legacy');
  assert.equal(h.reloads(), 1);
  await h.feed.tick(); // legacy: a full reload every cycle
  assert.equal(h.reloads(), 2);
  available = true;
  h.advance(301_000);
  await h.feed.tick(); // time to try the feed again
  assert.equal(h.feed.currentMode, 'feed');
  assert.deepEqual(h.modes, ['legacy', 'feed']); // announced when first known, then when the feed comes back
  h.feed.stop();
});

test('repeated errors drop to legacy polling; a single error does not', async () => {
  let fail = false;
  const h = harness(async (since) => {
    if (fail && since !== undefined) throw new Error('boom');
    return page({ cursor: 'c0' });
  });
  await h.feed.start();
  fail = true;
  await h.feed.tick();
  assert.equal(h.feed.currentMode, 'feed');
  await h.feed.tick();
  await h.feed.tick();
  assert.equal(h.feed.currentMode, 'legacy');
  assert.ok(h.reloads() >= 2);
  h.feed.stop();
});

test('a safety-net reload still happens in feed mode, so a lost event cannot leave a screen stale for long', async () => {
  const h = harness(async (since) => page({ cursor: since ?? 'c0' }));
  await h.feed.start();
  assert.equal(h.reloads(), 1);
  h.advance(121_000);
  await h.feed.tick();
  assert.equal(h.reloads(), 2);
  h.feed.stop();
});

test('a hidden tab does not poll, and a failing reload never stops the loop', async () => {
  let visible = false;
  let calls = 0;
  const h = harness(async (since) => (calls++, page({ cursor: since ?? 'c0' })), { isVisible: () => visible, reload: async () => { throw new Error('offline'); } });
  await h.feed.start();
  const before = calls;
  await h.feed.tick();
  assert.equal(calls, before);
  visible = true;
  await h.feed.tick();
  assert.equal(calls, before + 1);
  h.feed.stop();
});
