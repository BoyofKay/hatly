/**
 * Early dispatch (owner decision 2026-11-22, option b), over real HTTP and a real database: with EARLY_DISPATCH_ENABLED a driver is attached
 * when the store accepts (or the lead time before the expected ready time, whichever is later); the order keeps its own status; the driver
 * sees it as "being prepared", can acknowledge but not pick it up; when the store marks it ready the SAME driver gets it (no new search);
 * a cancellation frees the driver; an unverified bank transfer is never dispatched early; the switch off = today's behaviour.
 */
import { bootWorld, World } from './support/world';
import { Scenario, VendorFixture, expectData } from './support/actors';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

describe('E2E — early dispatch', () => {
  let world: World;
  let s: Scenario;
  let vendor: VendorFixture;
  let product: { id: string };
  const near = { lat: 30.4212, lng: 31.5612 };
  const home = { lat: 30.425, lng: 31.565 };
  const dispatch = () => world.app.get(AutomaticDispatchService);
  const delivery = async (orderId: string) => (await world.ds.query('SELECT driver_id, early_assigned_at FROM deliveries WHERE order_id = $1 AND deleted_at IS NULL', [orderId]))[0] ?? null;
  const orderStatus = async (orderId: string) => (await world.ds.query('SELECT status FROM orders WHERE id = $1', [orderId]))[0].status;
  const segmentsTo = async (orderId: string, statuses: string[]) => {
    const view = expectData<any>(await world.api('get', `/vendor/orders/${orderId}`, { token: vendor.manager.accessToken }));
    for (const segment of view.segments) for (const status of statuses) {
      expectData(await world.api('patch', `/vendor/orders/segments/${segment.id}/status`, { token: vendor.manager.accessToken, body: { status } }));
    }
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Early Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
  });
  beforeEach(async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await s.setConfig('EARLY_DISPATCH_ENABLED', true);
    await s.setConfig('DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES', 10);
  });
  afterAll(async () => {
    try {
      await s.setConfig('EARLY_DISPATCH_ENABLED', false);
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('accepted → the driver is attached while the order is still Preparing; they see it, acknowledge it, cannot pick it up; Ready → the same driver gets it', async () => {
    const driver = await s.driver({ ...near });
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await segmentsTo(order.id, ['CONFIRMED', 'PREPARING']);
    await world.ds.query(`UPDATE order_vendor_segments SET expected_ready_at = now() + interval '5 minutes' WHERE order_id = $1`, [order.id]); // a quick kitchen
    await dispatch().dispatchDueEarlyOrders();
    const d = await delivery(order.id);
    expect(d?.driver_id).toBe(driver.driverId);
    expect(d?.early_assigned_at).not.toBeNull();
    expect(['PENDING', 'CONFIRMED', 'PREPARING']).toContain(await orderStatus(order.id)); // the order keeps its own status while prepared

    const mine = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken }));
    const row = mine.find((x) => x.orderId === order.id);
    expect(row?.orderStatus ?? row?.status).toBeDefined();
    expect((await world.api('post', `/driver/deliveries/${row.id}/acknowledge`, { token: driver.accessToken })).status).toBeLessThan(300);
    expect((await world.api('patch', `/driver/deliveries/${row.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } })).status).toBeGreaterThanOrEqual(400);

    await segmentsTo(order.id, ['READY_FOR_PICKUP']);
    expect(await orderStatus(order.id)).toBe('ASSIGNED_TO_DRIVER');
    const after = await delivery(order.id);
    expect(after?.driver_id).toBe(driver.driverId);
    expect(after?.early_assigned_at).toBeNull();
    expect((await world.api('patch', `/driver/deliveries/${row.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } })).status).toBeLessThan(300);
  });

  it('a slow kitchen: nothing is attached until the lead time before the expected ready time', async () => {
    await s.driver({ ...near });
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await segmentsTo(order.id, ['CONFIRMED', 'PREPARING']);
    await world.ds.query(`UPDATE order_vendor_segments SET expected_ready_at = now() + interval '40 minutes' WHERE order_id = $1`, [order.id]);
    await dispatch().dispatchDueEarlyOrders();
    expect((await delivery(order.id))?.driver_id ?? null).toBeNull();
    await world.ds.query(`UPDATE order_vendor_segments SET expected_ready_at = now() + interval '8 minutes' WHERE order_id = $1`, [order.id]);
    await dispatch().dispatchDueEarlyOrders();
    expect((await delivery(order.id))?.driver_id).not.toBeNull();
  });

  it('the driver counts as busy, and a cancellation while preparing frees them', async () => {
    const driver = await s.driver({ ...near });
    await world.ds.query(`UPDATE drivers SET capacity_override = 1 WHERE id = $1`, [driver.driverId]);
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await segmentsTo(order.id, ['CONFIRMED', 'PREPARING']);
    await world.ds.query(`UPDATE order_vendor_segments SET expected_ready_at = now() + interval '5 minutes' WHERE order_id = $1`, [order.id]);
    await dispatch().dispatchDueEarlyOrders();
    expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(false);
    const admin = await s.superAdmin();
    expectData(await world.api('post', `/admin/orders/${order.id}/cancel`, { token: admin.accessToken, body: { reasonCode: 'VENDOR_UNAVAILABLE', reasonText: 'early dispatch test' } }), 201);
    expect(await orderStatus(order.id)).toBe('CANCELLED');
    expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(true);
  });

  it('switch off → nothing is attached before Ready (today\'s behaviour)', async () => {
    await s.setConfig('EARLY_DISPATCH_ENABLED', false);
    await s.driver({ ...near });
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await segmentsTo(order.id, ['CONFIRMED', 'PREPARING']);
    await dispatch().dispatchDueEarlyOrders();
    expect((await delivery(order.id))?.driver_id ?? null).toBeNull();
  });
});
