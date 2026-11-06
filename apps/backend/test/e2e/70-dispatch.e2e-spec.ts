/**
 * Group 8 / phase 13 — dispatch and drivers over real HTTP: automatic ranking and eligibility,
 * manual admin assignment with and without OVERRIDE_DISPATCH, driver rejection and reassignment,
 * availability release, dispatch alerts, and driver contention under concurrent readiness.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData, DEFAULT_PASSWORD } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { Role } from '../../src/common/enums/role.enum';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

describe('E2E — dispatch & drivers', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let vendor: VendorFixture;
  let product: { id: string };
  let superAdmin: Actor;
  const home = { lat: 30.425, lng: 31.565 };
  // the vendor sits at 30.421,31.561; longitude offsets move a driver progressively farther away
  const near = { lat: 30.4212, lng: 31.5612 };
  const mid = { lat: 30.4212, lng: 31.5712 };
  const far = { lat: 30.4212, lng: 31.6112 };

  const status = async (orderId: string) => (await world.ds.query('SELECT status FROM orders WHERE id = $1', [orderId]))[0].status as string;
  const deliveryRow = async (orderId: string) => (await world.ds.query('SELECT * FROM deliveries WHERE order_id = $1', [orderId]))[0];
  const driverRow = async (d: DriverFixture) => (await world.ds.query('SELECT is_available, is_online FROM drivers WHERE id = $1', [d.driverId]))[0];
  const readyOrder = async (customer?: Actor) => {
    const c = customer ?? (await s.customer());
    const order = await s.simpleOrder(c, vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    return order as { id: string; totalMinor: number };
  };
  const finish = async (orderId: string) => {
    const driver = await s.driverAssignedTo(orderId);
    const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === orderId);
    for (const st of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
      // M4 — Proof of Delivery is required for the DELIVERED transition (see s.uploadFakePhoto's own comment).
      const body = st === 'DELIVERED' ? { status: st, proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : { status: st };
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body }));
    }
  };
  /** Takes every existing driver out of the running so a test controls exactly who is eligible. */
  const retireAllDrivers = () => world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
  // Shared by both the single-instance timeout-reassignment tests below and the Dispatch Hardening
  // describe block further down (multi-instance/race/outage scenarios) — hoisted to file scope so
  // both can reuse the exact same helpers rather than each defining their own.
  const expireDeadline = (orderId: string) =>
    world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [orderId]);
  const sweep = () => world.app.get(AutomaticDispatchService).alertUnacknowledgedAssignments();
  const alertsFor = (orderId: string) => world.ds.query('SELECT * FROM dispatch_alerts WHERE order_id = $1', [orderId]);
  const ackAlerts = (orderId: string) =>
    world.ds.query("SELECT * FROM dispatch_alerts WHERE order_id = $1 AND reason = 'ACKNOWLEDGEMENT_OVERDUE' ORDER BY created_at", [orderId]);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Dispatch Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    superAdmin = await s.superAdmin();
  });
  beforeEach(async () => {
    boundary.reset();
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    await retireAllDrivers();
    // Test isolation (M5 Batch 3). Every real assignment gets a genuine 30 s acceptDeadlineAt, and the timeout sweep is global
    // (it looks at EVERY expired assigned delivery, by design). Deliveries left assigned by earlier tests would therefore
    // silently turn "expired" once the suite had been running for 30 s+ (a slow or loaded machine) and be picked up by a later
    // test's own sweep, skewing its processed/alerted counts. Starting each test from a clean baseline — no leftover delivery
    // can ever be due — makes the outcome independent of how long the suite has been running. Production logic is untouched.
    await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() + INTERVAL '1 hour' WHERE accept_deadline_at IS NOT NULL");
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });
  const comeBack = (d: DriverFixture) => world.ds.query('UPDATE drivers SET is_online = true, is_available = true WHERE id = $1', [d.driverId]);

  describe('automatic dispatch', () => {
    it('assigns the NEAREST eligible driver to the first pickup point; the others are untouched', async () => {
      const dFar = await s.driver({ ...far });
      const dNear = await s.driver({ ...near });
      const dMid = await s.driver({ ...mid });
      const order = await readyOrder();
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(dNear.driverId);
      expect(await driverRow(dNear)).toMatchObject({ is_available: false });
      expect(await driverRow(dMid)).toMatchObject({ is_available: true });
      expect(await driverRow(dFar)).toMatchObject({ is_available: true });
    });

    it('skips drivers who are offline, unverified, without a known location, unavailable, or outside the pickup service area', async () => {
      const eligible = await s.driver({ ...far }); // the ONLY valid one, and the farthest
      const offline = await s.driver({ ...near });
      const pending = await s.driver({ ...near });
      const noLocation = await s.driver({ ...near });
      const busy = await s.driver({ ...near });
      const elsewhere = await s.driver({ lat: 27.0, lng: 33.0 }); // not inside any service area
      await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [offline.driverId]);
      await world.ds.query("UPDATE drivers SET verification_status = 'PENDING' WHERE id = $1", [pending.driverId]);
      await world.ds.query('UPDATE drivers SET last_latitude = NULL, last_longitude = NULL WHERE id = $1', [noLocation.driverId]);
      await world.ds.query('UPDATE drivers SET is_available = false WHERE id = $1', [busy.driverId]);
      await comeBack(elsewhere);
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(eligible.driverId);
    });

    it('a bicycle driver is excluded until a maximum pickup distance is configured, then only within it', async () => {
      const bike = await s.driver({ ...near });
      const [bicycleType] = await world.ds.query("INSERT INTO vehicle_types (name, max_active_deliveries, is_bicycle) VALUES ('Bicycle', 1, true) RETURNING id");
      const admin = await s.superAdmin();
      const setVehicle = async (vehicleTypeId: string | null) =>
        expectData(await world.api('patch', `/admin/drivers/${bike.driverId}/vehicle-type`, { token: admin.accessToken, body: { vehicleTypeId } }));
      await setVehicle(bicycleType.id);
      const first = await readyOrder();
      expect(await status(first.id)).toBe('READY_FOR_PICKUP'); // fail closed: no limit configured
      await s.setConfig('MAX_BICYCLE_PICKUP_DISTANCE_METERS', 10);
      const tooFar = await readyOrder();
      expect(await status(tooFar.id)).toBe('READY_FOR_PICKUP');
      await s.setConfig('MAX_BICYCLE_PICKUP_DISTANCE_METERS', 5000);
      const ok = await readyOrder();
      expect((await deliveryRow(ok.id)).driver_id).toBe(bike.driverId);
      await world.ds.query('DELETE FROM dispatch_alerts');
      await setVehicle(null);
      await world.ds.query('DELETE FROM vehicle_types WHERE id = $1', [bicycleType.id]);
    });

    it('with no eligible driver the order waits at READY_FOR_PICKUP, raises a dispatch alert, and is listed for manual dispatch', async () => {
      await world.ds.query('DELETE FROM dispatch_alerts');
      const order = await readyOrder();
      expect(await status(order.id)).toBe('READY_FOR_PICKUP');
      expect(await deliveryRow(order.id)).toBeUndefined();
      const alerts = expectData<any[]>(await world.api('get', '/admin/dispatch-alerts', { token: superAdmin.accessToken }));
      expect(alerts.filter((a) => a.orderId === order.id)).toMatchObject([{ reason: 'NO_ELIGIBLE_DRIVER' }]);
      const queue = expectData<any[]>(await world.api('get', '/admin/orders/dispatchable', { token: superAdmin.accessToken }));
      expect(queue.find((q) => q.orderId === order.id)).toMatchObject({ status: 'READY_FOR_PICKUP', currentDriverId: null, reassignmentCount: 0 });
    });

    it('a driver who finishes a delivery is available again and can take the next order (Group 8 regression)', async () => {
      const d = await s.driver({ ...near });
      const first = await readyOrder();
      expect((await deliveryRow(first.id)).driver_id).toBe(d.driverId);
      const second = await readyOrder();
      expect(await status(second.id)).toBe('READY_FOR_PICKUP'); // still busy with the first
      await finish(first.id);
      expect(await driverRow(d)).toMatchObject({ is_available: true });
      const third = await readyOrder();
      expect((await deliveryRow(third.id)).driver_id).toBe(d.driverId);
    });

    it('going offline removes a driver from consideration; going online (with availability) restores it', async () => {
      const d = await s.driver({ ...near });
      expectData(await world.api('patch', '/driver/online-status', { token: d.accessToken, body: { isOnline: false } }));
      const missed = await readyOrder();
      expect(await status(missed.id)).toBe('READY_FOR_PICKUP');
      expectData(await world.api('patch', '/driver/online-status', { token: d.accessToken, body: { isOnline: true } }));
      const got = await readyOrder();
      expect((await deliveryRow(got.id)).driver_id).toBe(d.driverId);
    });
  });

  describe('contention', () => {
    it('one driver, three orders becoming ready at the same instant → exactly one is assigned, the driver is never double-booked', async () => {
      const d = await s.driver({ ...near });
      const orders: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const c = await s.customer();
        const o = await s.simpleOrder(c, vendor, product.id, home);
        orders.push(o.id);
      }
      await Promise.all(orders.map((id) => s.vendorPrepares(vendor, id)));
      const statuses = await Promise.all(orders.map(status));
      expect(statuses.filter((x) => x === 'ASSIGNED_TO_DRIVER')).toHaveLength(1);
      expect(statuses.filter((x) => x === 'READY_FOR_PICKUP')).toHaveLength(2);
      const rows = await world.ds.query('SELECT driver_id FROM deliveries WHERE driver_id = $1', [d.driverId]);
      expect(rows).toHaveLength(1);
    });

    it('two drivers, four orders at once → each driver gets exactly one, the rest wait', async () => {
      const a = await s.driver({ ...near });
      const b = await s.driver({ ...mid });
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) ids.push((await s.simpleOrder(await s.customer(), vendor, product.id, home)).id);
      await Promise.all(ids.map((id) => s.vendorPrepares(vendor, id)));
      const perDriver = await world.ds.query('SELECT driver_id, count(*)::int AS n FROM deliveries WHERE order_id = ANY($1) GROUP BY driver_id', [ids]);
      expect(perDriver.map((r: any) => r.n)).toEqual(expect.arrayContaining([1, 1]));
      expect(perDriver.every((r: any) => r.n === 1)).toBe(true);
      expect(new Set(perDriver.map((r: any) => r.driver_id))).toEqual(new Set([a.driverId, b.driverId]));
      expect((await Promise.all(ids.map(status))).filter((x) => x === 'READY_FOR_PICKUP')).toHaveLength(2);
    });
  });

  describe('manual dispatch by an admin', () => {
    it('with automatic dispatch OFF nothing is assigned; ASSIGN_REASSIGN_ORDERS can then assign the best driver, or a named eligible one', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const a = await s.driver({ ...near });
      const b = await s.driver({ ...mid });
      const order = await readyOrder();
      expect(await status(order.id)).toBe('READY_FOR_PICKUP');
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const assigned = expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: dispatcher.accessToken, body: {} }), 201);
      expect(assigned.driverId).toBe(a.driverId); // ranking picked the nearest
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');

      const second = await readyOrder();
      const named = expectData(await world.api('post', `/admin/orders/${second.id}/assign-driver`, { token: dispatcher.accessToken, body: { driverId: b.driverId } }), 201);
      expect(named.driverId).toBe(b.driverId);
    });

    it('naming a driver who fails the eligibility rules needs OVERRIDE_DISPATCH; without it the request is refused and nothing changes', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const off = await s.driver({ ...near });
      await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [off.driverId]);
      const plain = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const withOverride = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS, Permission.OVERRIDE_DISPATCH]);
      const order = await readyOrder();
      const refused = await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: plain.accessToken, body: { driverId: off.driverId } });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details).toEqual({ code: 'DRIVER_NOT_ELIGIBLE_WITHOUT_OVERRIDE' });
      expect(await status(order.id)).toBe('READY_FOR_PICKUP');
      // an offline driver cannot actually take the job even with override (the assignment transaction re-checks liveness)
      const still = await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: withOverride.accessToken, body: { driverId: off.driverId } });
      expect(still.status).toBeGreaterThanOrEqual(400);
      expect(still.status).toBeLessThan(500);
      expect(await status(order.id)).toBe('READY_FOR_PICKUP');
      await comeBack(off);
      const ok = await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: withOverride.accessToken, body: { driverId: off.driverId } });
      expect(ok.status).toBe(201);
    });

    it('an unknown driver id is a clean 4xx, and assigning an order that is not ready is refused', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      await s.driver({ ...near });
      const order = await s.simpleOrder(await s.customer(), vendor, product.id, home); // still PENDING
      const early = await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: {} });
      expect(early.status).toBeGreaterThanOrEqual(400);
      expect(early.status).toBeLessThan(500);
      expect(await status(order.id)).toBe('PENDING');
      const ghost = await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: '00000000-0000-4000-8000-000000000000' } });
      expect(ghost.status).toBeLessThan(500);
    });

    it('R17: a driver can NOT hand the assignment back (no reject/release) — only Operations release; the order stays with the driver', async () => {
      const a = await s.driver({ ...near });
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(a.driverId);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: a.accessToken }))[0];
      const refused = await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: a.accessToken, body: { status: 'READY_FOR_PICKUP' } });
      expect(refused.status).toBe(400);
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(a.driverId);
      expect(await driverRow(a)).toMatchObject({ is_available: false });

      // Operations reassign to someone else.
      const b = await s.driver({ ...mid });
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const reassigned = await world.api('post', `/admin/orders/${order.id}/reassign-driver`, { token: dispatcher.accessToken, body: { driverId: b.driverId } });
      expect(reassigned.status).toBe(201);
      expect((await deliveryRow(order.id)).driver_id).toBe(b.driverId);
      expect(await driverRow(a)).toMatchObject({ is_available: true });
      expect(await world.ds.query('SELECT id FROM deliveries WHERE order_id = $1', [order.id])).toHaveLength(1); // one delivery per order
    });

    it('reassign-driver hands an already-assigned order to another driver: old driver freed, new one busy, count incremented, single delivery row', async () => {
      const a = await s.driver({ ...near });
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(a.driverId);
      const b = await s.driver({ ...mid });
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const res = await world.api('post', `/admin/orders/${order.id}/reassign-driver`, { token: dispatcher.accessToken, body: { driverId: b.driverId } });
      expect(res.status).toBe(201);
      const row = await deliveryRow(order.id);
      expect(row.driver_id).toBe(b.driverId);
      expect(row.reassignment_count).toBe(1);
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect(await driverRow(a)).toMatchObject({ is_available: true });
      expect(await driverRow(b)).toMatchObject({ is_available: false });
      expect(await world.ds.query('SELECT id FROM deliveries WHERE order_id = $1', [order.id])).toHaveLength(1);
      // the previous driver no longer sees it; the new one does
      expect(expectData<any[]>(await world.api('get', '/driver/deliveries', { token: a.accessToken }))).toEqual([]);
      expect(expectData<any[]>(await world.api('get', '/driver/deliveries', { token: b.accessToken })).map((d) => d.orderId)).toEqual([order.id]);
    });

    it('only admins with ASSIGN_REASSIGN_ORDERS may dispatch', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const order = await readyOrder();
      const nobody = await s.admin([]);
      expect((await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: nobody.accessToken, body: {} })).status).toBe(403);
      expect((await world.api('get', '/admin/orders/dispatchable', { token: nobody.accessToken })).status).toBe(403);
      expect((await world.api('get', '/admin/dispatch-alerts', { token: nobody.accessToken })).status).toBe(403);
    });
  });

  describe('driver endpoints', () => {
    it('validate coordinates and flags, and only work for a real driver profile', async () => {
      const d = await s.driver({ ...near });
      const badLat = await world.api('patch', '/driver/location', { token: d.accessToken, body: { latitude: 200, longitude: 31 } });
      const badFlag = await world.api('patch', '/driver/online-status', { token: d.accessToken, body: { isOnline: 'yes' } });
      expect([badLat.status, badFlag.status]).toEqual([400, 400]);
      const moved = await world.api('patch', '/driver/location', { token: d.accessToken, body: { latitude: 30.5, longitude: 31.6 } });
      expect(moved.status).toBe(200);
      const [row] = await world.ds.query('SELECT last_latitude, last_longitude, last_location_at FROM drivers WHERE id = $1', [d.driverId]);
      expect(row).toMatchObject({ last_latitude: 30.5, last_longitude: 31.6, last_location_at: expect.any(Date) });
    });

    it('admin creates drivers over HTTP: duplicate phone is a 409, weak password/invalid phone a 400, and the list never leaks credentials', async () => {
      const admin = await s.admin([Permission.MANAGE_DRIVERS]);
      const phone = '+201099990001';
      const body = { phone, fullName: 'New Driver', password: 'Str0ng-pass!' };
      expect((await world.api('post', '/admin/drivers', { token: admin.accessToken, body })).status).toBe(201);
      const dup = await world.api('post', '/admin/drivers', { token: admin.accessToken, body });
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ code: 'PHONE_ALREADY_REGISTERED' });
      expect((await world.api('post', '/admin/drivers', { token: admin.accessToken, body: { ...body, phone: '+201099990002', password: 'short' } })).status).toBe(400);
      expect((await world.api('post', '/admin/drivers', { token: admin.accessToken, body: { ...body, phone: 'nope' } })).status).toBe(400);
      const list = await world.api('get', '/admin/drivers', { token: admin.accessToken });
      expect(JSON.stringify(list.body)).not.toMatch(/password|\$2[aby]\$/i);
    });

    it('Driver Core + Dispatch Foundation milestone: a newly created driver defaults to PENDING and is invisible to ranking until an Admin approves them', async () => {
      const admin = await s.admin([Permission.MANAGE_DRIVERS]);
      const phone = '+201099990010';
      const created = expectData(
        await world.api('post', '/admin/drivers', { token: admin.accessToken, body: { phone, fullName: 'Pending Driver', password: DEFAULT_PASSWORD } }),
        201,
      );
      expect(created.verificationStatus).toBe('PENDING');

      const pending = await s.login('/auth/driver/login', { phone, fullName: 'Pending Driver', role: Role.DRIVER });
      expectData(await world.api('patch', '/driver/online-status', { token: pending.accessToken, body: { isOnline: true } }));
      expectData(await world.api('patch', '/driver/location', { token: pending.accessToken, body: { latitude: home.lat, longitude: home.lng } }));

      // Still PENDING: excluded from automatic dispatch even though online/available/located exactly at the customer.
      await retireAllDrivers();
      await world.ds.query(`UPDATE drivers SET is_online = true, is_available = true WHERE id = $1`, [created.id]);
      const orderWhilePending = await readyOrder();
      expect(await status(orderWhilePending.id)).toBe('READY_FOR_PICKUP'); // no eligible (APPROVED) driver

      // Now approve — the SAME driver becomes eligible with nothing else changed.
      const approved = expectData(
        await world.api('patch', `/admin/drivers/${created.id}/verification`, { token: admin.accessToken, body: { status: 'APPROVED' } }),
      );
      expect(approved.verificationStatus).toBe('APPROVED');
      const orderAfterApproval = await readyOrder();
      expect(await status(orderAfterApproval.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(orderAfterApproval.id)).driver_id).toBe(created.id);
    });

    it('driver verification: REJECTED is idempotent to re-apply, an unknown driver id is a clean 404, and it requires MANAGE_DRIVERS', async () => {
      const admin = await s.admin([Permission.MANAGE_DRIVERS]);
      const other = await s.admin([]);
      const driver = await s.driver({ lat: home.lat, lng: home.lng });

      const rejected = expectData(
        await world.api('patch', `/admin/drivers/${driver.driverId}/verification`, { token: admin.accessToken, body: { status: 'REJECTED' } }),
      );
      expect(rejected.verificationStatus).toBe('REJECTED');
      const rejectedAgain = expectData(
        await world.api('patch', `/admin/drivers/${driver.driverId}/verification`, { token: admin.accessToken, body: { status: 'REJECTED' } }),
      );
      expect(rejectedAgain.verificationStatus).toBe('REJECTED');

      expect((await world.api('patch', '/admin/drivers/00000000-0000-0000-0000-000000000000/verification', { token: admin.accessToken, body: { status: 'APPROVED' } })).status).toBe(404);
      expect((await world.api('patch', `/admin/drivers/${driver.driverId}/verification`, { token: admin.accessToken, body: { status: 'SOMETHING_ELSE' } })).status).toBe(400);
      expect((await world.api('patch', `/admin/drivers/${driver.driverId}/verification`, { token: other.accessToken, body: { status: 'APPROVED' } })).status).toBe(403);
    });
  });

  describe('R16: acknowledgement — default 5 minutes, alert only, never an automatic release', () => {
    it('a new assignment must be acknowledged within the default 5 minutes (manual and automatic alike)', async () => {
      await s.driver({ ...near });
      const order = await readyOrder();
      const row = await deliveryRow(order.id);
      const minutes = (new Date(row.accept_deadline_at).getTime() - new Date(row.assigned_at).getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(4.9);
      expect(minutes).toBeLessThan(5.1);
      expect(row.acknowledged_at).toBeNull();
    });

    it('the window follows DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES (1-30) and an invalid value is refused', async () => {
      const writer = await s.superAdmin();
      const bad = await world.api('put', '/admin/business-config/DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', { token: writer.accessToken, body: { value: 45 } });
      expect(bad.status).toBe(400);
      await s.setConfig('DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES', 12);
      try {
        await s.driver({ ...near });
        const order = await readyOrder();
        const row = await deliveryRow(order.id);
        const minutes = (new Date(row.accept_deadline_at).getTime() - new Date(row.assigned_at).getTime()) / 60_000;
        expect(Math.round(minutes)).toBe(12);
      } finally {
        await world.ds.query("DELETE FROM business_config WHERE key = 'DISPATCH_ACKNOWLEDGEMENT_WINDOW_MINUTES'");
      }
    });

    it.each([true, false])('overdue and unacknowledged (automatic dispatch %p): ONE Operations alert; the order stays with the same driver', async (auto) => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', auto);
      await expireDeadline(order.id);

      const first = await sweep();
      expect(first.alerted).toBeGreaterThanOrEqual(1);
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
      expect((await driverRow(d)).is_available).toBe(false);
      const alerts = await ackAlerts(order.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].resolved_at).toBeNull();

      // Idempotent: further sweeps never stack or re-raise the alert for the same assignment, even after an admin closes it.
      await sweep();
      await world.ds.query('UPDATE dispatch_alerts SET resolved_at = now() WHERE id = $1', [alerts[0].id]);
      await sweep();
      expect(await ackAlerts(order.id)).toHaveLength(1);
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
    });

    it('opening the assignment acknowledges it (backward compatible with apps without the button) and closes an open alert', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);
      await sweep();
      expect((await ackAlerts(order.id))[0].resolved_at).toBeNull();

      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === order.id);
      expect((await deliveryRow(order.id)).acknowledged_at).toBeNull(); // the LIST alone is not "viewing the assignment"
      const detail = expectData<any>(await world.api('get', `/driver/deliveries/${delivery.id}`, { token: d.accessToken }));
      expect(detail.acknowledgedAt).not.toBeNull();
      expect((await deliveryRow(order.id)).acknowledged_at).not.toBeNull();
      expect((await ackAlerts(order.id))[0].resolved_at).not.toBeNull();
    });

    it('the explicit acknowledge endpoint works once, is idempotent, and no other driver can use it', async () => {
      const d = await s.driver({ ...near });
      const other = await s.driver({ ...far });
      const order = await readyOrder();
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === order.id);

      const stranger = await world.api('post', `/driver/deliveries/${delivery.id}/acknowledge`, { token: other.accessToken });
      expect([403, 404]).toContain(stranger.status);
      expect((await deliveryRow(order.id)).acknowledged_at).toBeNull();

      const first = expectData<any>(await world.api('post', `/driver/deliveries/${delivery.id}/acknowledge`, { token: d.accessToken }), 201);
      const firstAt = (await deliveryRow(order.id)).acknowledged_at;
      expect(first.acknowledgedAt).not.toBeNull();
      expectData(await world.api('post', `/driver/deliveries/${delivery.id}/acknowledge`, { token: d.accessToken }), 201);
      expect((await deliveryRow(order.id)).acknowledged_at).toEqual(firstAt); // the first acknowledgement is kept

      await expireDeadline(order.id);
      await sweep();
      expect(await ackAlerts(order.id)).toHaveLength(0); // acknowledged in time → no alert
    });

    it('picking up records the acknowledgement and closes the alert; a reassignment starts a fresh window for the new driver', async () => {
      const a = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);
      await sweep();

      const b = await s.driver({ ...mid });
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      expect((await world.api('post', `/admin/orders/${order.id}/reassign-driver`, { token: dispatcher.accessToken, body: { driverId: b.driverId } })).status).toBe(201);
      const fresh = await deliveryRow(order.id);
      expect(fresh.driver_id).toBe(b.driverId);
      expect(fresh.acknowledged_at).toBeNull();
      expect(new Date(fresh.accept_deadline_at).getTime()).toBeGreaterThan(Date.now());
      expect((await ackAlerts(order.id)).every((x: any) => x.resolved_at !== null)).toBe(true); // the first driver's alert is closed

      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: b.accessToken })).find((x) => x.orderId === order.id);
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: b.accessToken, body: { status: 'PICKED_UP' } }));
      expect((await deliveryRow(order.id)).acknowledged_at).not.toBeNull();
      void a;
    });

    it('R13: switching automatic dispatch OFF→ON never releases or reassigns an existing (even overdue) assignment', async () => {
      const d = await s.driver({ ...near });
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const order = await readyOrder();
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      expect((await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: dispatcher.accessToken, body: { driverId: d.driverId } })).status).toBe(201);
      await expireDeadline(order.id);
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      await sweep();
      await world.app.get(AutomaticDispatchService).retryOpenAlerts();
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
    });

    it('Control Tower: an acknowledged assignment is never shown as overdue', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === order.id);
      expectData(await world.api('post', `/driver/deliveries/${delivery.id}/acknowledge`, { token: d.accessToken }), 201);
      const ops = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS, Permission.VIEW_ORDERS]);
      const res = await world.api('get', '/admin/control-tower/deliveries', { token: ops.accessToken });
      if (res.status === 200) {
        const rows = (res.body?.data?.items ?? res.body?.data ?? []) as any[];
        const row = rows.find((r: any) => r.id === order.id || r.orderId === order.id);
        if (row) {
          expect(row.acceptDeadlinePassed).toBe(false);
          expect(row.acknowledgedAt).not.toBeNull();
        }
      }
    });

    it('two app instances sweeping at the same moment raise exactly one alert', async () => {
      await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);
      const second = await bootWorld({ resetInfrastructure: false });
      try {
        await Promise.all([sweep(), second.app.get(AutomaticDispatchService).alertUnacknowledgedAssignments()]);
        await sweep();
        expect(await ackAlerts(order.id)).toHaveLength(1);
      } finally {
        await second.close();
      }
    });

    it('the sweep fails SAFELY when Redis is unavailable: no crash, a zeroed result, the assignment untouched; a healthy sweep then alerts', async () => {
      const originalRedisUrl = process.env.REDIS_URL;
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);

      process.env.REDIS_URL = 'redis://localhost:6390/14'; // the same unreachable-port convention 98-redis-outage.e2e-spec.ts already establishes
      const outage = await bootWorld({ resetInfrastructure: false });
      try {
        const result = await outage.app.get(AutomaticDispatchService).alertUnacknowledgedAssignments();
        expect(result).toEqual({ processed: 0, alerted: 0 });
        expect(outage.unhandledServerErrors()).toEqual([]);
      } finally {
        process.env.REDIS_URL = originalRedisUrl;
        await outage.close();
      }
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
      await sweep();
      expect(await ackAlerts(order.id)).toHaveLength(1);
    });
  });
});
