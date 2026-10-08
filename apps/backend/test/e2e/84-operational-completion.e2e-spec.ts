/**
 * Operational Completion milestone — over real HTTP against real PostgreSQL/Redis:
 *  - driver-row writes (location heartbeat, online toggle, verification, commission rate, vehicle type) never write back a
 *    stale `is_available` / `is_online` (lost-update race with assignment);
 *  - admin vehicle-type management (MANAGE_DRIVERS) and its interaction with dispatch eligibility;
 *  - released orders are unmistakable in the Control Tower (no automatic retry exists — PD-008 open question);
 *  - pickup orders are never dispatched (invariant retained).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { DriverAuthorizationService } from '../../src/modules/delivery/driver-authorization.service';
import { DriversService } from '../../src/modules/delivery/drivers.service';
import { Driver } from '../../src/modules/delivery/entities/driver.entity';
import { AutomaticDispatchService } from '../../src/modules/delivery/automatic-dispatch.service';

describe('E2E — operational completion', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let vendor: VendorFixture;
  let product: { id: string };
  let superAdmin: Actor;
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };
  const mid = { lat: 30.4212, lng: 31.5712 };

  const driverRow = async (d: { driverId: string }) =>
    (await world.ds.query('SELECT is_available, is_online, verification_status, vehicle_type_id, commission_rate_basis_points FROM drivers WHERE id = $1', [d.driverId]))[0];
  const readyOrder = async () => {
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    return order as { id: string; orderNumber: string };
  };
  /** The driver row exactly as it was BEFORE `mutate` committed — what a concurrent request read a moment earlier. */
  const staleSnapshot = async (d: DriverFixture) => world.ds.getRepository(Driver).findOneOrFail({ where: { id: d.driverId } });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Ops Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    superAdmin = await s.superAdmin();
  });
  beforeEach(async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('driver-row writes never resurrect a stale availability (lost-update race with assignment)', () => {
    /** Assigns `d` to a fresh order while every driver read made by `seam` returns the pre-assignment row. */
    async function assignedWithStaleRead(d: DriverFixture, seam: () => jest.SpyInstance) {
      const stale = await staleSnapshot(d); // is_available = true
      const order = await readyOrder();
      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: d.driverId } }), 201);
      expect((await driverRow(d)).is_available).toBe(false);
      seam().mockResolvedValue(stale);
      return order;
    }

    it('a location heartbeat that read the driver before the assignment keeps the driver BUSY', async () => {
      const d = await s.driver({ ...near });
      await assignedWithStaleRead(d, () => jest.spyOn(world.app.get(DriverAuthorizationService), 'getDriverForUser'));
      expectData(await world.api('patch', '/driver/location', { token: d.accessToken, body: { latitude: 30.4213, longitude: 31.5613 } }));
      expect(await driverRow(d)).toMatchObject({ is_available: false, is_online: true });
    });

    it('an online toggle that read the driver before the assignment keeps the driver BUSY', async () => {
      const d = await s.driver({ ...near });
      await assignedWithStaleRead(d, () => jest.spyOn(world.app.get(DriverAuthorizationService), 'getDriverForUser'));
      expectData(await world.api('patch', '/driver/online-status', { token: d.accessToken, body: { isOnline: true } }));
      expect((await driverRow(d)).is_available).toBe(false);
    });

    it('an admin verification change that read the driver before the assignment keeps the driver BUSY', async () => {
      const d = await s.driver({ ...near });
      const repo = (world.app.get(DriversService) as any).driversRepository;
      await assignedWithStaleRead(d, () => jest.spyOn(repo, 'findOne'));
      expectData(await world.api('patch', `/admin/drivers/${d.driverId}/verification`, { token: superAdmin.accessToken, body: { status: 'APPROVED' } }));
      expect((await driverRow(d)).is_available).toBe(false);
    });

    it('a commission-rate change that read the driver before the assignment keeps the driver BUSY (rate itself saved)', async () => {
      const d = await s.driver({ ...near });
      const stale = await staleSnapshot(d);
      const order = await readyOrder();
      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: d.driverId } }), 201);
      const repo = world.ds.getRepository(Driver);
      const realFindOne = repo.findOne.bind(repo);
      jest.spyOn(world.ds.getRepository(Driver).constructor.prototype, 'findOne').mockImplementation(async function (this: any, opts: any) {
        return opts?.where?.id === d.driverId ? stale : realFindOne(opts);
      });
      expectData(await world.api('patch', `/admin/drivers/${d.driverId}/commission-rate`, { token: superAdmin.accessToken, body: { commissionRateBasisPoints: 1234 } }));
      jest.restoreAllMocks();
      expect(await driverRow(d)).toMatchObject({ is_available: false, commission_rate_basis_points: 1234 });
    });
  });

  describe('released orders are unmistakable in the Control Tower (no automatic retry exists — PD-008 open question)', () => {
    const summary = async () => expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: superAdmin.accessToken })).attention;
    const rowOf = async (orderNumber: string, query = '') =>
      expectData<any[]>(await world.api('get', `/admin/control-tower/deliveries?search=${orderNumber}${query}`, { token: superAdmin.accessToken }))[0];
    const assignTo = async (d: DriverFixture) => {
      const order = await readyOrder();
      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: d.driverId } }), 201);
      return order;
    };

    it('a driver hand-back: flagged released (by DRIVER, with when), counted as awaiting MANUAL assignment, listed by ?releasedOnly=true', async () => {
      const before = (await summary()).releasedAwaitingManualAssignment;
      const d = await s.driver({ ...near });
      const order = await assignTo(d);
      const untouched = await readyOrder(); // waiting for its FIRST assignment — never "released"
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d.accessToken })).find((x) => x.orderId === order.id);
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status: 'READY_FOR_PICKUP' } }));

      const row = await rowOf(order.orderNumber);
      expect(row).toMatchObject({ status: 'READY_FOR_PICKUP', driver: null, openDispatchAlert: null, released: { byRole: 'DRIVER', at: expect.any(String) } });
      expect((await rowOf(untouched.orderNumber)).released).toBeNull();
      expect((await summary()).releasedAwaitingManualAssignment).toBe(before + 1);
      const releasedOnly = expectData<any[]>(await world.api('get', '/admin/control-tower/deliveries?releasedOnly=true&limit=100', { token: superAdmin.accessToken }));
      expect(releasedOnly.map((r) => r.orderId)).toContain(order.id);
      expect(releasedOnly.map((r) => r.orderId)).not.toContain(untouched.id);
      expect(releasedOnly.every((r) => r.released !== null)).toBe(true);

      // the manual assignment that resolves it clears the flag and the count
      const d2 = await s.driver({ ...near });
      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: d2.driverId } }), 201);
      expect((await rowOf(order.orderNumber)).released).toBeNull();
      expect((await summary()).releasedAwaitingManualAssignment).toBe(before);
    });

    it('a timeout release with no eligible driver: flagged released (by the system), but carried by its open alert — not double-counted', async () => {
      const d = await s.driver({ ...near });
      const order = await assignTo(d);
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true); // the timeout sweep only runs with automatic dispatch on
      expectData(await world.api('patch', '/driver/online-status', { token: d.accessToken, body: { isOnline: false } }));
      await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [order.id]);
      const before = (await summary()).releasedAwaitingManualAssignment;

      await world.app.get(AutomaticDispatchService).reassignTimedOutDeliveries();

      const row = await rowOf(order.orderNumber);
      expect(row).toMatchObject({ status: 'READY_FOR_PICKUP', released: { byRole: 'ADMIN' }, openDispatchAlert: { reason: 'NO_ELIGIBLE_DRIVER' } });
      expect((await summary()).releasedAwaitingManualAssignment).toBe(before);
    });

    it('releasedOnly is validated', async () => {
      const res = await world.api('get', '/admin/control-tower/deliveries?releasedOnly=maybe', { token: superAdmin.accessToken });
      expect(res.status).toBe(400);
    });
  });

  describe('admin vehicle-type management (MANAGE_DRIVERS) and dispatch eligibility', () => {
    let driverManager: Actor; // MANAGE_DRIVERS only — NOT MANAGE_VEHICLE_TYPES
    let orderViewer: Actor; // no MANAGE_DRIVERS
    let motorbike: { id: string };
    let bicycle: { id: string };
    let retired: { id: string };
    const setVehicle = (actor: Actor | null, driverId: string, body: unknown) =>
      world.api('patch', `/admin/drivers/${driverId}/vehicle-type`, { token: actor?.accessToken, body });
    const errCode = (res: any) => res.body?.error?.details?.code;

    beforeAll(async () => {
      driverManager = await s.admin([Permission.MANAGE_DRIVERS], 'Driver Manager');
      orderViewer = await s.admin([Permission.VIEW_ORDERS], 'Order Viewer');
      const create = async (body: object) =>
        expectData<any>(await world.api('post', '/admin/vehicle-types', { token: superAdmin.accessToken, body }), 201);
      motorbike = await create({ name: 'Ops Motorbike', maxActiveDeliveries: 2 });
      bicycle = await create({ name: 'Ops Bicycle', maxActiveDeliveries: 1, isBicycle: true });
      retired = await create({ name: 'Ops Retired', maxActiveDeliveries: 1 });
      expectData(await world.api('patch', `/admin/vehicle-types/${retired.id}`, { token: superAdmin.accessToken, body: { isActive: false } }));
    });

    it('a driver manager (MANAGE_DRIVERS, without MANAGE_VEHICLE_TYPES) lists the ACTIVE types and sets / changes / clears a driver’s type', async () => {
      const d = await s.driver({ ...near });
      const types = expectData<any[]>(await world.api('get', '/admin/drivers/vehicle-types', { token: driverManager.accessToken }));
      expect(types.map((t) => t.id)).toEqual(expect.arrayContaining([motorbike.id, bicycle.id]));
      expect(types.map((t) => t.id)).not.toContain(retired.id);
      expect(types.find((t) => t.id === bicycle.id)).toMatchObject({ name: 'Ops Bicycle', isBicycle: true });
      expect((await world.api('get', '/admin/vehicle-types', { token: driverManager.accessToken })).status).toBe(403); // the catalog itself stays MANAGE_VEHICLE_TYPES

      const set = expectData<any>(await setVehicle(driverManager, d.driverId, { vehicleTypeId: motorbike.id }));
      expect(set).toMatchObject({ id: d.driverId, vehicleTypeId: motorbike.id, vehicleTypeName: 'Ops Motorbike' });
      expectData(await setVehicle(driverManager, d.driverId, { vehicleTypeId: bicycle.id }));
      expect((await driverRow(d)).vehicle_type_id).toBe(bicycle.id);
      const cleared = expectData<any>(await setVehicle(driverManager, d.driverId, { vehicleTypeId: null }));
      expect(cleared).toMatchObject({ vehicleTypeId: null, vehicleTypeName: null });
      const listed = expectData<any[]>(await world.api('get', '/admin/drivers', { token: driverManager.accessToken })).find((x) => x.id === d.driverId);
      expect(listed).toMatchObject({ vehicleTypeId: null, vehicleTypeName: null });
    });

    it('permissions: 403 without MANAGE_DRIVERS, 401 without a session — nothing written', async () => {
      const d = await s.driver({ ...near });
      const before = (await driverRow(d)).vehicle_type_id;
      expect((await setVehicle(orderViewer, d.driverId, { vehicleTypeId: motorbike.id })).status).toBe(403);
      expect((await world.api('get', '/admin/drivers/vehicle-types', { token: orderViewer.accessToken })).status).toBe(403);
      expect((await setVehicle(null, d.driverId, { vehicleTypeId: motorbike.id })).status).toBe(401);
      expect((await world.api('get', '/admin/drivers/vehicle-types')).status).toBe(401);
      expect((await driverRow(d)).vehicle_type_id).toBe(before);
    });

    it('validation: an unknown / inactive type, a malformed id, a missing field, an unknown or malformed driver — nothing written', async () => {
      const d = await s.driver({ ...near });
      const before = (await driverRow(d)).vehicle_type_id;
      const unknown = await setVehicle(superAdmin, d.driverId, { vehicleTypeId: '00000000-0000-4000-8000-000000000000' });
      expect([unknown.status, errCode(unknown)]).toEqual([400, 'VEHICLE_TYPE_NOT_FOUND']);
      const inactive = await setVehicle(superAdmin, d.driverId, { vehicleTypeId: retired.id });
      expect([inactive.status, errCode(inactive)]).toEqual([400, 'VEHICLE_TYPE_INACTIVE']);
      expect((await setVehicle(superAdmin, d.driverId, { vehicleTypeId: 'motorbike' })).status).toBe(400);
      expect((await setVehicle(superAdmin, d.driverId, {})).status).toBe(400);
      expect((await setVehicle(superAdmin, '00000000-0000-4000-8000-000000000000', { vehicleTypeId: motorbike.id })).status).toBe(404);
      expect((await setVehicle(superAdmin, 'not-a-uuid', { vehicleTypeId: motorbike.id })).status).toBe(400);
      expect((await driverRow(d)).vehicle_type_id).toBe(before);
    });

    it('dispatch: the type set by the admin is what ranking uses — a bicycle beyond the limit is skipped; clearing the type makes the driver eligible again', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      const [previous] = await world.ds.query("SELECT value FROM business_config WHERE key = 'MAX_BICYCLE_PICKUP_DISTANCE_METERS'");
      await s.setConfig('MAX_BICYCLE_PICKUP_DISTANCE_METERS', 10); // the branch is ~140 m from `near`
      try {
        const d = await s.driver({ ...near });
        expectData(await setVehicle(driverManager, d.driverId, { vehicleTypeId: bicycle.id }));
        const skipped = await readyOrder();
        expect((await world.ds.query('SELECT status FROM orders WHERE id = $1', [skipped.id]))[0].status).toBe('READY_FOR_PICKUP');

        expectData(await setVehicle(driverManager, d.driverId, { vehicleTypeId: null })); // no type: never treated as a bicycle
        const dispatched = await readyOrder();
        expect((await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1', [dispatched.id]))[0].driver_id).toBe(d.driverId);
      } finally {
        // config values cannot be null over the API: restore what was there (or remove the row this test created — uncached)
        if (previous) await s.setConfig('MAX_BICYCLE_PICKUP_DISTANCE_METERS', previous.value);
        else await world.ds.query("DELETE FROM business_config WHERE key = 'MAX_BICYCLE_PICKUP_DISTANCE_METERS'");
        await world.ds.query('UPDATE dispatch_alerts SET resolved_at = now() WHERE resolved_at IS NULL');
      }
    });

    it('changing the type of a BUSY driver keeps the assignment and the driver busy (even from a read taken before the assignment)', async () => {
      const d = await s.driver({ ...near });
      const stale = await staleSnapshot(d);
      const order = await readyOrder();
      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: superAdmin.accessToken, body: { driverId: d.driverId } }), 201);
      const repo = (world.app.get(DriversService) as any).driversRepository;
      jest.spyOn(repo, 'findOne').mockResolvedValue(stale);
      expectData(await setVehicle(driverManager, d.driverId, { vehicleTypeId: bicycle.id }));
      jest.restoreAllMocks();
      expect(await driverRow(d)).toMatchObject({ is_available: false, vehicle_type_id: bicycle.id });
      expect((await world.ds.query('SELECT o.status, dl.driver_id FROM orders o JOIN deliveries dl ON dl.order_id = o.id WHERE o.id = $1', [order.id]))[0])
        .toEqual({ status: 'ASSIGNED_TO_DRIVER', driver_id: d.driverId });
    });
  });

  describe('pickup orders: never dispatched, but findable (completion of a pickup is an open product decision — see PRODUCT_DECISIONS)', () => {
    it('a ready PICKUP order gets no driver, is counted in the Control Tower, and is listed by the admin order search fulfillment filter', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      const d = await s.driver({ ...near });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const order = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      await s.vendorPrepares(vendor, order.id);

      expect((await world.ds.query('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('READY_FOR_PICKUP');
      expect(await world.ds.query('SELECT 1 FROM deliveries WHERE order_id = $1', [order.id])).toHaveLength(0);
      expect((await driverRow(d)).is_available).toBe(true);
      expect((await rowsOf('/admin/control-tower/deliveries?stage=AWAITING_ASSIGNMENT&limit=100')).map((r) => r.orderId)).not.toContain(order.id);
      const before = await world.ds.query("SELECT count(*)::int AS n FROM orders WHERE status = 'READY_FOR_PICKUP' AND fulfillment_type = 'PICKUP' AND deleted_at IS NULL");
      const summary = expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: superAdmin.accessToken }));
      expect(summary.attention.readyForCustomerPickup).toBe(before[0].n);
      expect(summary.attention.readyForCustomerPickup).toBeGreaterThanOrEqual(1);

      const pickups = await rowsOf('/admin/orders?status=READY_FOR_PICKUP&fulfillmentType=PICKUP&limit=50');
      expect(pickups.find((o) => o.id === order.id)).toMatchObject({ orderNumber: order.orderNumber, fulfillmentType: 'PICKUP', status: 'READY_FOR_PICKUP' });
      expect(pickups.every((o) => o.fulfillmentType === 'PICKUP')).toBe(true);
      expect((await rowsOf('/admin/orders?fulfillmentType=DELIVERY&limit=50')).map((o) => o.id)).not.toContain(order.id);
      expect((await world.api('get', '/admin/orders?fulfillmentType=COLLECT', { token: superAdmin.accessToken })).status).toBe(400);
    });

    const rowsOf = async (path: string) => expectData<any[]>(await world.api('get', path, { token: superAdmin.accessToken }));
  });

  /**
   * Phase 6 race audit — two DIFFERENT actors acting on one order at the same instant (same-actor duplicates, stale views and
   * sweep-vs-sweep contention are covered in 83-control-tower / 70-dispatch). No sleep decides the interleaving: each race is
   * run several times and EVERY outcome must leave the order, its single delivery row and the drivers mutually consistent.
   */
  describe('cross-actor races leave order, delivery and drivers consistent', () => {
    const ROUNDS = 4;
    const ACTIVE = ['ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY'];
    const sweep = () => world.app.get(AutomaticDispatchService).reassignTimedOutDeliveries();
    const reassign = (orderId: string, driverId: string, expectedCurrentDriverId: string) =>
      world.api('post', `/admin/orders/${orderId}/reassign-driver`, { token: superAdmin.accessToken, body: { driverId, expectedCurrentDriverId } });
    const assign = (orderId: string, driverId: string) =>
      world.api('post', `/admin/orders/${orderId}/assign-driver`, { token: superAdmin.accessToken, body: { driverId } });
    const driverStatus = async (d: DriverFixture, orderId: string, status: string) => {
      const mine = await world.api('get', '/driver/deliveries', { token: d.accessToken });
      const delivery = (mine.body?.data ?? []).find((x: any) => x.orderId === orderId);
      return delivery
        ? world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d.accessToken, body: { status } })
        : { status: 404, body: null }; // the delivery is no longer this driver's — the driver app would not offer the action
    };
    const pair = async () => {
      await world.ds.query('UPDATE drivers SET is_online = false, is_available = false'); // only this round's drivers can be ranked
      return [await s.driver({ ...near }), await s.driver({ ...mid })] as const;
    };
    const errCode = (res: any) => res.body?.error?.details?.code;

    /** The invariants every race outcome must satisfy. Returns the order status and the driver carrying it (if any). */
    async function expectConsistent(orderId: string, drivers: readonly DriverFixture[]) {
      const [{ status }] = await world.ds.query('SELECT status FROM orders WHERE id = $1', [orderId]);
      const deliveries = await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1 AND deleted_at IS NULL', [orderId]);
      expect(deliveries.length).toBeLessThanOrEqual(1); // deliveries.order_id is unique — never a second row
      const carrier: string | null = ACTIVE.includes(status) ? deliveries[0].driver_id : null;
      for (const d of drivers) {
        const [{ n }] = await world.ds.query(
          `SELECT count(*)::int AS n FROM deliveries dl JOIN orders o ON o.id = dl.order_id WHERE dl.driver_id = $1 AND o.status = ANY($2)`,
          [d.driverId, ACTIVE],
        );
        expect(n).toBeLessThanOrEqual(1); // never double-booked
        expect({ driver: d.driverId, available: (await driverRow(d)).is_available }).toEqual({ driver: d.driverId, available: n === 0 });
      }
      if (carrier) expect(drivers.map((d) => d.driverId)).toContain(carrier);
      return { status: status as string, carrier };
    }

    it('1+2. timeout recovery (sweep) vs a manual REASSIGNMENT of the same expired order', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const [d1, d2] = await pair();
        const order = await readyOrder();
        expectData(await assign(order.id, d1.driverId), 201);
        await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [order.id]);
        await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true); // the sweep only runs with automatic dispatch on

        const [, manual] = await Promise.all([sweep(), reassign(order.id, d2.driverId, d1.driverId)]);

        expect([201, 409]).toContain(manual.status);
        if (manual.status === 409) expect(['ASSIGNMENT_CHANGED', 'ORDER_NOT_REASSIGNABLE']).toContain(errCode(manual));
        const { status, carrier } = await expectConsistent(order.id, [d1, d2]);
        expect(status).toBe('ASSIGNED_TO_DRIVER'); // one of the two always re-assigns it — never a silent orphan
        if (manual.status === 201) expect(carrier).toBe(d2.driverId);
        await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      }
    });

    it('1. timeout recovery (sweep) vs a manual ASSIGNMENT racing the sweep’s own re-assignment', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const [d1, d2] = await pair();
        const order = await readyOrder();
        expectData(await assign(order.id, d1.driverId), 201);
        await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [order.id]);
        await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);

        const [, manual] = await Promise.all([sweep(), assign(order.id, d2.driverId)]);

        expect([201, 409]).toContain(manual.status); // 409 = not READY at that instant (still assigned, or the sweep re-assigned first)
        if (manual.status === 409) expect(errCode(manual)).toBe('ORDER_NOT_ASSIGNABLE');
        const { status, carrier } = await expectConsistent(order.id, [d1, d2]);
        expect(status).toBe('ASSIGNED_TO_DRIVER');
        if (manual.status === 201) expect(carrier).toBe(d2.driverId);
        await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      }
    });

    it('3. assignment vs status progression: the driver PICKS UP while an admin reassigns — exactly one wins', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const [d1, d2] = await pair();
        const order = await readyOrder();
        expectData(await assign(order.id, d1.driverId), 201);

        const [pickup, manual] = await Promise.all([driverStatus(d1, order.id, 'PICKED_UP'), reassign(order.id, d2.driverId, d1.driverId)]);

        const pickedUp = pickup.status === 200;
        expect(pickedUp !== (manual.status === 201)).toBe(true); // never both, never neither
        const { status, carrier } = await expectConsistent(order.id, [d1, d2]);
        if (pickedUp) {
          expect([status, carrier, manual.status, errCode(manual)]).toEqual(['PICKED_UP', d1.driverId, 409, 'ORDER_NOT_REASSIGNABLE']);
        } else {
          expect([status, carrier]).toEqual(['ASSIGNED_TO_DRIVER', d2.driverId]);
          expect(pickup.status).toBeGreaterThanOrEqual(400);
          expect(pickup.status).toBeLessThan(500);
        }
      }
    });

    it('3. assignment vs status progression: the vendor cancels a READY order while an admin assigns it — no driver is left holding a cancelled order', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const [d1, d2] = await pair();
        const order = await readyOrder();
        const [segment] = await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1', [order.id]);

        const [cancel, manual] = await Promise.all([
          world.api('patch', `/vendor/orders/segments/${segment.id}/status`, { token: vendor.manager.accessToken, body: { status: 'CANCELLED' } }),
          assign(order.id, d1.driverId),
        ]);

        expect(cancel.status).toBeLessThan(500);
        expect([201, 409]).toContain(manual.status);
        const { status } = await expectConsistent(order.id, [d1, d2]);
        if (status === 'CANCELLED') expect((await driverRow(d1)).is_available).toBe(true);
        if (manual.status === 409) expect(errCode(manual)).toBe('ORDER_NOT_ASSIGNABLE');
      }
    });

    it('4. the driver hands the order back while an admin reassigns it — exactly one wins; the order is never orphaned unseen', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const [d1, d2] = await pair();
        const order = await readyOrder();
        expectData(await assign(order.id, d1.driverId), 201);

        const [release, manual] = await Promise.all([driverStatus(d1, order.id, 'READY_FOR_PICKUP'), reassign(order.id, d2.driverId, d1.driverId)]);

        const released = release.status === 200;
        expect(released !== (manual.status === 201)).toBe(true);
        const { status, carrier } = await expectConsistent(order.id, [d1, d2]);
        if (released) {
          expect([status, manual.status]).toEqual(['READY_FOR_PICKUP', 409]);
          expect(['ASSIGNMENT_CHANGED', 'ORDER_NOT_REASSIGNABLE']).toContain(errCode(manual));
          // waiting again → shown as released in the Control Tower, never a silent orphan
          const row = expectData<any[]>(await world.api('get', `/admin/control-tower/deliveries?search=${order.orderNumber}`, { token: superAdmin.accessToken }))[0];
          expect(row.released).toMatchObject({ byRole: 'DRIVER' });
        } else {
          expect([status, carrier]).toEqual(['ASSIGNED_TO_DRIVER', d2.driverId]);
          expect(release.status).toBeGreaterThanOrEqual(400);
          expect(release.status).toBeLessThan(500);
        }
      }
    });
  });
});
