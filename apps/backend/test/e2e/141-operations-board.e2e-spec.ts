/**
 * Operations board (2026-11-13) over real HTTP / PostgreSQL: one list of live orders, most urgent first, each with the reason it is there,
 * its store parts and a suggested driver (the automatic-dispatch ranking, read-only). The board itself never changes anything; the actions
 * the page offers are the existing endpoints (on-behalf segment transitions, assign).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Operations board', () => {
  let world: World;
  let s: Scenario;
  let v1: VendorFixture;
  let p1: { id: string; priceMinor: number };
  let admin: Actor;
  const home = { lat: 30.425, lng: 31.565 };
  const near = { lat: 30.4212, lng: 31.5612 };
  const board = async (a: Actor = admin) => expectData<any>(await world.api('get', '/admin/operations/board', { token: a.accessToken }));
  const row = async (orderId: string) => (await board()).items.find((i: any) => i.id === orderId);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Board Store', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    admin = await s.superAdmin();
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
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
    return s.checkout(c, home, 'COD');
  };
  const segmentOf = async (orderId: string) => (await world.ds.query(`SELECT id FROM order_vendor_segments WHERE order_id = $1`, [orderId]))[0].id as string;
  const onBehalf = (segmentId: string, status: string) => world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: admin.accessToken, body: { status } });

  it('a new order is on the board as NEW with its pending store part; "accept & start preparing" (two existing transitions) moves it to PREPARING', async () => {
    const order = await place();
    const r = await row(order.id);
    expect(r).toMatchObject({ reason: 'NEW', status: 'PENDING', driver: null });
    expect(r.segments).toEqual([expect.objectContaining({ status: 'PENDING', vendorName: 'Board Store' })]);
    const seg = await segmentOf(order.id);
    expectData(await onBehalf(seg, 'CONFIRMED'));
    expectData(await onBehalf(seg, 'PREPARING'));
    expect(await row(order.id)).toMatchObject({ reason: 'PREPARING' });
  });

  it('a store that has not accepted within the alert window is STORE_NOT_ACCEPTED and ranks above a fresh new order', async () => {
    const late = await place();
    await world.ds.query(`UPDATE order_vendor_segments SET created_at = now() - interval '10 minutes' WHERE order_id = $1`, [late.id]);
    const fresh = await place();
    const items = (await board()).items;
    const iLate = items.findIndex((i: any) => i.id === late.id);
    const iFresh = items.findIndex((i: any) => i.id === fresh.id);
    expect(items[iLate].reason).toBe('STORE_NOT_ACCEPTED');
    expect(items[iFresh].reason).toBe('NEW');
    expect(iLate).toBeLessThan(iFresh);
  });

  it('a ready delivery order NEEDS_DRIVER with a suggested driver (load / capacity); assigning that driver takes it off the "needs a driver" lane', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const d = await s.driver({ ...near });
    const order = await place();
    await s.vendorPrepares(v1, order.id);
    const r = await row(order.id);
    expect(r.reason).toBe('NEEDS_DRIVER');
    expect(r.suggestedDrivers[0]).toMatchObject({ id: d.driverId, active: 0, capacity: expect.any(Number) });
    expect((await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: admin.accessToken, body: { driverId: r.suggestedDrivers[0].id } })).status).toBe(201);
    const after = await row(order.id);
    expect(after.reason).not.toBe('NEEDS_DRIVER');
    expect(after.driver).toMatchObject({ id: d.driverId });
  });

  it('a driver who switches offline while holding the order puts it at the top as DRIVER_OFFLINE (from the ops alert)', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const d = await s.driver({ ...near });
    const order = await place();
    await s.vendorPrepares(v1, order.id);
    expect((await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: admin.accessToken, body: { driverId: d.driverId } })).status).toBe(201);
    expectData(await world.api('patch', '/driver/online-status', { token: d.accessToken, body: { isOnline: false } }));
    await world.app.get((await import('../../src/modules/notifications/ops-alerts.service')).OpsAlertsService).scan();
    const r = await row(order.id);
    expect(r).toMatchObject({ reason: 'DRIVER_OFFLINE', driver: expect.objectContaining({ online: false }) });
  });

  it('stage 2: the driver ranking for an order is the automatic-dispatch order with load / capacity; it needs ASSIGN_REASSIGN_ORDERS', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const a = await s.driver({ ...near });
    const b = await s.driver({ lat: 30.43, lng: 31.57 });
    const order = await place();
    await s.vendorPrepares(v1, order.id);
    const res = expectData<any>(await world.api('get', `/admin/operations/orders/${order.id}/driver-ranking`, { token: admin.accessToken }));
    const ids = res.ranked.map((d: any) => d.id);
    expect(ids).toEqual(expect.arrayContaining([a.driverId, b.driverId]));
    expect(ids.indexOf(a.driverId)).toBeLessThan(ids.indexOf(b.driverId)); // nearer first, as automatic dispatch
    expect(res.ranked[0]).toMatchObject({ id: a.driverId, active: 0, capacity: expect.any(Number) });
    expect((await row(order.id)).suggestedDrivers.map((d: any) => d.id)).toEqual(ids.slice(0, 3)); // the board's suggestion is the same ranking
    const viewer = await s.admin([Permission.VIEW_ORDERS], 'Ranking viewer');
    expect((await world.api('get', `/admin/operations/orders/${order.id}/driver-ranking`, { token: viewer.accessToken })).status).toBe(403);
    const assigner = await s.admin([Permission.VIEW_ORDERS, Permission.ASSIGN_REASSIGN_ORDERS], 'Ranking assigner');
    expect((await world.api('get', `/admin/operations/orders/${order.id}/driver-ranking`, { token: assigner.accessToken })).status).toBe(200);
    expect((await world.api('get', `/admin/operations/orders/not-a-uuid/driver-ranking`, { token: admin.accessToken })).status).toBe(400);
  });

  it('stage 2: several orders to one driver — each assignment is the existing endpoint; within capacity they all land, past it the backend refuses AT_CAPACITY', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const d = await s.driver({ ...near });
    await world.ds.query('UPDATE drivers SET capacity_override = 2 WHERE id = $1', [d.driverId]);
    const orders = [await place(), await place(), await place()];
    for (const o of orders) await s.vendorPrepares(v1, o.id);
    const assign = (o: any) => world.api('post', `/admin/orders/${o.id}/assign-driver`, { token: admin.accessToken, body: { driverId: d.driverId } });
    expect((await assign(orders[0])).status).toBe(201);
    expect((await assign(orders[1])).status).toBe(201);
    const third = await assign(orders[2]);
    expect(third.status).toBe(409);
    expect(third.body.error.details).toMatchObject({ reason: 'AT_CAPACITY', active: 2, capacity: 2 });
    expect((await row(orders[2].id)).reason).toBe('NEEDS_DRIVER');
    const ranking = expectData<any>(await world.api('get', `/admin/operations/orders/${orders[2].id}/driver-ranking`, { token: admin.accessToken }));
    expect(ranking.ranked.find((r: any) => r.id === d.driverId)?.active ?? 2).toBe(2);
  });

  it('stage 4: "Stores now" groups the parts to act on by branch — late acceptance, late preparation, who to call; a preset reject reason is stored verbatim', async () => {
    const stores = async (a: Actor = admin) => expectData<any>(await world.api('get', '/admin/operations/stores-now', { token: a.accessToken }));
    const waiting = await place();
    await world.ds.query(`UPDATE order_vendor_segments SET created_at = now() - interval '12 minutes' WHERE order_id = $1`, [waiting.id]);
    const cooking = await place();
    const cookSeg = await segmentOf(cooking.id);
    expectData(await onBehalf(cookSeg, 'CONFIRMED'));
    expectData(await onBehalf(cookSeg, 'PREPARING'));
    await world.ds.query(`UPDATE order_vendor_segments SET expected_ready_at = now() - interval '3 minutes' WHERE id = $1`, [cookSeg]);

    const res = await stores();
    expect(res.acceptAlertMinutes).toBe(5);
    const st = res.stores.find((x: any) => x.branchId === v1.branchId);
    expect(st).toMatchObject({ vendorName: 'Board Store', contacts: [expect.objectContaining({ name: 'Board Store Manager', role: 'VENDOR_MANAGER', phone: expect.any(String) })] });
    expect(st.counts.lateAccept).toBeGreaterThanOrEqual(1);
    expect(st.counts.latePreparation).toBeGreaterThanOrEqual(1);
    const waitingSeg = await segmentOf(waiting.id);
    expect(st.parts.find((p: any) => p.segmentId === waitingSeg)).toMatchObject({ status: 'PENDING', orderNumber: waiting.orderNumber, lateAccept: true, unverifiedTransfer: false });
    expect(st.parts.find((p: any) => p.segmentId === cookSeg)).toMatchObject({ status: 'PREPARING', latePreparation: true, lateAccept: false });

    // the page's preset reason is just the existing required reason — the same on-behalf transition, stored as written, shown to the customer
    const preset = 'بعض المنتجات غير متوفرة حاليًا';
    expectData(await world.api('patch', `/admin/orders/segments/${waitingSeg}/status`, { token: admin.accessToken, body: { status: 'CANCELLED', reason: preset } }));
    const detail = expectData<any>(await world.api('get', `/admin/orders/${waiting.id}`, { token: admin.accessToken }));
    expect(detail.segments.find((g: any) => g.id === waitingSeg).rejectionReason).toBe(preset);
    const after = (await stores()).stores.find((x: any) => x.branchId === v1.branchId);
    expect(after?.parts.some((p: any) => p.segmentId === waitingSeg) ?? false).toBe(false);

    const viewer = await s.admin([Permission.VIEW_ORDERS], 'Stores viewer');
    expect((await world.api('get', '/admin/operations/stores-now', { token: viewer.accessToken })).status).toBe(200);
    const nobody = await s.admin([Permission.VIEW_CUSTOMERS], 'No stores');
    expect((await world.api('get', '/admin/operations/stores-now', { token: nobody.accessToken })).status).toBe(403);
    expect((await world.api('get', '/admin/operations/stores-now', { token: v1.manager.accessToken })).status).toBe(403);
  });

  it('finished orders are not on the board; the board is read-only and needs VIEW_ORDERS; customers and stores are refused', async () => {
    const order = await place();
    const seg = await segmentOf(order.id);
    expectData(await onBehalf(seg, 'CANCELLED').then((r) => (r.status === 400 ? world.api('patch', `/admin/orders/segments/${seg}/status`, { token: admin.accessToken, body: { status: 'CANCELLED', reason: 'Board test' } }) : r)));
    expect(await row(order.id)).toBeUndefined();
    const viewer = await s.admin([Permission.VIEW_ORDERS], 'Board viewer');
    expect((await world.api('get', '/admin/operations/board', { token: viewer.accessToken })).status).toBe(200);
    const nobody = await s.admin([Permission.VIEW_CUSTOMERS], 'No orders');
    expect((await world.api('get', '/admin/operations/board', { token: nobody.accessToken })).status).toBe(403);
    expect((await world.api('get', '/admin/operations/board', { token: (await s.customer()).accessToken })).status).toBe(403);
    expect((await world.api('get', '/admin/operations/board', { token: v1.manager.accessToken })).status).toBe(403);
    const before = (await world.ds.query(`SELECT count(*)::int AS n FROM order_status_events`))[0].n;
    await board();
    expect((await world.ds.query(`SELECT count(*)::int AS n FROM order_status_events`))[0].n).toBe(before);
  });
});
