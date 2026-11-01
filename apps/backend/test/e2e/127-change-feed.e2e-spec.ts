/**
 * D-72 change detection — "what changed since my cursor", instead of re-downloading lists. Real HTTP, real PostgreSQL, the real triggers.
 *  - the feed carries ids/kinds only, scoped to the caller (a vendor sees only its own branches; Operations need the order permission);
 *  - the cursor is stable: a transaction that commits late can never appear BEHIND a cursor a client already holds;
 *  - a client that was away gets everything it missed; one whose cursor was pruned (or is not ours) is told to reload once;
 *  - the existing list endpoints stay as the fallback.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { ChangeFeedService } from '../../src/modules/orders/changes/change-feed.service';

describe('E2E — change detection (D-72)', () => {
  let world: World;
  let s: Scenario;
  let feed: ChangeFeedService;
  let area: { id: string };
  let ops: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let pA: { id: string };
  let pB: { id: string };
  let pC: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const place = async (lines: Array<[{ id: string }, number]>) => {
    const c = await s.customer();
    for (const [p, q] of lines) await s.addToCart(c, p.id, q, {});
    return { c, order: await s.checkout(c, home, 'COD') };
  };
  const vendorPoll = (a: Actor, since?: string, query: Record<string, string> = {}, headers: Record<string, string> = {}) =>
    world.api('get', '/vendor/orders/changes', { token: a.accessToken, query: since ? { since, ...query } : query, headers });
  const adminPoll = (a: Actor, since?: string, query: Record<string, string> = {}) => world.api('get', '/admin/changes', { token: a.accessToken, query: since ? { since, ...query } : query });
  const data = (res: { status: number; body: any }) => expectData<{ cursor: string; changes: Array<{ entity: string; id: string; orderId: string; kind: string; seq: string }>; hasMore: boolean; reset: boolean }>(res);
  const baselineOf = async (a: Actor) => data(await vendorPoll(a)).cursor;
  const ids = (page: { changes: Array<{ entity: string; id: string }> }, entity?: string) => page.changes.filter((c) => !entity || c.entity === entity).map((c) => c.id);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    feed = world.app.get(ChangeFeedService);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    ops = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_FULFILMENT], 'D72 Ops');
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'D72 Reviewer');
    v1 = await s.vendor({ name: 'D72 One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'D72 Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    pA = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    pB = await s.product(v1, { priceMinor: 5000, inventoryMode: 'OPEN' });
    pC = await s.product(v2, { priceMinor: 3000, inventoryMode: 'OPEN' });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('without a cursor it only returns a starting point (call it BEFORE loading the list); `changes` is not mistaken for an order id', async () => {
    const res = await vendorPoll(v1.manager);
    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({ changes: [], hasMore: false, reset: false, cursor: expect.stringMatching(/^v1\.\d+\.\d+$/) });
    expect((await world.api('get', '/vendor/orders', { token: v1.manager.accessToken })).status).toBe(200); // the existing list is still the fallback
    expect((await world.api('get', '/admin/orders', { token: ops.accessToken })).status).toBe(200);
  });

  it('a new order reaches ONLY the vendor that owns the part (and Operations), as ids — never customer data', async () => {
    const base1 = await baselineOf(v1.manager);
    const base2 = await baselineOf(v2.manager);
    const baseAdmin = data(await adminPoll(ops)).cursor;
    const { order } = await place([[pA, 1], [pC, 1]]);
    const seg1 = await segmentOf(order.id, v1);
    const seg2 = await segmentOf(order.id, v2);

    const mine = data(await vendorPoll(v1.manager, base1));
    expect(ids(mine, 'SEGMENT')).toContain(seg1);
    expect(ids(mine, 'SEGMENT')).not.toContain(seg2);
    expect(mine.changes.every((c) => c.entity !== 'ORDER')).toBe(true); // vendors never see order-level entities
    expect(ids(data(await vendorPoll(v2.manager, base2)), 'SEGMENT')).toContain(seg2);
    expect(ids(data(await vendorPoll(v2.manager, base2)), 'SEGMENT')).not.toContain(seg1);

    const admin = data(await adminPoll(ops, baseAdmin, { topics: 'orders' }));
    expect(ids(admin, 'ORDER')).toContain(order.id);
    expect(ids(admin, 'SEGMENT')).toEqual(expect.arrayContaining([seg1, seg2]));
    expect(JSON.stringify(mine)).not.toMatch(/phone|address|customer|fullName/i);
    expect(Object.keys(mine.changes[0]).sort()).toEqual(['entity', 'id', 'kind', 'orderId', 'seq']);
  });

  it('an idle feed is cheap: the same cursor comes back and a repeat request is a 304', async () => {
    await place([[pA, 1]]);
    const first = data(await vendorPoll(v1.manager, await baselineOf(v1.manager)));
    expect(first.changes).toEqual([]);
    const cursor = (await baselineOf(v1.manager));
    const a = await vendorPoll(v1.manager, cursor);
    expect(data(a).changes).toEqual([]);
    expect(data(a).cursor).toBe(cursor);
    const etag = a.headers['etag'];
    expect(etag).toBeTruthy();
    const again = await vendorPoll(v1.manager, cursor, {}, { 'If-None-Match': etag });
    expect(again.status).toBe(304);
  });

  it('a client that was away (reconnect) receives every change it missed, once, and then nothing', async () => {
    const { order: o1 } = await place([[pA, 1]]);
    const { order: o2 } = await place([[pB, 1]]);
    const oldCursor = await baselineOf(v1.manager);
    // The client goes offline; meanwhile both orders move forward.
    await s.vendorPrepares(v1, o1.id);
    await s.vendorPrepares(v1, o2.id);
    const segments = [await segmentOf(o1.id, v1), await segmentOf(o2.id, v1)];
    const caught = data(await vendorPoll(v1.manager, oldCursor));
    expect(ids(caught, 'SEGMENT')).toEqual(expect.arrayContaining(segments));
    expect(data(await vendorPoll(v1.manager, caught.cursor)).changes).toEqual([]); // caught up: nothing more
    // Reading consumes nothing: a retry after a dropped response (same old cursor) returns the same changes.
    expect(ids(data(await vendorPoll(v1.manager, oldCursor)), 'SEGMENT')).toEqual(expect.arrayContaining(segments));
  });

  it('pagination: pages are bounded, a page with more always moves the cursor on, and the pages together cover every change', async () => {
    const base = data(await adminPoll(ops)).cursor;
    const placed = [];
    for (let i = 0; i < 4; i++) placed.push((await place([[pA, 1]])).order.id);
    const seen = new Set<string>();
    const cursors: string[] = [];
    let since = base;
    let pages = 0;
    for (;;) {
      const page = data(await adminPoll(ops, since, { topics: 'orders', limit: '3' }));
      pages++;
      expect(page.changes.length).toBeLessThanOrEqual(3);
      for (const c of page.changes) if (c.entity === 'ORDER') seen.add(c.id);
      if (page.hasMore) expect(cursors).not.toContain(page.cursor); // a page that has more always moves the cursor to somewhere new
      cursors.push(page.cursor);
      since = page.cursor;
      if (!page.hasMore) break;
      expect(pages).toBeLessThan(40);
    }
    expect(pages).toBeGreaterThan(1);
    for (const id of placed) expect(seen.has(id)).toBe(true);
  });

  it('the cursor is stable against late commits: an event from a slower transaction is never skipped, and nothing is returned out of order', async () => {
    const { order: oA } = await place([[pA, 1]]);
    const { order: oB } = await place([[pB, 1]]);
    const segA = await segmentOf(oA.id, v1);
    const segB = await segmentOf(oB.id, v1);
    const cursor = await baselineOf(v1.manager);

    const slow = world.ds.createQueryRunner();
    await slow.connect();
    await slow.startTransaction();
    try {
      await slow.query('UPDATE order_vendor_segments SET updated_at = clock_timestamp() WHERE id = $1', [segA]); // event of an OLDER transaction, not committed yet
      await world.ds.query('UPDATE order_vendor_segments SET updated_at = clock_timestamp() WHERE id = $1', [segB]); // a LATER transaction commits first
      const during = data(await vendorPoll(v1.manager, cursor));
      // A reader that simply followed sequence numbers would now hand out segB's event and move past segA's — losing it for good.
      expect(ids(during, 'SEGMENT')).toEqual([]);
      expect(during.cursor).toBe(cursor);
    } finally {
      await slow.commitTransaction();
      await slow.release();
    }
    const after = data(await vendorPoll(v1.manager, cursor));
    expect(ids(after, 'SEGMENT')).toEqual([segA, segB]); // both arrive, in commit-safe order
    expect(data(await vendorPoll(v1.manager, after.cursor)).changes).toEqual([]);
  });

  it('a rolled-back change leaves no event', async () => {
    const { order } = await place([[pA, 1]]);
    const seg = await segmentOf(order.id, v1);
    const cursor = await baselineOf(v1.manager);
    const qr = world.ds.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    await qr.query('UPDATE order_vendor_segments SET updated_at = clock_timestamp() WHERE id = $1', [seg]);
    await qr.rollbackTransaction();
    await qr.release();
    expect(data(await vendorPoll(v1.manager, cursor)).changes).toEqual([]);
  });

  it('a cursor that cannot be honoured (pruned, foreign, malformed) is answered safely: reload once, then carry on from the fresh cursor', async () => {
    const { order } = await place([[pA, 1]]);
    const old = await baselineOf(v1.manager);
    await s.vendorPrepares(v1, order.id);
    expect(data(await vendorPoll(v1.manager, old)).changes.length).toBeGreaterThan(0);

    await feed.prune(0); // retention elapsed: everything so far is gone
    const reset = data(await vendorPoll(v1.manager, old));
    expect(reset).toMatchObject({ reset: true, changes: [], hasMore: false });
    expect(reset.cursor).not.toBe(old);
    // From the fresh cursor the feed works again and sees only new changes.
    const { order: next } = await place([[pB, 1]]);
    expect(ids(data(await vendorPoll(v1.manager, reset.cursor)), 'SEGMENT')).toContain(await segmentOf(next.id, v1));
    // A cursor from the future (another environment / restored database) is not trusted either.
    expect(data(await vendorPoll(v1.manager, 'v1.999999999999999.1'))).toMatchObject({ reset: true });
    for (const bad of ['garbage', 'v1.1', 'v2.1.1', '1.2.3', 'v1.-1.1', 'v1.1.1;DROP TABLE orders']) {
      const res = await vendorPoll(v1.manager, bad);
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('INVALID_CURSOR');
    }
  });

  it('exception activity is a change for the vendor of that part and for Operations — not for another vendor', async () => {
    const { order } = await place([[pA, 1], [pB, 1], [pC, 1]]);
    const seg1 = await segmentOf(order.id, v1);
    const base1 = await baselineOf(v1.manager);
    const base2 = await baselineOf(v2.manager);
    const baseAdmin = data(await adminPoll(ops)).cursor;
    const item = (await world.ds.query('SELECT i.id FROM order_items i WHERE i.order_vendor_segment_id = $1 LIMIT 1', [seg1]))[0].id;
    const ex = expectData<any>(await world.api('post', `/vendor/orders/segments/${seg1}/unavailable-items`, { token: v1.manager.accessToken, body: { itemIds: [item] } }), 201);

    const mine = data(await vendorPoll(v1.manager, base1));
    expect(ids(mine, 'EXCEPTION')).toContain(ex.id);
    expect(data(await vendorPoll(v2.manager, base2)).changes.filter((c) => c.id === ex.id)).toEqual([]);
    const onlyExceptions = data(await adminPoll(ops, baseAdmin, { topics: 'exceptions' }));
    expect(ids(onlyExceptions, 'EXCEPTION')).toContain(ex.id);
    expect(onlyExceptions.changes.every((c) => c.entity === 'EXCEPTION')).toBe(true);
    expect((await adminPoll(ops, baseAdmin, { topics: 'nonsense' })).status).toBe(400);
  });

  it('boundaries: customers, drivers, admins without the order permission and anonymous callers are refused; roles cannot cross over; a vendor with no branch sees nothing', async () => {
    const c = await s.customer();
    const driver = await s.driver({ lat: 30.42, lng: 31.56 });
    for (const [token, status] of [[c.accessToken, 403], [driver.accessToken, 403], [undefined, 401]] as const) {
      expect((await world.api('get', '/vendor/orders/changes', { token })).status).toBe(status);
      expect((await world.api('get', '/admin/changes', { token })).status).toBe(status);
    }
    expect((await adminPoll(reviewer)).status).toBe(403); // an admin without VIEW_ORDERS
    expect((await world.api('get', '/admin/changes', { token: v1.manager.accessToken })).status).toBe(403); // a vendor on the admin feed
    expect((await vendorPoll(ops)).status).toBe(403); // an admin on the vendor feed

    const cursor = await baselineOf(v2.manager);
    await place([[pC, 1]]);
    expect(data(await vendorPoll(v2.manager, cursor)).changes.length).toBeGreaterThan(0);
    await world.ds.query('UPDATE vendor_staff SET deleted_at = now() WHERE user_id = $1', [v2.manager.id]);
    try {
      expect(data(await vendorPoll(v2.manager, cursor))).toMatchObject({ changes: [], reset: false });
    } finally {
      await world.ds.query('UPDATE vendor_staff SET deleted_at = NULL WHERE user_id = $1', [v2.manager.id]);
    }
  });
});
