/**
 * Owner decisions 2026-11-22 on dispatch, over real HTTP and a real database:
 *  - a driver switched "online" whose app is not open (no check-in for 3+ minutes) is never offered an order automatically;
 *  - among drivers within the preferred radius, the one with the fewest active orders goes first;
 *  - a driver who does not acknowledge in time loses the order to the next driver automatically (the alert stays);
 *  - a driver whose app has been silent for 30 minutes and who carries nothing is switched offline.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

describe('E2E — dispatch owner rules (2026-11-22)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };
  const mid = { lat: 30.4212, lng: 31.5712 };
  const dispatch = () => world.app.get(AutomaticDispatchService);
  const carrierOf = async (orderId: string) => (await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1 AND deleted_at IS NULL', [orderId]))[0]?.driver_id ?? null;
  const readyOrder = async () => {
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    return order as { id: string };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Owner Rules Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    superAdmin = await s.superAdmin();
  });
  beforeEach(async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('an "online" driver whose app is closed is skipped; the driver with the app open gets the order', async () => {
    const closed = await s.driver({ ...near }); // nearest
    const open = await s.driver({ ...mid });
    await world.ds.query(`UPDATE drivers SET last_seen_at = now() - interval '2 days' WHERE id = $1`, [closed.driverId]);
    const order = await readyOrder();
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await dispatch().attemptAutomaticDispatch(order.id);
    expect(await carrierOf(order.id)).toBe(open.driverId);
  });

  it('within the preferred radius the less busy driver wins over the nearest busy one', async () => {
    const busy = await s.driver({ ...near });
    const idle = await s.driver({ ...mid });
    // give the nearest driver an order first (manual), then a second order goes automatically
    const first = await readyOrder();
    expectData(await world.api('post', `/admin/orders/${first.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: busy.driverId } }), 201);
    await world.ds.query(`UPDATE drivers SET capacity_override = 5 WHERE id = $1`, [busy.driverId]);
    await world.ds.query(`UPDATE drivers SET is_available = true WHERE id = $1`, [busy.driverId]);
    const second = await readyOrder();
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await dispatch().attemptAutomaticDispatch(second.id);
    expect(await carrierOf(second.id)).toBe(idle.driverId);
  });

  it('not acknowledged in time → the order moves to the next driver and the alert stays', async () => {
    const silent = await s.driver({ ...near });
    const next = await s.driver({ ...mid });
    const order = await readyOrder();
    expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: silent.driverId } }), 201);
    await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [order.id]);
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await dispatch().alertUnacknowledgedAssignments();
    expect(await carrierOf(order.id)).toBe(next.driverId);
    const [alert] = await world.ds.query(`SELECT reason, detail FROM dispatch_alerts WHERE order_id = $1 AND reason = 'ACKNOWLEDGEMENT_OVERDUE' AND resolved_at IS NULL`, [order.id]);
    expect(alert?.detail).toContain('offered to the next driver');
  });

  it('with automatic assignment OFF the order stays with the silent driver (Operations decide)', async () => {
    const silent = await s.driver({ ...near });
    await s.driver({ ...mid });
    const order = await readyOrder();
    expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: silent.driverId } }), 201);
    await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [order.id]);
    await dispatch().alertUnacknowledgedAssignments();
    expect(await carrierOf(order.id)).toBe(silent.driverId);
  });

  it('a driver silent for 30 minutes with nothing to carry is switched offline; one carrying an order is not', async () => {
    const idle = await s.driver({ ...near });
    const carrying = await s.driver({ ...mid });
    const order = await readyOrder();
    expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: carrying.driverId } }), 201);
    await world.ds.query(`UPDATE drivers SET is_online = true, last_seen_at = now() - interval '45 minutes' WHERE id = ANY($1)`, [[idle.driverId, carrying.driverId]]);
    await dispatch().switchOffSilentDrivers();
    const rows = await world.ds.query(`SELECT id, is_online FROM drivers WHERE id = ANY($1)`, [[idle.driverId, carrying.driverId]]);
    const online = Object.fromEntries(rows.map((r: any) => [r.id, r.is_online]));
    expect(online[idle.driverId]).toBe(false);
    expect(online[carrying.driverId]).toBe(true);
  });
});
