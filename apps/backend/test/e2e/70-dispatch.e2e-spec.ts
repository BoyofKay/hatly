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
import { QueryFailedError } from 'typeorm';

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
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: st } }));
    }
  };
  /** Takes every existing driver out of the running so a test controls exactly who is eligible. */
  const retireAllDrivers = () => world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
  // Shared by both the single-instance timeout-reassignment tests below and the Dispatch Hardening
  // describe block further down (multi-instance/race/outage scenarios) — hoisted to file scope so
  // both can reuse the exact same helpers rather than each defining their own.
  const expireDeadline = (orderId: string) =>
    world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [orderId]);
  const sweep = () => world.app.get(AutomaticDispatchService).reassignTimedOutDeliveries();
  const alertsFor = (orderId: string) => world.ds.query('SELECT * FROM dispatch_alerts WHERE order_id = $1', [orderId]);

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
      await world.ds.query('UPDATE drivers SET vehicle_type_id = $2 WHERE id = $1', [bike.driverId, bicycleType.id]);
      const first = await readyOrder();
      expect(await status(first.id)).toBe('READY_FOR_PICKUP'); // fail closed: no limit configured
      await s.setConfig('MAX_BICYCLE_PICKUP_DISTANCE_METERS', 10);
      const tooFar = await readyOrder();
      expect(await status(tooFar.id)).toBe('READY_FOR_PICKUP');
      await s.setConfig('MAX_BICYCLE_PICKUP_DISTANCE_METERS', 5000);
      const ok = await readyOrder();
      expect((await deliveryRow(ok.id)).driver_id).toBe(bike.driverId);
      await world.ds.query('DELETE FROM dispatch_alerts');
      await world.ds.query('UPDATE drivers SET vehicle_type_id = NULL WHERE id = $1', [bike.driverId]);
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

    it('a driver who rejects the assignment frees themselves and the order returns to READY_FOR_PICKUP; the order can then be assigned to someone else', async () => {
      const a = await s.driver({ ...near });
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(a.driverId);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: a.accessToken }))[0];
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: a.accessToken, body: { status: 'READY_FOR_PICKUP' } }));
      expect(await status(order.id)).toBe('READY_FOR_PICKUP');
      expect(await driverRow(a)).toMatchObject({ is_available: true });

      const b = await s.driver({ ...mid });
      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const reassigned = await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: dispatcher.accessToken, body: { driverId: b.driverId } });
      expect(reassigned.status).toBe(201);
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(b.driverId);
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

  describe('timeout-driven automatic reassignment', () => {
    // The real acceptDeadlineAt window (DeliveryAssignmentService, unchanged) is 30s — tests never
    // wait for it: they fast-forward it into the past directly (same convention this whole file
    // already uses for driver online/location state) and invoke the real sweep directly instead of
    // waiting for its periodic timer, which is disabled under NODE_ENV=test.
    // (expireDeadline/sweep/alertsFor are hoisted to file scope — shared with the Dispatch Hardening
    // describe block below.)

    it('(a) an assigned driver who times out is released and reassigned, with a fresh acceptDeadlineAt', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      const before = await deliveryRow(order.id);
      expect(before.driver_id).toBe(d.driverId);

      await expireDeadline(order.id);
      const result = await sweep();

      expect(result).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER'); // released then immediately reassigned — never left dangling
      const after = await deliveryRow(order.id);
      expect(after.driver_id).toBe(d.driverId); // the only eligible driver — legitimately reassigned to themselves
      expect(new Date(after.accept_deadline_at).getTime()).toBeGreaterThan(Date.now()); // a FRESH deadline, not the stale one
      expect((await driverRow(d)).is_available).toBe(false); // busy again under the new assignment, not left "available" and assigned at once
    });

    it('(b) the timed-out driver is NOT reused once actually ineligible (went offline) — a different eligible driver is picked instead, never the stale one', async () => {
      const first = await s.driver({ ...near });
      const second = await s.driver({ ...far });
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(first.driverId); // nearest wins the original assignment

      await expireDeadline(order.id);
      // Simulates the real-world reason a driver times out without acting: their app is offline.
      await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [first.driverId]);
      const result = await sweep();

      expect(result).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
      const after = await deliveryRow(order.id);
      expect(after.driver_id).toBe(second.driverId);
      expect(after.driver_id).not.toBe(first.driverId);
      expect((await driverRow(first)).is_available).toBe(true); // freed, even though not reused
    });

    it('(c) no eligible driver at all: the order stays retryable (READY_FOR_PICKUP) and the existing DispatchAlert is raised — then a later retry succeeds once a driver is available again', async () => {
      const onlyDriver = await s.driver({ ...near });
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(onlyDriver.driverId);

      await expireDeadline(order.id);
      await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [onlyDriver.driverId]);
      const result = await sweep();

      expect(result).toMatchObject({ processed: 1, reassigned: 0, alerted: 1 });
      expect(await status(order.id)).toBe('READY_FOR_PICKUP'); // never stuck at ASSIGNED_TO_DRIVER with no real driver
      const alerts = await alertsFor(order.id);
      expect(alerts).toHaveLength(1);
      expect(alerts[0].reason).toBe('NO_ELIGIBLE_DRIVER');
      expect(alerts[0].resolved_at).toBeNull();

      // Retryable: the SAME existing manual Admin dispatch primitive (unaffected by any of this) can
      // still assign it once a driver becomes available — this milestone invented no new recovery path.
      await world.ds.query('UPDATE drivers SET is_online = true, is_available = true WHERE id = $1', [onlyDriver.driverId]);
      const admin = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: admin.accessToken, body: {} }), 201);
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
    });

    it('(d) an already-progressed delivery (driver already picked up) is never released or reassigned, even with a stale acceptDeadlineAt', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === order.id);
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status: 'PICKED_UP' } }));
      expect(await status(order.id)).toBe('PICKED_UP');

      // The deadline column is stale (nothing ever clears it once past PICKED_UP) — CONFIRMED this
      // alone must never be read as "still needs reassigning": the query/re-check is keyed on the
      // ORDER still being exactly ASSIGNED_TO_DRIVER, which it no longer is.
      await expireDeadline(order.id);
      const result = await sweep();

      expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 }); // excluded by the query itself — PICKED_UP never even seen as a candidate
      expect(await status(order.id)).toBe('PICKED_UP');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
      expect(await alertsFor(order.id)).toEqual([]);
    });

    it('(e) repeated timeout processing is safe: running the sweep again immediately after is a clean no-op, never a double reassignment or a duplicate alert', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);

      const first = await sweep();
      expect(first).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
      const afterFirst = await deliveryRow(order.id);

      const second = await sweep();
      expect(second).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 }); // the fresh deadline from the first sweep is no longer expired
      const afterSecond = await deliveryRow(order.id);
      expect(afterSecond.driver_id).toBe(afterFirst.driver_id);
      expect(afterSecond.accept_deadline_at).toEqual(afterFirst.accept_deadline_at); // untouched — not reassigned again
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');

      // Same idempotency check for the no-eligible-driver/alert path: re-running after an alert was
      // already raised must never raise a second one for the same still-unresolved order.
      await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [d.driverId]);
      await expireDeadline(order.id);
      await sweep(); // driver offline now → this order alerts instead of reassigning
      const afterAlertOnce = await alertsFor(order.id);
      await sweep(); // order is now READY_FOR_PICKUP, not ASSIGNED_TO_DRIVER — excluded by the query itself
      const afterAlertTwice = await alertsFor(order.id);
      expect(afterAlertTwice).toHaveLength(afterAlertOnce.length);
    });

    it('(f) manual Admin assignment/reassignment is completely unaffected by an unrelated timed-out delivery elsewhere', async () => {
      const staleDriver = await s.driver({ ...far });
      const staleOrder = await readyOrder();
      await expireDeadline(staleOrder.id); // left un-swept on purpose — simulates the sweep not having run yet

      // A second, unrelated order dispatched manually by an Admin — must behave exactly as the
      // existing (unmodified) "manual dispatch by an admin" tests already prove, regardless of the
      // stale row sitting in the same table.
      const manualDriver = await s.driver({ ...near });
      await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [manualDriver.driverId]); // not auto-picked
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const manualOrder = await readyOrder();
      expect(await status(manualOrder.id)).toBe('READY_FOR_PICKUP'); // automatic dispatch is off

      await world.ds.query('UPDATE drivers SET is_online = true WHERE id = $1', [manualDriver.driverId]);
      const admin = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      expectData(await world.api('post', `/admin/orders/${manualOrder.id}/assign-driver`, { token: admin.accessToken, body: { driverId: manualDriver.driverId } }), 201);

      expect(await status(manualOrder.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(manualOrder.id)).driver_id).toBe(manualDriver.driverId);
      // The stale, unrelated order is still exactly as it was — the manual flow never touched it.
      expect(await status(staleOrder.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(staleOrder.id)).driver_id).toBe(staleDriver.driverId);

      // Cleanup: staleOrder's accept_deadline_at is still (deliberately) expired — proving the point
      // above. Left as-is it would keep matching every LATER test's own sweep() calls in this file
      // (the query is global, not scoped per test). Pushed into the future here, same as a real fresh
      // assignment would be — this test's own cleanup, not a change to what was under test.
      await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() + INTERVAL '1 hour' WHERE order_id = $1", [staleOrder.id]);
    });
  });

  describe('Dispatch Hardening milestone: multi-instance safety, races, and failure recovery', () => {
    it('AUTOMATIC_DISPATCH_ENABLED = false: the sweep itself does nothing at all to a real expired assignment (same rule as attemptAutomaticDispatch, now proven for the sweep specifically)', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      await expireDeadline(order.id);
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);

      const result = await sweep();
      expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 }); // returns before even acquiring the lock or querying
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER'); // untouched — the stale deadline is never even looked at
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);

      // Cleanup: this delivery's accept_deadline_at is still (deliberately) stale/expired in the DB —
      // proving the point above. Left as-is it would still match every LATER test's own sweep() calls
      // in this file (the query is global, not scoped per test) and skew their processed/alerted
      // counts. Pushed into the future here, exactly as a real fresh assignment would be — not a
      // change to the thing under test, just this test cleaning up after itself.
      await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() + INTERVAL '1 hour' WHERE order_id = $1", [order.id]);
    });

    it('TRUE multi-instance contention: two independent, concurrently-running app instances racing the SAME sweep at the same moment — exactly one does the work, the other is a clean no-op, never a double reassignment', async () => {
      const second = await bootWorld({ resetInfrastructure: false }); // a second real Nest app, same DB/Redis as `world`
      try {
        const d = await s.driver({ ...near });
        const order = await readyOrder();
        await expireDeadline(order.id);

        const [a, b] = await Promise.all([sweep(), second.app.get(AutomaticDispatchService).reassignTimedOutDeliveries()]);

        // Whichever instance actually processed the expired delivery — by winning the whole-sweep Redis
        // lock, or by winning the per-delivery row lock first — the OTHER instance's own attempt is a
        // clean, empty no-op. Never both processing the same delivery.
        const results = [a, b];
        expect(results.filter((r) => r.processed > 0)).toHaveLength(1);
        expect(results.filter((r) => r.processed === 0)).toHaveLength(1);
        expect(a.reassigned + b.reassigned).toBe(1);
        expect(a.alerted + b.alerted).toBe(0);

        expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER'); // released then immediately reassigned by whichever instance won
        expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId); // the only eligible driver — legitimately reassigned to themselves
        expect(await world.ds.query('SELECT id FROM deliveries WHERE order_id = $1', [order.id])).toHaveLength(1); // one delivery row, never duplicated
      } finally {
        await second.close();
      }
    });

    it('restart-recovery framing: the instance whose HTTP request originally created the expired assignment can crash completely — a different, unrelated running instance still discovers and safely reassigns it later (recovery depends on the database, never on any single process staying alive)', async () => {
      const crashed = await bootWorld({ resetInfrastructure: false });
      const crashedScenario = new Scenario(crashed);
      let orderId: string;
      let driverId: string;
      try {
        const d = await crashedScenario.driver({ ...near });
        driverId = d.driverId;
        const customer = await crashedScenario.customer();
        const order = await crashedScenario.simpleOrder(customer, vendor, product.id, home);
        await crashedScenario.vendorPrepares(vendor, order.id);
        orderId = order.id;
        expect((await deliveryRow(orderId)).driver_id).toBe(driverId); // assigned by the soon-to-crash instance's own in-process call
        await expireDeadline(orderId);
      } finally {
        await crashed.close(); // gone for good — its own periodic sweep (disabled under NODE_ENV=test anyway) will never run
      }

      // A wholly separate, still-running instance (the file's main `world`) recovers it later.
      const result = await sweep();
      expect(result).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
      expect(await status(orderId)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(orderId)).driver_id).toBe(driverId); // only eligible driver — reassigned to themselves, correctly
    });

    it('the sweep fails SAFELY when Redis itself is unavailable: no crash, a zeroed no-op result, and the real expired assignment is left completely untouched for a later, healthy sweep to pick up', async () => {
      const originalRedisUrl = process.env.REDIS_URL;
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);

      process.env.REDIS_URL = 'redis://localhost:6390/14'; // the same unreachable-port convention 98-redis-outage.e2e-spec.ts already establishes
      const outage = await bootWorld({ resetInfrastructure: false });
      try {
        const result = await outage.app.get(AutomaticDispatchService).reassignTimedOutDeliveries();
        expect(result).toEqual({ processed: 0, reassigned: 0, alerted: 0, skipped: 0 }); // fails closed at lock acquisition — never even reaches the query
        expect(outage.unhandledServerErrors()).toEqual([]); // logged via the existing EXTERNAL_PROVIDER_FAILED event, never an unhandled crash
      } finally {
        process.env.REDIS_URL = originalRedisUrl;
        await outage.close();
      }

      // Completely untouched by the failed attempt — a later, healthy sweep recovers it normally.
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
      const recovered = await sweep();
      expect(recovered).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
    });

    it('a push-notification failure during reassignment never corrupts authoritative state: the delivery is still correctly reassigned even when the underlying push provider throws', async () => {
      boundary.pushMode = 'throw';
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      await expireDeadline(order.id);

      const result = await sweep();

      expect(result).toMatchObject({ processed: 1, reassigned: 1, alerted: 0 });
      expect(await status(order.id)).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
      expect(world.unhandledServerErrors()).toEqual([]); // PushNotificationService swallows the provider's own throw — never surfaces as an unhandled exception
    });

    it('TRUE concurrent race: an Admin manually reassigning at the exact moment the timeout sweep processes the SAME expired delivery — whichever side wins, the result is a single, self-consistent authoritative state, never a corrupted double-assignment', async () => {
      const original = await s.driver({ ...near });
      const other = await s.driver({ ...mid });
      const order = await readyOrder();
      expect((await deliveryRow(order.id)).driver_id).toBe(original.driverId);
      await expireDeadline(order.id);

      const dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS]);
      const [adminRes] = await Promise.all([
        world.api('post', `/admin/orders/${order.id}/reassign-driver`, { token: dispatcher.accessToken, body: { driverId: other.driverId } }),
        sweep(),
      ]);

      // Whichever ran first won the order's row lock; the loser's own release attempt is either a
      // clean 4xx (admin lost) or a benign internal skip (sweep lost) — never a 5xx, and never both
      // sides applying an inconsistent, partially-overlapping change.
      expect(adminRes.status).toBeLessThan(500);
      expect(world.unhandledServerErrors()).toEqual([]);

      // Self-consistency invariants that must hold regardless of which side actually won:
      const finalStatus = await status(order.id);
      expect(['ASSIGNED_TO_DRIVER', 'READY_FOR_PICKUP']).toContain(finalStatus);
      const rows = await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1', [order.id]);
      expect(rows).toHaveLength(1); // exactly one delivery row for this order, never duplicated
      if (finalStatus === 'ASSIGNED_TO_DRIVER') {
        const finalDriverId = rows[0].driver_id;
        expect([original.driverId, other.driverId]).toContain(finalDriverId);
        // The driver actually holding the delivery is busy; the OTHER named driver in this race is free
        // — never both marked busy, never the assigned one marked free.
        const busyDriverId = finalDriverId;
        const freeDriverId = finalDriverId === original.driverId ? other.driverId : original.driverId;
        expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [busyDriverId]))[0].is_available).toBe(false);
        expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [freeDriverId]))[0].is_available).toBe(true);
      } else {
        // The rare "sweep alerted, nobody currently assigned" outcome is only reachable if ranking
        // found no candidate — impossible here (both drivers are eligible) — so this branch is not
        // expected to run, but is handled rather than silently assumed impossible.
        expect(rows[0].driver_id).toBeNull();
      }
    });

    it('TRUE concurrent race: a driver progressing their OWN delivery to PICKED_UP at the exact moment the timeout sweep processes it — whichever side wins, the delivery is never released AND progressed at once', async () => {
      const d = await s.driver({ ...near });
      const order = await readyOrder();
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === order.id);
      await expireDeadline(order.id);

      // Two genuinely independent transactions can lock the SAME Order/Delivery rows in opposite
      // orders (the driver's own status-update path vs. the sweep's release-then-reassign path) —
      // Postgres itself can detect that as a deadlock and abort ONE side. That abort is a clean
      // ROLLBACK (no partial/corrupted state ever persists) and is exactly the failure mode
      // `onModuleInit`'s own `.catch()` wrapper around the REAL periodic sweep already exists to
      // absorb (see that method's doc comment) — self-healing on the very next tick. Every test in
      // this file calls `reassignTimedOutDeliveries()` directly (the real timer is disabled under
      // NODE_ENV=test), bypassing that wrapper, so this test reproduces it explicitly instead of
      // treating a real, already-anticipated production outcome as a test failure.
      const driverCall = world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status: 'PICKED_UP' } });
      const sweepCall = sweep().catch((error) => {
        if (error instanceof QueryFailedError && /deadlock detected/i.test((error as Error).message)) return 'deadlock' as const;
        throw error;
      });
      const [driverRes, sweepOutcome] = await Promise.all([driverCall, sweepCall]);

      expect(driverRes.status).toBeLessThan(500);
      expect(world.unhandledServerErrors()).toEqual([]);

      if (sweepOutcome === 'deadlock') {
        // Rolled back cleanly by Postgres itself — self-heals via a fresh, independent sweep attempt,
        // exactly as the real next periodic tick would.
        await sweep();
      }

      const finalStatus = await status(order.id);
      if (finalStatus === 'PICKED_UP') {
        // The driver's own progression won: the sweep's re-check (order no longer ASSIGNED_TO_DRIVER)
        // must have made it a clean skip, exactly like the sequential version of this same scenario
        // (test (d) above) already proves — never reassigned out from under the progressing driver.
        expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
        expect(driverRes.status).toBe(200);
      } else {
        // The sweep won: the order was released and (being the only eligible driver) legitimately
        // reassigned back to the SAME driver with a fresh deadline — the driver's own PICKED_UP call
        // then either raced onto that same fresh assignment (200) or was correctly refused because it
        // no longer matched the delivery's current state at the instant it ran (a clean 4xx) — either
        // way, never a corrupted mix of "released" and "picked up" at once.
        expect(finalStatus).toBe('ASSIGNED_TO_DRIVER');
        expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
        expect([200, 400, 404, 409]).toContain(driverRes.status);
      }
    });
  });
});
