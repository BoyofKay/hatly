/**
 * Customer in-app notifications over real HTTP against real PostgreSQL. They are written in the same transaction as the real order
 * event they report (order created / a status transition), exactly once per (order, type), and a customer can only ever see,
 * count and mark THEIR OWN. Push (FCM) is a separate, pre-existing channel and is not touched here.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { CustomerNotificationType, recordOrderNotification } from '../../src/modules/notifications/customer-notification-events';

describe('E2E — customer notifications', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const list = (c: Actor, query = '') => world.api('get', `/customer/notifications${query}`, { token: c.accessToken });
  const types = async (c: Actor, orderId?: string) =>
    (expectData<any[]>(await list(c, '?limit=50')) as any[]).filter((n) => !orderId || n.orderId === orderId).map((n) => n.type).sort();
  const unread = async (c: Actor) => expectData<any>(await world.api('get', '/customer/notifications/unread-count', { token: c.accessToken })).count as number;
  const rowsOf = (orderId: string) => q('SELECT type FROM customer_notifications WHERE order_id = $1 ORDER BY type', [orderId]);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Notif Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('lifecycle triggers — only genuine order events create notifications', () => {
    it('placing an order notifies exactly once, with the order reference, unread', async () => {
      const c = await s.customer();
      const order = await s.simpleOrder(c, vendor, product.id, home);
      const res = await list(c);
      const items = expectData<any[]>(res);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ type: 'ORDER_PLACED', orderId: order.id, orderNumber: order.orderNumber, isRead: false, readAt: null });
      expect(items[0].title).toBeTruthy();
      expect(res.body.meta).toMatchObject({ page: 1, total: 1, unreadCount: 1 });
      expect(await unread(c)).toBe(1);
    });

    it('a delivery order walks CONFIRMED → PREPARING; the driver hand-off (READY_FOR_PICKUP of a DELIVERY order) tells the customer nothing', async () => {
      const c = await s.customer();
      const order = await s.simpleOrder(c, vendor, product.id, home);
      await s.vendorPrepares(vendor, order.id);
      const [{ status }] = await q('SELECT status FROM orders WHERE id = $1', [order.id]);
      expect(['READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER']).toContain(status);
      const t = await types(c, order.id);
      expect(t).toEqual(expect.arrayContaining(['ORDER_PLACED', 'ORDER_CONFIRMED', 'ORDER_PREPARING']));
      expect(t).not.toContain('ORDER_READY_FOR_PICKUP');
      expect(new Set(t).size).toBe(t.length); // each event once
    });

    it('a PICKUP order tells the customer it is ready to collect, and when it was collected', async () => {
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const order = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      await s.vendorPrepares(vendor, order.id);
      expect(await types(c, order.id)).toContain('ORDER_READY_FOR_PICKUP');
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: vendor.manager.accessToken, body: { status: 'COLLECTED' } }));
      expect(await types(c, order.id)).toEqual(expect.arrayContaining(['ORDER_PLACED', 'ORDER_READY_FOR_PICKUP', 'ORDER_COLLECTED']));
    });

    it('cancellation notifies once; a repeated cancel request (refused) adds nothing', async () => {
      const c = await s.customer();
      const order = await s.simpleOrder(c, vendor, product.id, home);
      expectData(await world.api('post', `/orders/${order.id}/cancel`, { token: c.accessToken, body: {} }), 201);
      expect((await rowsOf(order.id)).map((r: any) => r.type)).toEqual(['ORDER_CANCELLED', 'ORDER_PLACED']);
      const again = await world.api('post', `/orders/${order.id}/cancel`, { token: c.accessToken, body: {} });
      expect(again.status).toBeGreaterThanOrEqual(400);
      expect(await rowsOf(order.id)).toHaveLength(2);
    });

    it('a failed order (cart refused at checkout) creates no notification at all', async () => {
      const c = await s.customer();
      const res = await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }); // empty cart
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await types(c)).toEqual([]);
    });
  });

  describe('duplicate protection and failure isolation', () => {
    it('the same event recorded twice, or five times concurrently, leaves exactly ONE row', async () => {
      const c = await s.customer();
      const order = await s.simpleOrder(c, vendor, product.id, home);
      const ref = { id: order.id, customerId: c.id, orderNumber: order.orderNumber };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => world.ds.transaction((m) => recordOrderNotification(m, ref, CustomerNotificationType.ORDER_ON_THE_WAY))),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await world.ds.transaction((m) => recordOrderNotification(m, ref, CustomerNotificationType.ORDER_ON_THE_WAY))).toBe(false);
      const [{ n }] = await q("SELECT count(*)::int AS n FROM customer_notifications WHERE order_id = $1 AND type = 'ORDER_ON_THE_WAY'", [order.id]);
      expect(n).toBe(1);
    });

    it('a failing notification write is swallowed in a savepoint: the surrounding transaction (the order event) still commits', async () => {
      const c = await s.customer();
      const order = await s.simpleOrder(c, vendor, product.id, home);
      const bad = { id: order.id, customerId: c.id, orderNumber: 'X'.repeat(50) }; // violates varchar(20)
      const committed = await world.ds.transaction(async (m) => {
        const written = await recordOrderNotification(m, bad, CustomerNotificationType.ORDER_DELIVERED);
        await m.query("UPDATE orders SET order_note = 'still committed' WHERE id = $1", [order.id]);
        return written;
      });
      expect(committed).toBe(false);
      expect((await q('SELECT order_note FROM orders WHERE id = $1', [order.id]))[0].order_note).toBe('still committed');
      expect((await rowsOf(order.id)).map((r: any) => r.type)).toEqual(['ORDER_PLACED']);
    });
  });

  describe('ownership isolation', () => {
    it('a customer sees, counts and reads ONLY their own notifications; another customer’s id is a plain 404 and changes nothing', async () => {
      const alice = await s.customer('Alice');
      const bob = await s.customer('Bob');
      const aliceOrder = await s.simpleOrder(alice, vendor, product.id, home);
      expect(await types(bob)).toEqual([]);
      expect(await unread(bob)).toBe(0);

      const aliceNotification = expectData<any[]>(await list(alice))[0];
      const probe = await world.api('post', `/customer/notifications/${aliceNotification.id}/read`, { token: bob.accessToken });
      expect(probe.status).toBe(404);
      expect(probe.body.error.details).toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
      const nonexistent = await world.api('post', '/customer/notifications/00000000-0000-4000-8000-000000000000/read', { token: bob.accessToken });
      expect(nonexistent.status).toBe(404); // indistinguishable from "someone else's"
      expect(await unread(alice)).toBe(1);

      // read-all by Bob touches nothing of Alice's
      expect(expectData<any>(await world.api('post', '/customer/notifications/read-all', { token: bob.accessToken })).updated).toBe(0);
      expect(await unread(alice)).toBe(1);
      expect((await rowsOf(aliceOrder.id)).length).toBe(1);
    });

    it('only the customer role may use the endpoints (vendor, admin and anonymous are refused)', async () => {
      const admin = await s.superAdmin();
      for (const token of [vendor.manager.accessToken, admin.accessToken]) {
        expect((await world.api('get', '/customer/notifications', { token })).status).toBe(403);
        expect((await world.api('get', '/customer/notifications/unread-count', { token })).status).toBe(403);
        expect((await world.api('post', '/customer/notifications/read-all', { token })).status).toBe(403);
      }
      expect((await world.api('get', '/customer/notifications')).status).toBe(401);
    });

    it('the owner is never taken from the request (a customerId query/body parameter is ignored or rejected)', async () => {
      const alice = await s.customer('Alice2');
      const bob = await s.customer('Bob2');
      await s.simpleOrder(alice, vendor, product.id, home);
      const spoof = await world.api('get', `/customer/notifications?customerId=${alice.id}`, { token: bob.accessToken });
      if (spoof.status === 200) expect(expectData<any[]>(spoof)).toEqual([]);
      else expect(spoof.status).toBe(400);
    });
  });

  describe('read / unread', () => {
    it('marking read sets readAt once (idempotent), lowers the unread count; read-all clears the rest', async () => {
      const c = await s.customer();
      const o1 = await s.simpleOrder(c, vendor, product.id, home);
      await world.api('post', `/orders/${o1.id}/cancel`, { token: c.accessToken, body: {} });
      expect(await unread(c)).toBe(2);
      const [first] = expectData<any[]>(await list(c));

      const read = expectData<any>(await world.api('post', `/customer/notifications/${first.id}/read`, { token: c.accessToken }));
      expect(read).toMatchObject({ id: first.id, isRead: true });
      expect(read.readAt).toBeTruthy();
      const again = expectData<any>(await world.api('post', `/customer/notifications/${first.id}/read`, { token: c.accessToken }));
      expect(again.readAt).toBe(read.readAt);
      expect(await unread(c)).toBe(1);

      expect(expectData<any>(await world.api('post', '/customer/notifications/read-all', { token: c.accessToken })).updated).toBe(1);
      expect(await unread(c)).toBe(0);
      expect(expectData<any[]>(await list(c)).every((n) => n.isRead)).toBe(true);
    });

    it('a malformed id is a client error (400, rejected by the global id check), never a 500', async () => {
      const c = await s.customer();
      expect((await world.api('post', '/customer/notifications/not-a-uuid/read', { token: c.accessToken })).status).toBe(400);
    });
  });

  describe('pagination and limits', () => {
    it('newest first, page/limit with a total, a hard cap on the page size and on how deep history can be paged', async () => {
      const c = await s.customer();
      const orders = [];
      for (let i = 0; i < 3; i++) orders.push(await s.simpleOrder(c, vendor, product.id, home));
      // 3 orders × every notification type = genuine-shaped rows (inserted directly: the lifecycle is covered above)
      for (const o of orders) {
        for (const type of Object.values(CustomerNotificationType)) {
          await q('INSERT INTO customer_notifications (customer_id, order_id, type, order_number) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [c.id, o.id, type, o.orderNumber]);
        }
      }
      const total = Number((await q('SELECT count(*)::int AS n FROM customer_notifications WHERE customer_id = $1', [c.id]))[0].n);
      expect(total).toBe(3 * Object.values(CustomerNotificationType).length);

      // Every page of 10 (the number of notification types grows over time, so the page count is derived, never assumed).
      const pages = [];
      for (let page = 1; page <= Math.ceil(total / 10); page++) pages.push(await list(c, `?limit=10&page=${page}`));
      expect(pages[0].body.meta).toMatchObject({ page: 1, limit: 10, total });
      expect(pages.map((p) => expectData<any[]>(p).length)).toEqual(pages.map((_, i) => Math.min(10, total - i * 10)));
      const ids = pages.flatMap((p) => expectData<any[]>(p).map((n) => n.id));
      expect(new Set(ids).size).toBe(total); // no duplicates across pages
      const stamps = pages.flatMap((p) => expectData<any[]>(p).map((n) => new Date(n.createdAt).getTime()));
      expect([...stamps].sort((a, b) => b - a)).toEqual(stamps); // newest first

      expect((await list(c, '?limit=1000')).status).toBe(400);
      expect((await list(c, '?limit=0')).status).toBe(400);
      expect((await list(c, '?page=0')).status).toBe(400);
      expect((await list(c, '?page=21')).status).toBe(400);
      expect(expectData<any[]>(await list(c)).length).toBe(20); // default page size
    });

    it('a customer with no notifications gets an empty list and a zero count', async () => {
      const c = await s.customer();
      const res = await list(c);
      expect(expectData<any[]>(res)).toEqual([]);
      expect(res.body.meta).toMatchObject({ total: 0, unreadCount: 0 });
      expect(await unread(c)).toBe(0);
    });
  });
});
