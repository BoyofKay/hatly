/**
 * Admin Control Tower milestone — over real HTTP against real PostgreSQL/Redis:
 *  - atomic manual assignment / reassignment (a refused action changes NOTHING), stale-view protection, concurrency;
 *  - dispatch alerts resolved by the assignment that fixes them (their documented contract);
 *  - a released order never reports the driver it was taken from;
 *  - PICKUP orders are never handed to a driver;
 *  - a new driver is available without any SQL (driver creation fix);
 *  - SUPER_ADMIN holds OVERRIDE_DISPATCH;
 *  - the read-only Control Tower endpoints and their permission boundaries.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Admin Control Tower & operational dispatch', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let vendor: VendorFixture;
  let product: { id: string };
  let superAdmin: Actor;
  let dispatcher: Actor; // ASSIGN_REASSIGN_ORDERS only (no override)
  let viewer: Actor; // VIEW_ORDERS only
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };
  const mid = { lat: 30.4212, lng: 31.5712 };
  const outsideArea = { lat: 26.0, lng: 32.0 }; // inside Egypt, outside the service area → never ranked

  const orderRow = async (id: string) => (await world.ds.query('SELECT status FROM orders WHERE id = $1', [id]))[0];
  const deliveryRow = async (orderId: string) => (await world.ds.query('SELECT * FROM deliveries WHERE order_id = $1', [orderId]))[0];
  const available = async (d: DriverFixture) => (await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [d.driverId]))[0].is_available as boolean;
  const retireAllDrivers = () => world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
  const api = (actor: Actor, method: 'get' | 'post' | 'patch', path: string, body?: unknown) => world.api(method, path, { token: actor.accessToken, body });
  const assign = (actor: Actor, orderId: string, driverId?: string) => api(actor, 'post', `/admin/orders/${orderId}/assign-driver`, driverId ? { driverId } : {});
  const reassign = (actor: Actor, orderId: string, driverId: string, expectedCurrentDriverId?: string) =>
    api(actor, 'post', `/admin/orders/${orderId}/reassign-driver`, { driverId, ...(expectedCurrentDriverId ? { expectedCurrentDriverId } : {}) });
  const code = (res: any) => res.body?.error?.details?.code;
  const readyOrder = async () => {
    const order = await s.simpleOrder(await s.customer(), vendor, product.id, home);
    await s.vendorPrepares(vendor, order.id);
    return order as { id: string; orderNumber: string };
  };
  /** A READY order assigned (by an admin) to `driver`. */
  const assignedTo = async (driver: DriverFixture) => {
    const order = await readyOrder();
    expectData(await assign(superAdmin, order.id, driver.driverId), 201);
    return order;
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Tower Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    superAdmin = await s.superAdmin();
    dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS, Permission.VIEW_ORDERS]);
    viewer = await s.admin([Permission.VIEW_ORDERS]);
  });
  beforeEach(async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false); // the tests decide every assignment
    await retireAllDrivers();
    await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() + INTERVAL '1 hour' WHERE accept_deadline_at IS NOT NULL");
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('driver availability is the product’s own (no SQL)', () => {
    it('a newly created, approved, online driver is dispatched automatically', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      const d = await s.driver({ ...near });
      expect(await available(d)).toBe(true);
      const order = await readyOrder();
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id)).driver_id).toBe(d.driverId);
    });
  });

  describe('assignment is atomic', () => {
    it('assigning an order ALREADY assigned is refused (409 ORDER_NOT_ASSIGNABLE) and changes NOTHING — the current driver keeps it', async () => {
      const d1 = await s.driver({ ...near });
      const d2 = await s.driver({ ...mid });
      const order = await assignedTo(d1);
      const res = await assign(superAdmin, order.id, d2.driverId);
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ code: 'ORDER_NOT_ASSIGNABLE', currentStatus: 'ASSIGNED_TO_DRIVER' });
      expect((await deliveryRow(order.id)).driver_id).toBe(d1.driverId);
      expect(await available(d1)).toBe(false);
      expect(await available(d2)).toBe(true);
    });

    it('assigning an order that is not ready yet changes nothing either (no driver locked out, no delivery row)', async () => {
      const d = await s.driver({ ...near });
      const order = await s.simpleOrder(await s.customer(), vendor, product.id, home); // PENDING
      for (const body of [{}, { driverId: d.driverId }]) {
        const res = await api(superAdmin, 'post', `/admin/orders/${order.id}/assign-driver`, body);
        expect(res.status).toBe(409);
        expect(code(res)).toBe('ORDER_NOT_ASSIGNABLE');
      }
      expect(await available(d)).toBe(true);
      expect(await deliveryRow(order.id)).toBeUndefined();
    });

    it('two concurrent assign requests for one ready order → exactly one succeeds; exactly one driver is busy', async () => {
      const d1 = await s.driver({ ...near });
      const d2 = await s.driver({ ...mid });
      const order = await readyOrder();
      const results = await Promise.all([assign(superAdmin, order.id, d1.driverId), assign(dispatcher, order.id, d2.driverId)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const winner = (await deliveryRow(order.id)).driver_id;
      expect([d1.driverId, d2.driverId]).toContain(winner);
      expect([await available(d1), await available(d2)].filter((x) => !x)).toHaveLength(1);
      const events = await world.ds.query("SELECT count(*)::int AS n FROM order_status_events WHERE order_id = $1 AND to_status = 'ASSIGNED_TO_DRIVER'", [order.id]);
      expect(events[0].n).toBe(1);
    });
  });

  describe('reassignment is atomic, validated first, and stale-view safe', () => {
    it('a successful reassignment frees the previous driver, busies the new one, bumps the counter and records the timeline', async () => {
      const d1 = await s.driver({ ...near });
      const d2 = await s.driver({ ...mid });
      const order = await assignedTo(d1);
      const res = await reassign(dispatcher, order.id, d2.driverId, d1.driverId);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ driverId: d2.driverId, reassignmentCount: 1 });
      expect(await available(d1)).toBe(true);
      expect(await available(d2)).toBe(false);
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
      const tail = await world.ds.query('SELECT to_status FROM order_status_events WHERE order_id = $1 ORDER BY created_at DESC LIMIT 2', [order.id]);
      expect(tail.map((t: any) => t.to_status)).toEqual(['ASSIGNED_TO_DRIVER', 'READY_FOR_PICKUP']);
    });

    it.each([
      ['an ineligible driver without OVERRIDE_DISPATCH', 'ineligible', 400, 'DRIVER_NOT_ELIGIBLE_WITHOUT_OVERRIDE'],
      ['an offline driver', 'offline', 409, 'DRIVER_UNAVAILABLE'],
      ['the driver already on the order', 'same', 409, 'DRIVER_ALREADY_ASSIGNED'],
      ['a stale view of who is assigned', 'stale', 409, 'ASSIGNMENT_CHANGED'],
    ])('a refused reassignment to %s leaves the order assigned to its driver — nothing changes', async (_, kind, httpStatus, expectedCode) => {
      const d1 = await s.driver({ ...near });
      const other = await s.driver(kind === 'ineligible' ? { ...outsideArea } : { ...mid });
      if (kind === 'offline') await world.ds.query('UPDATE drivers SET is_online = false WHERE id = $1', [other.driverId]);
      const order = await assignedTo(d1);
      const res =
        kind === 'same'
          ? await reassign(superAdmin, order.id, d1.driverId)
          : kind === 'stale'
            ? await reassign(superAdmin, order.id, other.driverId, other.driverId)
            : await reassign(kind === 'ineligible' ? dispatcher : superAdmin, order.id, other.driverId);
      expect(res.status).toBe(httpStatus);
      expect(code(res)).toBe(expectedCode);
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
      expect((await deliveryRow(order.id))).toMatchObject({ driver_id: d1.driverId, reassignment_count: 0 });
      expect(await available(d1)).toBe(false);
    });

    it('reassigning an order the driver already PICKED UP is refused and the carrying driver is never marked available', async () => {
      const d1 = await s.driver({ ...near });
      const d2 = await s.driver({ ...mid });
      const order = await assignedTo(d1);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: d1.accessToken })).find((x) => x.orderId === order.id);
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: d1.accessToken, body: { status: 'PICKED_UP' } }));
      const res = await reassign(superAdmin, order.id, d2.driverId);
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ code: 'ORDER_NOT_REASSIGNABLE', currentStatus: 'PICKED_UP' });
      expect(await available(d1)).toBe(false);
      expect(await available(d2)).toBe(true);
      expect((await deliveryRow(order.id))).toMatchObject({ driver_id: d1.driverId, reassignment_count: 0 });
    });

    it('two admins reassigning the same order at once (both from the same view) → exactly one wins; the other gets ASSIGNMENT_CHANGED', async () => {
      const d1 = await s.driver({ ...near });
      const d2 = await s.driver({ ...mid });
      const d3 = await s.driver({ lat: 30.4212, lng: 31.5812 });
      const order = await assignedTo(d1);
      const results = await Promise.all([reassign(superAdmin, order.id, d2.driverId, d1.driverId), reassign(dispatcher, order.id, d3.driverId, d1.driverId)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(code(results.find((r) => r.status === 409))).toBe('ASSIGNMENT_CHANGED');
      const winner = (await deliveryRow(order.id)).driver_id;
      expect(await available(d1)).toBe(true);
      expect([await available(d2), await available(d3)].filter((x) => !x)).toHaveLength(1);
      expect([d2.driverId, d3.driverId]).toContain(winner);
      expect((await deliveryRow(order.id)).reassignment_count).toBe(1);
    });

    it('SUPER_ADMIN holds OVERRIDE_DISPATCH: may name a driver the ranking would not pick; a plain dispatcher may not', async () => {
      const d1 = await s.driver({ ...near });
      const outside = await s.driver({ ...outsideArea });
      const order = await readyOrder();
      const refused = await assign(dispatcher, order.id, outside.driverId);
      expect(refused.status).toBe(400);
      expect(code(refused)).toBe('DRIVER_NOT_ELIGIBLE_WITHOUT_OVERRIDE');
      expect(await available(outside)).toBe(true);
      expect((await assign(superAdmin, order.id, outside.driverId)).status).toBe(201);
      expect(await available(d1)).toBe(true);
    });
  });

  describe('dispatch alerts, released orders, pickup orders', () => {
    it('a "no eligible driver" alert is resolved by the assignment that fixes it; ?open=true then excludes it; alerts carry the order number', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      const order = await readyOrder(); // nobody online → alert
      const open = expectData<any[]>(await api(dispatcher, 'get', '/admin/dispatch-alerts?open=true'));
      const alert = open.find((a) => a.orderId === order.id);
      expect(alert).toMatchObject({ reason: 'NO_ELIGIBLE_DRIVER', resolvedAt: null, orderNumber: order.orderNumber, orderStatus: 'READY_FOR_PICKUP' });
      const d = await s.driver({ ...near });
      expectData(await assign(dispatcher, order.id, d.driverId), 201);
      const all = expectData<any[]>(await api(dispatcher, 'get', '/admin/dispatch-alerts'));
      expect(all.find((a) => a.id === alert.id).resolvedAt).not.toBeNull();
      expect(expectData<any[]>(await api(dispatcher, 'get', '/admin/dispatch-alerts?open=true')).find((a) => a.id === alert.id)).toBeUndefined();
    });

    it('an order released by Operations (R17: drivers cannot release) no longer reports that driver anywhere (dispatch list, Control Tower, order detail)', async () => {
      const d1 = await s.driver({ ...near });
      const order = await assignedTo(d1);
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'READY_FOR_PICKUP' } }));
      const listed = expectData<any[]>(await api(dispatcher, 'get', '/admin/orders/dispatchable')).find((o) => o.orderId === order.id);
      expect(listed).toMatchObject({ status: 'READY_FOR_PICKUP', currentDriverId: null, orderNumber: order.orderNumber });
      const row = expectData<any[]>(await api(viewer, 'get', `/admin/control-tower/deliveries?stage=AWAITING_ASSIGNMENT&search=${order.orderNumber}`))[0];
      expect(row).toMatchObject({ orderId: order.id, driver: null, assignedAt: null });
      const detail = expectData<any>(await api(viewer, 'get', `/admin/orders/${order.id}`));
      expect(detail.driver).toBeNull();
      expect(detail.timeline.map((t: any) => t.status).slice(-2)).toEqual(['ASSIGNED_TO_DRIVER', 'READY_FOR_PICKUP']);
    });

    it('a PICKUP order (collected by the customer) is never handed to a driver — not automatically, not manually', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      const d = await s.driver({ ...near });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const order = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } }), 201);
      await s.vendorPrepares(vendor, order.id);
      expect((await orderRow(order.id)).status).toBe('READY_FOR_PICKUP');
      expect(await deliveryRow(order.id)).toBeUndefined();
      expect(await available(d)).toBe(true);
      expect((await world.ds.query('SELECT count(*)::int AS n FROM dispatch_alerts WHERE order_id = $1', [order.id]))[0].n).toBe(0);
      const manual = await assign(superAdmin, order.id, d.driverId);
      expect(manual.status).toBe(409);
      expect(code(manual)).toBe('ORDER_NOT_ASSIGNABLE');
      expect(expectData<any[]>(await api(dispatcher, 'get', '/admin/orders/dispatchable')).find((o) => o.orderId === order.id)).toBeUndefined();
      const summary = expectData<any>(await api(viewer, 'get', '/admin/control-tower/summary'));
      expect(summary.attention.readyForCustomerPickup).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Control Tower read views', () => {
    it('summary: counts by status + attention facts; driver aggregates only for callers who may see drivers', async () => {
      const d1 = await s.driver({ ...near });
      const assigned = await assignedTo(d1);
      await world.ds.query("UPDATE deliveries SET accept_deadline_at = NOW() - INTERVAL '1 minute' WHERE order_id = $1", [assigned.id]);
      await readyOrder(); // waiting; automatic dispatch is off, so it is never silent: an open AUTO_ASSIGN_DISABLED alert

      const forViewer = expectData<any>(await api(viewer, 'get', '/admin/control-tower/summary'));
      expect(forViewer.drivers).toBeNull();
      expect(forViewer.automaticDispatchEnabled).toBe(false);
      expect(forViewer.ordersByStatus.ASSIGNED_TO_DRIVER).toBeGreaterThanOrEqual(1);
      expect(forViewer.attention.assignedPastAcceptDeadline).toBeGreaterThanOrEqual(1);
      expect(forViewer.attention.awaitingWithOpenNoDriverAlert).toBeGreaterThanOrEqual(1);
      expect(forViewer.operations.openDispatchAlerts.AUTO_ASSIGN_DISABLED).toBeGreaterThanOrEqual(1);
      expect(forViewer.attention.awaitingAssignment).toBe(forViewer.attention.awaitingWithOpenNoDriverAlert + forViewer.attention.awaitingWithoutAlert);

      const forDispatcher = expectData<any>(await api(dispatcher, 'get', '/admin/control-tower/summary'));
      expect(forDispatcher.drivers).toMatchObject({ approved: expect.any(Number), onlineBusy: expect.any(Number) });
      expect(forDispatcher.drivers.onlineBusy).toBeGreaterThanOrEqual(1);
    });

    it('deliveries: stage filter, order-number search, driver filter, stable server-side pagination with totals', async () => {
      const d1 = await s.driver({ ...near });
      const a = await assignedTo(d1);
      const waiting = await readyOrder();
      const assignedRows = expectData<any[]>(await api(viewer, 'get', '/admin/control-tower/deliveries?stage=ASSIGNED&limit=100'));
      expect(assignedRows.every((r) => r.status === 'ASSIGNED_TO_DRIVER')).toBe(true);
      const mine = assignedRows.find((r) => r.orderId === a.id);
      expect(mine).toMatchObject({ orderNumber: a.orderNumber, driver: { id: d1.driverId }, acceptDeadlinePassed: false, reassignmentCount: 0 });
      expect(mine.statusSince).toEqual(expect.any(String));

      const byNumber = await api(viewer, 'get', `/admin/control-tower/deliveries?search=${waiting.orderNumber.toLowerCase()}`);
      expect(byNumber.body.data.map((r: any) => r.orderId)).toEqual([waiting.id]);
      expect(byNumber.body.meta).toMatchObject({ total: 1, page: 1 });

      const byDriver = expectData<any[]>(await api(viewer, 'get', `/admin/control-tower/deliveries?driverId=${d1.driverId}`));
      expect(byDriver.map((r) => r.orderId)).toEqual([a.id]);

      const page1 = await api(viewer, 'get', '/admin/control-tower/deliveries?limit=1&page=1');
      const page2 = await api(viewer, 'get', '/admin/control-tower/deliveries?limit=1&page=2');
      expect(page1.body.meta.total).toBeGreaterThanOrEqual(2);
      expect(page1.body.data[0].orderId).not.toBe(page2.body.data[0].orderId);
      const again = await api(viewer, 'get', '/admin/control-tower/deliveries?limit=1&page=1');
      expect(again.body.data[0].orderId).toBe(page1.body.data[0].orderId); // stable order
    });

    it('the dispatcher driver list: APPROVED drivers with availability, vehicle and the order they are on', async () => {
      const d1 = await s.driver({ ...near });
      const a = await assignedTo(d1);
      const list = expectData<any[]>(await api(dispatcher, 'get', '/admin/control-tower/drivers'));
      expect(list.every((d) => d.verificationStatus === 'APPROVED')).toBe(true);
      expect(list.find((d) => d.id === d1.driverId)).toMatchObject({ isOnline: true, isAvailable: false, vehicleTypeName: 'Motorbike', activeDelivery: { orderId: a.id, orderNumber: a.orderNumber, status: 'ASSIGNED_TO_DRIVER' } });
    });

    it('permissions: viewing needs VIEW_ORDERS; the driver picker needs ASSIGN_REASSIGN_ORDERS; customers/drivers/unrelated admins are refused', async () => {
      const d = await s.driver({ ...near });
      const unrelated = await s.admin([Permission.MANAGE_OFFERS]);
      const customer = await s.customer();
      for (const actor of [unrelated, customer, d]) {
        expect((await api(actor, 'get', '/admin/control-tower/summary')).status).toBe(403);
        expect((await api(actor, 'get', '/admin/control-tower/deliveries')).status).toBe(403);
      }
      expect((await api(viewer, 'get', '/admin/control-tower/drivers')).status).toBe(403);
      expect((await api(viewer, 'post', `/admin/orders/00000000-0000-4000-8000-000000000000/reassign-driver`, { driverId: d.driverId })).status).toBe(403);
      expect((await api(dispatcher, 'get', '/admin/control-tower/drivers')).status).toBe(200);
      expect((await world.api('get', '/admin/control-tower/summary', {})).status).toBe(401);
      // invalid input is a 400, never a 500
      for (const q of ['stage=NOPE', 'limit=0', 'limit=101', 'driverId=not-a-uuid', 'page=-1']) {
        expect((await api(viewer, 'get', `/admin/control-tower/deliveries?${q}`)).status).toBe(400);
      }
    });
  });
});
