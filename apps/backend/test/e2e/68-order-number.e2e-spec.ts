/**
 * Customer-facing order number (production-readiness slice). `HT-100234` — immutable, unique, generated server-side from
 * `order_number_seq` — replaces the shortened UUID everywhere a customer or support agent reads an order reference.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — customer-facing order number', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let viewer: Actor;
  let v1: VendorFixture;
  let p1: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const ORDER_NUMBER = /^HT-\d{6,}$/;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    viewer = await s.admin([Permission.VIEW_ORDERS]);
    v1 = await s.vendor({ name: 'ON 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const place = async () => {
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = await s.checkout(c, home, 'COD');
    return { c, order };
  };

  it('a created order has the format HT-NNNNNN, and it — never the id — is what the raw creation response foregrounds', async () => {
    const { order } = await place();
    expect(order.orderNumber).toMatch(ORDER_NUMBER);
    expect(order.id).toBeDefined(); // the UUID stays available internally
  });

  it('is immutable and identical everywhere the order is read back: list, details, tracking', async () => {
    const { c, order } = await place();
    const list = expectData<any[]>(await world.api('get', '/orders', { token: c.accessToken }));
    expect(list.find((o: any) => o.id === order.id).orderNumber).toBe(order.orderNumber);
    const details = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: c.accessToken }));
    expect(details.orderNumber).toBe(order.orderNumber);
    const tracking = expectData<any>(await world.api('get', `/orders/${order.id}/tracking`, { token: c.accessToken }));
    expect(tracking.orderNumber).toBe(order.orderNumber);
  });

  it('is unique under real concurrency: five simultaneous checkouts each get a distinct number', async () => {
    const customers = await Promise.all(Array.from({ length: 5 }, () => s.customer()));
    for (const c of customers) await s.addToCart(c, p1.id, 1);
    const orders = await Promise.all(customers.map((c) => s.checkout(c, home, 'COD')));
    const numbers = orders.map((o) => o.orderNumber);
    for (const n of numbers) expect(n).toMatch(ORDER_NUMBER);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('a database-level check: order_number is NOT NULL and UNIQUE for every real order', async () => {
    await place();
    const rows = await world.ds.query('SELECT order_number FROM orders');
    expect(rows.every((r: any) => typeof r.order_number === 'string' && r.order_number.length > 0)).toBe(true);
    const numbers = rows.map((r: any) => r.order_number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  describe('admin/support lookup', () => {
    it('the SAME order is returned by UUID and by order number — one lookup system, two accepted references', async () => {
      const { order } = await place();
      const byId = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: viewer.accessToken }));
      const byNumber = expectData<any>(
        await world.api('get', `/admin/orders/by-number/${order.orderNumber}`, { token: viewer.accessToken }),
      );
      expect(byNumber).toEqual(byId);
      expect(byId.orderNumber).toBe(order.orderNumber);
    });

    it('an unknown order number is a 404, not a 500 (never guessed/coerced into a UUID query)', async () => {
      const res = await world.api('get', '/admin/orders/by-number/HT-999999', { token: viewer.accessToken });
      expect(res.status).toBe(404);
    });

    it('requires VIEW_ORDERS, same as the UUID lookup', async () => {
      const nobody = await s.admin([]);
      const { order } = await place();
      expect((await world.api('get', `/admin/orders/by-number/${order.orderNumber}`, { token: nobody.accessToken })).status).toBe(403);
    });
  });
});
