/**
 * The Admin/Vendor notification centre's operational events (2026-11-01), on the existing staff inbox (staff_notifications + the outbox):
 * a new order tells the staff of each vendor branch in it; a cancelled order tells them to stop preparing; a new open dispatch alert, a claimed
 * manual transfer and a failed delivery tell the Operations staff whose permission covers the action (and who may read order alerts).
 * Real HTTP, real PostgreSQL. Isolation: a vendor never sees another branch's rows nor Operations categories; an admin is only targeted when they
 * hold both VIEW_ORDERS and the action's permission. Push, SMS, WhatsApp and e-mail are not configured; only the in-app inbox is asserted.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { DriverFailedDeliveryReason } from '../../src/modules/delivery/driver-failed-delivery-reason.enum';

describe('E2E — operational staff notifications (Admin/Vendor notification centre)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let dispatcher: Actor;
  let dispatcherNoView: Actor;
  let viewer: Actor;
  let reviewer: Actor;
  let issues: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const rows = (orderId: string, category: string) =>
    world.ds.query('SELECT user_id, severity, required_action, vendor_branch_id FROM staff_notifications WHERE order_id = $1 AND category = $2 ORDER BY user_id', [orderId, category]);
  const usersOf = async (orderId: string, category: string) => (await rows(orderId, category)).map((r: any) => r.user_id).sort();
  const inbox = (a: Actor, query: Record<string, string> = {}) => world.api('get', '/staff/notifications', { token: a.accessToken, query: { limit: '100', ...query } });
  const unread = async (a: Actor) => expectData<any>(await world.api('get', '/staff/notifications/unread-count', { token: a.accessToken })).unreadCount as number;
  const order = async (lines: Array<{ id: string }>, paymentMethod = 'COD') => {
    const c = await s.customer();
    for (const p of lines) await s.addToCart(c, p.id, 1, {});
    return { c, order: await s.checkout(c, home, paymentMethod) };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    dispatcher = await s.admin([Permission.VIEW_ORDERS, Permission.ASSIGN_REASSIGN_ORDERS], 'N Dispatcher');
    dispatcherNoView = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS], 'N Dispatcher without order view');
    viewer = await s.admin([Permission.VIEW_ORDERS], 'N Viewer');
    reviewer = await s.admin([Permission.VIEW_ORDERS, Permission.VERIFY_MANUAL_PAYMENTS], 'N Reviewer');
    issues = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_ORDER_ISSUES], 'N Issues');
    v1 = await s.vendor({ name: 'N One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'N Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 5000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a new order tells the staff of each vendor branch in it — each sees only their own branch, never Operations rows', async () => {
    const before1 = await unread(v1.manager);
    const before2 = await unread(v2.manager);
    const { order: single } = await order([p1]);
    expect(await usersOf(single.id, 'VENDOR_NEW_ORDER')).toEqual([v1.manager.id]);
    expect((await rows(single.id, 'VENDOR_NEW_ORDER'))[0]).toMatchObject({ severity: 'INFO', required_action: 'ACCEPT_ORDER', vendor_branch_id: v1.branchId });
    expect(await unread(v1.manager)).toBe(before1 + 1);
    expect(await unread(v2.manager)).toBe(before2);

    const { order: both } = await order([p1, p2]);
    expect((await rows(both.id, 'VENDOR_NEW_ORDER')).map((r: any) => [r.user_id, r.vendor_branch_id]).sort()).toEqual([[v1.manager.id, v1.branchId], [v2.manager.id, v2.branchId]].sort());

    const list2 = expectData<any[]>(await inbox(v2.manager));
    expect(list2.every((n) => n.vendorBranchId === v2.branchId)).toBe(true);
    expect(list2.some((n) => n.orderId === single.id)).toBe(false);
    expect(list2.find((n) => n.orderId === both.id)).toMatchObject({ category: 'VENDOR_NEW_ORDER', orderNumber: both.orderNumber, segmentId: expect.any(String) });
    // Another vendor's notification is indistinguishable from a missing one.
    const v1Row = expectData<any[]>(await inbox(v1.manager)).find((n) => n.orderId === single.id);
    expect((await world.api('post', `/staff/notifications/${v1Row.id}/read`, { token: v2.manager.accessToken })).status).toBe(404);
    // No customer data in a vendor's notification.
    expect(JSON.stringify(list2)).not.toMatch(/phone|address|\+20\d{9}/i);
  });

  it('read and read-all change only the caller\'s own unread count', async () => {
    await order([p1]);
    const list = expectData<any[]>(await inbox(v1.manager, { unread: 'true' }));
    expect(list.length).toBeGreaterThan(0);
    const n = await unread(v1.manager);
    expect(expectData<any>(await world.api('post', `/staff/notifications/${list[0].id}/read`, { token: v1.manager.accessToken }), 201)).toMatchObject({ isRead: true });
    expect(await unread(v1.manager)).toBe(n - 1);
    const other = await unread(v2.manager);
    expectData(await world.api('post', '/staff/notifications/read-all', { token: v1.manager.accessToken }), 201);
    expect(await unread(v1.manager)).toBe(0);
    expect(await unread(v2.manager)).toBe(other);
  });

  it('a customer cancellation tells the vendor staff to stop preparing (critical; it cannot be muted in the inbox)', async () => {
    const { c, order: o } = await order([p1]);
    expectData(await world.api('post', `/orders/${o.id}/cancel`, { token: c.accessToken, body: {} }), 201);
    expect(await rows(o.id, 'VENDOR_PART_CANCELLED')).toEqual([{ user_id: v1.manager.id, severity: 'CRITICAL', required_action: 'STOP_PREPARING', vendor_branch_id: v1.branchId }]);
    const refused = await world.api('put', '/staff/notifications/preferences', { token: v1.manager.accessToken, body: { category: 'VENDOR_PART_CANCELLED', channel: 'IN_APP', enabled: false } });
    expect(refused.status).toBe(409);
  });

  it('a vendor who mutes "new order" in the inbox gets no new-order row, and gets them again after switching it back on', async () => {
    expectData(await world.api('put', '/staff/notifications/preferences', { token: v2.manager.accessToken, body: { category: 'VENDOR_NEW_ORDER', channel: 'IN_APP', enabled: false } }));
    const { order: muted } = await order([p2]);
    expect(await usersOf(muted.id, 'VENDOR_NEW_ORDER')).toEqual([]);
    expectData(await world.api('put', '/staff/notifications/preferences', { token: v2.manager.accessToken, body: { category: 'VENDOR_NEW_ORDER', channel: 'IN_APP', enabled: true } }));
    const { order: back } = await order([p2]);
    expect(await usersOf(back.id, 'VENDOR_NEW_ORDER')).toEqual([v2.manager.id]);
  });

  it('a new open dispatch alert tells admins who may assign drivers AND read order alerts (plus super admins) — once per alert', async () => {
    const { order: o } = await order([p1]);
    await s.vendorPrepares(v1, o.id); // automatic dispatch is OFF → an AUTO_ASSIGN_DISABLED alert opens
    const targeted = await usersOf(o.id, 'OPS_DISPATCH_NEEDED');
    expect(targeted).toContain(dispatcher.id);
    expect(targeted).toContain(superAdmin.id);
    expect(targeted).not.toContain(dispatcherNoView.id); // could not open the inbox
    expect(targeted).not.toContain(viewer.id); // may read, may not assign
    expect(targeted).not.toContain(v1.manager.id);
    expect((await rows(o.id, 'OPS_DISPATCH_NEEDED'))[0]).toMatchObject({ severity: 'INFO', required_action: 'ASSIGN_DRIVER' });
    expect(expectData<any[]>(await inbox(dispatcher)).find((n) => n.orderId === o.id)).toMatchObject({ category: 'OPS_DISPATCH_NEEDED', note: 'AUTO_ASSIGN_DISABLED' });
    // A vendor never lists Operations categories, even for their own order.
    expect(expectData<any[]>(await inbox(v1.manager)).some((n) => n.category.startsWith('OPS_'))).toBe(false);
  });

  it('a claimed manual transfer tells the transfer reviewers once, however often the customer claims', async () => {
    const { c, order: o } = await order([p1], 'MANUAL_TRANSFER');
    for (let i = 0; i < 2; i++) expect((await world.api('post', `/payments/manual-transfer/orders/${o.id}/claim`, { token: c.accessToken, body: {} })).status).toBeLessThan(300);
    const targeted = await usersOf(o.id, 'OPS_TRANSFER_TO_VERIFY');
    expect(targeted).toContain(reviewer.id);
    expect(targeted).not.toContain(viewer.id);
    expect(targeted.filter((id: string) => id === reviewer.id)).toHaveLength(1);
  });

  it('a failed delivery tells the staff who resolve order issues (critical), not the driver', async () => {
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
    try {
      const driver = await s.driver({ lat: 30.422, lng: 31.562, fullName: 'N Driver' });
      const { order: o } = await order([p1]);
      await s.vendorPrepares(v1, o.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === o.id);
      for (const st of ['PICKED_UP', 'ON_THE_WAY']) expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: st } }));
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'FAILED_DELIVERY', failureReason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE } }));
      const targeted = await usersOf(o.id, 'OPS_FAILED_DELIVERY');
      expect(targeted).toContain(issues.id);
      expect(targeted).toContain(superAdmin.id);
      expect(targeted).not.toContain(viewer.id);
      expect(targeted).not.toContain(driver.id);
      expect((await rows(o.id, 'OPS_FAILED_DELIVERY'))[0]).toMatchObject({ severity: 'CRITICAL', required_action: 'RESOLVE_FAILED_DELIVERY' });
    } finally {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
    }
  });
});
