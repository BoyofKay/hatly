/**
 * What the Admin Orders workspace stands on, over real HTTP against real PostgreSQL:
 *  - the list names the vendors of each order and the driver who has it (and no driver while it waits for one);
 *  - several statuses can be asked for at once (the queue views), every value validated;
 *  - the quick-find results lead to screens an Admin can actually open (an order opens in the workspace, a product in the catalogue — never in the
 *    vendor area, which would bounce an Admin to the login page);
 *  - a Vendor, a Driver and a Customer cannot read the list.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — Admin Orders workspace data', () => {
  let world: World;
  let s: Scenario;
  let v1: VendorFixture;
  let p1: { id: string; priceMinor: number };
  const home = { lat: 30.425, lng: 31.565 };
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', a: Actor | undefined, path: string, body?: unknown, query?: Record<string, string>) =>
    world.api(method, path, { token: a?.accessToken, body, query } as any);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Workspace Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    await s.driver({ lat: 30.42, lng: 31.56 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('the list names the vendor of each order, and the driver only while one is on the order', async () => {
    const admin = await s.superAdmin();
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = await s.checkout(c, home, 'COD');

    const find = async () => expectData<any[]>(await call('get', admin, '/admin/orders', undefined, { search: order.orderNumber })).find((o) => o.id === order.id);
    const fresh = await find();
    expect(fresh.vendorNames).toEqual(['Workspace Vendor']);
    expect(fresh.driver).toBeNull(); // nobody yet

    await s.vendorPrepares(v1, order.id);
    const d = await s.driverAssignedTo(order.id);
    const assigned = await find();
    expect(assigned.status).toBe('ASSIGNED_TO_DRIVER');
    expect(assigned.driver).toEqual({ id: expect.any(String), fullName: expect.any(String) });
    expect(assigned.driver.id).toBe((d as any).driverId);
  });

  it('several statuses at once for the queue views; an unknown status is refused; combined with another filter both apply', async () => {
    const admin = await s.superAdmin();
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const pending = await s.checkout(c, home, 'COD');

    const both = await call('get', admin, '/admin/orders', undefined, { statuses: 'PENDING,CONFIRMED', limit: '50' });
    expect(both.status).toBe(200);
    const rows = both.body.data as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => ['PENDING', 'CONFIRMED'].includes(r.status))).toBe(true);
    expect(rows.some((r) => r.id === pending.id)).toBe(true);

    expect((await call('get', admin, '/admin/orders', undefined, { statuses: 'PENDING,NOT_A_STATUS' })).status).toBe(400);
    const none = await call('get', admin, '/admin/orders', undefined, { statuses: 'PENDING,CONFIRMED', status: 'DELIVERED' });
    expect((none.body.data as any[]).length).toBe(0); // the order must match both
    const pickupOnly = await call('get', admin, '/admin/orders', undefined, { statuses: 'PENDING', fulfillmentType: 'PICKUP', limit: '50' });
    expect((pickupOnly.body.data as any[]).every((r) => r.fulfillmentType === 'PICKUP')).toBe(true);
  });

  it('quick-find leads an order to the workspace and a product to the catalogue — screens an Admin can open', async () => {
    const admin = await s.superAdmin();
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    const order = await s.checkout(c, home, 'COD');
    const res = expectData<any>(await call('get', admin, '/admin/search', undefined, { q: order.orderNumber }));
    const orders = res.groups.find((g: any) => g.type === 'orders');
    expect(orders.items[0].url).toBe(`/order-management?order=${order.id}`);
    const products = expectData<any>(await call('get', admin, '/admin/search', undefined, { q: 'Product' }));
    const productGroup = products.groups.find((g: any) => g.type === 'products');
    if (productGroup) expect(productGroup.items[0].url.startsWith('/catalog?q=')).toBe(true);
  });

  it('a vendor, a driver and a customer cannot read the Admin order list', async () => {
    const c = await s.customer();
    const d = await s.driver({ lat: 30.42, lng: 31.56 });
    for (const who of [v1.manager as Actor, d as Actor, c]) {
      const res = await call('get', who, '/admin/orders', undefined, { limit: '1' });
      expect([401, 403]).toContain(res.status);
    }
  });
});
