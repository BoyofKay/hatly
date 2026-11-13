/**
 * P0 Admin real-time alerts and Web Push (2026-11-08, audit docs/launch/OPERATIONS_AUDIT_2026-11-08.md §3/§5).
 *  - A new order raises exactly ONE Operations alert in the order's own transaction; scans and retries never duplicate it.
 *  - Only admins see alerts; acknowledging needs the fulfilment permission, is idempotent and never resolves the condition.
 *  - Conditions resolve themselves (store accepted, order ended, dispatch alert closed) using the platform's existing thresholds only.
 *  - Web Push: per-admin device ownership, push-service allow-list, honest stages (queued → accepted → displayed/clicked by device receipt),
 *    retry with back-off, expired subscriptions revoked, repeats of unacknowledged critical alerts stop on acknowledgement.
 *  - Nothing here changes an order, payment or assignment.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { OpsAlertsService } from '../../src/modules/notifications/ops-alerts.service';
import { AdminPushService } from '../../src/modules/notifications/web-push/admin-push.service';

const P256 = 'B' + 'x'.repeat(86); // shape of a real p256dh key (87 base64url chars)
const AUTH = 'a'.repeat(22);
let endpointSeq = 0;
const endpoint = () => `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}-${++endpointSeq}`;

describe('E2E — Operations alerts and Admin Web Push (P0)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let ops: Actor;
  let ops2: Actor;
  let viewer: Actor;
  let reviewer: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  let alerts: OpsAlertsService;
  let push: AdminPushService;
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const alertsOf = (orderId: string) => q(`SELECT * FROM ops_alerts WHERE order_id = $1 ORDER BY opened_at`, [orderId]);
  const subscribe = (who: Actor, ep = endpoint(), extra: Record<string, unknown> = {}) =>
    world.api('post', '/admin/push/subscriptions', { token: who.accessToken, body: { endpoint: ep, keys: { p256dh: P256, auth: AUTH }, deviceLabel: 'E2E phone', ...extra } });
  const placeOrder = async () => {
    const c = await s.customer();
    const order = await s.simpleOrder(c, vendor, product.id, home);
    const [seg] = await q('SELECT id FROM order_vendor_segments WHERE order_id = $1', [order.id]);
    return { order, segmentId: seg.id as string };
  };
  const vendorMoves = (segmentId: string, status: string) =>
    world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: vendor.manager.accessToken, body: { status } });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    ops = await s.admin([Permission.MANAGE_ORDER_FULFILMENT, Permission.VIEW_ORDERS], 'Alert Ops');
    ops2 = await s.admin([Permission.MANAGE_ORDER_FULFILMENT, Permission.VIEW_ORDERS], 'Alert Ops Two');
    viewer = await s.admin([Permission.VIEW_ORDERS], 'Alert Viewer');
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'Alert Transfer Reviewer');
    vendor = await s.vendor({ name: 'Alert Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 9000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    alerts = world.app.get(OpsAlertsService);
    push = world.app.get(AdminPushService);
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a new order raises exactly one CRITICAL Operations alert in its own transaction, with inbox rows for the fulfilment staff only; scans and repeated raises never duplicate it', async () => {
    const device = expectData<any>(await subscribe(ops), 201);
    const { order } = await placeOrder();
    const [{ order_number: orderNumber }] = await q('SELECT order_number FROM orders WHERE id = $1', [order.id]);

    let rows = await alertsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: 'NEW_ORDER', priority: 'CRITICAL', order_number: orderNumber, acknowledged_at: null, resolved_at: null });

    await alerts.scan();
    await alerts.scan();
    await alerts.raiseNewOrder(world.ds.manager, { id: order.id, orderNumber });
    rows = await alertsOf(order.id);
    expect(rows).toHaveLength(1);

    const inbox = await q(`SELECT user_id FROM staff_notifications WHERE order_id = $1 AND category = 'OPS_NEW_ORDER'`, [order.id]);
    const who = inbox.map((r: any) => r.user_id);
    expect(who).toEqual(expect.arrayContaining([ops.id, ops2.id, superAdmin.id]));
    expect(who).not.toContain(viewer.id);
    expect(new Set(who).size).toBe(who.length);

    const deliveries = await q(`SELECT subscription_id, round, status FROM admin_push_deliveries WHERE alert_id = $1`, [rows[0].id]);
    expect(deliveries).toEqual([{ subscription_id: device.id, round: 0, status: 'QUEUED' }]);

    const listed = expectData<any[]>(await world.api('get', '/admin/ops-alerts', { token: viewer.accessToken }));
    expect(listed.find((a) => a.orderId === order.id)).toMatchObject({ category: 'NEW_ORDER', orderNumber, href: `/order-management?order=${order.id}` });
  });

  it('only admins see alerts; acknowledging needs the fulfilment permission, is idempotent (first acknowledgement kept) and never resolves the alert', async () => {
    const { order } = await placeOrder();
    const [alert] = await alertsOf(order.id);
    const c = await s.customer();

    expect((await world.api('get', '/admin/ops-alerts')).status).toBe(401);
    expect((await world.api('get', '/admin/ops-alerts', { token: c.accessToken })).status).toBe(403);
    expect((await world.api('get', '/admin/ops-alerts', { token: vendor.manager.accessToken })).status).toBe(403);
    expect((await world.api('post', `/admin/ops-alerts/${alert.id}/acknowledge`, { token: viewer.accessToken })).status).toBe(403);
    expect((await world.api('post', `/admin/ops-alerts/${alert.id}/acknowledge`, { token: c.accessToken })).status).toBe(403);

    const first = expectData<any>(await world.api('post', `/admin/ops-alerts/${alert.id}/acknowledge`, { token: ops.accessToken }));
    expect(first).toMatchObject({ id: alert.id, acknowledgedBy: { id: ops.id }, resolvedAt: null });
    const again = expectData<any>(await world.api('post', `/admin/ops-alerts/${alert.id}/acknowledge`, { token: superAdmin.accessToken }));
    expect(again.acknowledgedBy.id).toBe(ops.id);
    expect(again.acknowledgedAt).toBe(first.acknowledgedAt);

    await alerts.scan();
    const [after] = await alertsOf(order.id);
    expect(after.resolved_at).toBeNull(); // the store still has not accepted: seen, but not solved
    expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('PENDING'); // no business action
    expect((await world.api('post', '/admin/ops-alerts/00000000-0000-4000-8000-000000000000/acknowledge', { token: ops.accessToken })).status).toBe(404);
    expect((await world.api('post', '/admin/ops-alerts/not-a-uuid/acknowledge', { token: ops.accessToken })).status).toBe(400); // the global id check
  });

  it('an open new-order alert carries the store parts still waiting, so Operations can accept on the store\'s behalf from the alert; that resolves it and records "on behalf"', async () => {
    const { order, segmentId } = await placeOrder();
    const listed = expectData<any[]>(await world.api('get', '/admin/ops-alerts', { token: ops.accessToken }));
    const alert = listed.find((a) => a.orderId === order.id && a.category === 'NEW_ORDER');
    expect(alert.pendingParts).toEqual([{ segmentId, vendorName: 'Alert Vendor', vendorNameAr: null, branchName: expect.any(String) }]);

    // A viewer may see it but not accept (same permission as the order page); an operator accepts with the existing endpoint.
    expect((await world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: viewer.accessToken, body: { status: 'CONFIRMED' } })).status).toBe(403);
    expectData(await world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: ops.accessToken, body: { status: 'CONFIRMED' } }));
    const [ev] = await q(`SELECT on_behalf_of_vendor FROM order_vendor_segment_events WHERE segment_id = $1 AND to_status = 'CONFIRMED'`, [segmentId]);
    expect(ev.on_behalf_of_vendor).toBe(true);

    await alerts.scan();
    const [row] = await q(`SELECT resolution, acknowledged_at FROM ops_alerts WHERE order_id = $1 AND category = 'NEW_ORDER'`, [order.id]);
    expect(row).toMatchObject({ resolution: 'STORE_RESPONDED', acknowledged_at: null });
    const after = expectData<any[]>(await world.api('get', '/admin/ops-alerts', { token: ops.accessToken }));
    expect(after.find((a) => a.orderId === order.id && a.category === 'NEW_ORDER')).toBeUndefined();
  });

  it('a store that has not accepted in time raises ACCEPTANCE_OVERDUE once; accepting resolves it and the new-order alert; a late preparation raises a HIGH alert that clears when ready', async () => {
    const { order, segmentId } = await placeOrder();
    await q(`UPDATE order_vendor_segments SET created_at = now() - interval '6 minutes' WHERE id = $1`, [segmentId]);
    await alerts.scan();
    await alerts.scan();
    let rows = await alertsOf(order.id);
    expect(rows.map((r: any) => r.category).sort()).toEqual(['ACCEPTANCE_OVERDUE', 'NEW_ORDER']);
    expect(rows.find((r: any) => r.category === 'ACCEPTANCE_OVERDUE')).toMatchObject({ priority: 'CRITICAL', segment_id: segmentId });
    // Its age counts from when the store's 5 minutes ran out (placed 6 min ago → about 1 min), not from when the scan noticed it.
    const overdueAge = Date.now() - new Date(rows.find((r: any) => r.category === 'ACCEPTANCE_OVERDUE').opened_at).getTime();
    expect(overdueAge).toBeGreaterThan(45_000);
    expect(overdueAge).toBeLessThan(120_000);

    expectData(await vendorMoves(segmentId, 'CONFIRMED'));
    await alerts.scan();
    rows = await alertsOf(order.id);
    for (const r of rows) expect(r).toMatchObject({ resolution: 'STORE_RESPONDED', acknowledged_at: null });
    expect(rows.every((r: any) => r.resolved_at)).toBe(true);

    await q(`UPDATE order_vendor_segments SET expected_ready_at = now() - interval '2 minutes' WHERE id = $1`, [segmentId]);
    await alerts.scan();
    const late = (await alertsOf(order.id)).filter((r: any) => r.category === 'PREPARATION_LATE');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ priority: 'HIGH', resolved_at: null });
    expectData(await vendorMoves(segmentId, 'PREPARING'));
    expectData(await vendorMoves(segmentId, 'READY_FOR_PICKUP'));
    await alerts.scan();
    expect((await alertsOf(order.id)).find((r: any) => r.category === 'PREPARATION_LATE')).toMatchObject({ resolution: 'PREPARATION_DONE' });
  });

  it('open dispatch alerts are mirrored (existing thresholds) and close with them; cancelling an order resolves its alerts', async () => {
    const { order, segmentId } = await placeOrder();
    const [d] = await q(`INSERT INTO dispatch_alerts (order_id, reason, detail) VALUES ($1, 'NO_ELIGIBLE_DRIVER', 'e2e') RETURNING id`, [order.id]);
    await alerts.scan();
    const mirrored = (await alertsOf(order.id)).find((r: any) => r.category === 'NO_DRIVER');
    expect(mirrored).toMatchObject({ priority: 'CRITICAL', dispatch_alert_id: d.id, resolved_at: null });
    await q(`UPDATE dispatch_alerts SET resolved_at = now() WHERE id = $1`, [d.id]);
    await alerts.scan();
    expect((await alertsOf(order.id)).find((r: any) => r.category === 'NO_DRIVER')).toMatchObject({ resolution: 'DISPATCH_ALERT_CLOSED' });

    expectData(await world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', reason: 'Customer asked to cancel' } }));
    await alerts.scan();
    expect((await alertsOf(order.id)).find((r: any) => r.category === 'NEW_ORDER')).toMatchObject({ resolution: 'ORDER_ENDED' });
  });

  it('R2: an InstaPay order is not "new" for Operations before its transfer is verified; it is, once, when verified', async () => {
    const c = await s.customer();
    await s.addToCart(c, product.id, 1);
    const order = await s.checkout(c, home, 'MANUAL_TRANSFER');
    expect((await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} })).status).toBeLessThan(300);
    await alerts.scan();
    expect((await alertsOf(order.id)).filter((r: any) => r.category === 'NEW_ORDER')).toHaveLength(0);

    const [p] = await q(`SELECT id FROM payments WHERE order_id = $1`, [order.id]);
    expectData(await world.api('post', `/admin/manual-transfer-payments/${p.id}/approve`, { token: reviewer.accessToken }), 201);
    await alerts.scan();
    expect((await alertsOf(order.id)).filter((r: any) => r.category === 'NEW_ORDER')).toHaveLength(1);
  });

  it('push devices: allow-listed push services only, valid keys only, each device owned by one admin (re-registering moves it), no access to another admin’s device', async () => {
    expect((await subscribe(ops, 'http://fcm.googleapis.com/fcm/send/x')).status).toBe(400);
    expect((await subscribe(ops, 'https://evil.example.com/push')).status).toBe(400);
    expect((await subscribe(ops, 'https://169.254.169.254/latest')).status).toBe(400);
    expect((await world.api('post', '/admin/push/subscriptions', { token: ops.accessToken, body: { endpoint: endpoint(), keys: { p256dh: 'short', auth: AUTH } } })).status).toBe(400);
    expect((await subscribe(vendor.manager)).status).toBe(403);
    expect((await world.api('post', '/admin/push/subscriptions', { body: {} })).status).toBe(401);

    const shared = endpoint();
    const mine = expectData<any>(await subscribe(ops, shared), 201);
    expect((await world.api('delete', `/admin/push/subscriptions/${mine.id}`, { token: ops2.accessToken })).status).toBe(404);
    expect((await world.api('post', `/admin/push/subscriptions/${mine.id}/test`, { token: ops2.accessToken })).status).toBe(404);
    const lookup = expectData<any>(await world.api('post', '/admin/push/subscriptions/lookup', { token: ops.accessToken, body: { endpoint: shared } }));
    expect(lookup).toMatchObject({ id: mine.id, active: true });

    const taken = expectData<any>(await subscribe(ops2, shared), 201); // the same browser, now signed in as another admin
    expect(taken.id).toBe(mine.id);
    expect(expectData<any>(await world.api('post', '/admin/push/subscriptions/lookup', { token: ops.accessToken, body: { endpoint: shared } }))).toBeNull();
    const opsList = expectData<any[]>(await world.api('get', '/admin/push/subscriptions', { token: ops.accessToken }));
    expect(opsList.some((x) => x.id === mine.id)).toBe(false);
    expect(JSON.stringify(opsList)).not.toContain('fcm.googleapis.com/fcm/send'); // never echoes the capability URL
    expectData(await world.api('delete', `/admin/push/subscriptions/${mine.id}`, { token: ops2.accessToken }));
  });

  it('a test push records honest stages: queued, then accepted by the push service, then displayed and clicked only on the device’s own receipt token', async () => {
    const dev = expectData<any>(await subscribe(viewer), 201);
    const queued = expectData<any>(await world.api('post', `/admin/push/subscriptions/${dev.id}/test`, { token: viewer.accessToken }), 201);
    expect(queued).toMatchObject({ status: 'QUEUED', acceptedAt: null, displayedAt: null });

    await push.processBatch();
    const sent = boundary.webPush.find((m) => m.payload.deliveryId === queued.id)!;
    expect(sent.payload).toMatchObject({ url: '/notification-setup', priority: 'TEST' });
    expect(sent.payload.receiptToken).toEqual(expect.any(String));
    let state = expectData<any>(await world.api('get', `/admin/push/deliveries/${queued.id}`, { token: viewer.accessToken }));
    expect(state).toMatchObject({ status: 'ACCEPTED', displayedAt: null });
    expect(state.acceptedAt).toBeTruthy();
    const [{ receipt_token_hash: stored }] = await q(`SELECT receipt_token_hash FROM admin_push_deliveries WHERE id = $1`, [queued.id]);
    expect(stored).not.toBe(sent.payload.receiptToken); // only the hash is kept

    expect((await world.api('post', '/push-receipts', { body: { deliveryId: queued.id, token: 'x'.repeat(32), event: 'displayed' } })).status).toBe(404);
    expect((await world.api('post', '/push-receipts', { body: { deliveryId: queued.id, token: sent.payload.receiptToken, event: 'deleted' } })).status).toBe(404);
    expectData(await world.api('post', '/push-receipts', { body: { deliveryId: queued.id, token: sent.payload.receiptToken, event: 'displayed' } }));
    expectData(await world.api('post', '/push-receipts', { body: { deliveryId: queued.id, token: sent.payload.receiptToken, event: 'clicked' } }));
    state = expectData<any>(await world.api('get', `/admin/push/deliveries/${queued.id}`, { token: viewer.accessToken }));
    expect(state.displayedAt).toBeTruthy();
    expect(state.clickedAt).toBeTruthy();
    expect((await world.api('get', `/admin/push/deliveries/${queued.id}`, { token: ops.accessToken })).status).toBe(404); // not ops' delivery
  });

  it('a push service failure is retried with back-off; a gone subscription (410) is revoked and never used again; a refused message is not retried', async () => {
    const dev = expectData<any>(await subscribe(viewer), 201);
    const t1 = expectData<any>(await world.api('post', `/admin/push/subscriptions/${dev.id}/test`, { token: viewer.accessToken }), 201);
    boundary.webPushQueue.push(503);
    await push.processBatch();
    const [failed] = await q(`SELECT status, last_error, next_attempt_at > now() AS later FROM admin_push_deliveries WHERE id = $1`, [t1.id]);
    expect(failed).toMatchObject({ status: 'FAILED', last_error: 'PUSH_SERVICE_503', later: true });
    await q(`UPDATE admin_push_deliveries SET next_attempt_at = now() WHERE id = $1`, [t1.id]);
    boundary.webPushQueue.push('network');
    await push.processBatch();
    expect((await q(`SELECT status, attempts FROM admin_push_deliveries WHERE id = $1`, [t1.id]))[0]).toMatchObject({ status: 'FAILED', attempts: 2 });
    await q(`UPDATE admin_push_deliveries SET next_attempt_at = now() WHERE id = $1`, [t1.id]);
    await push.processBatch();
    expect((await q(`SELECT status FROM admin_push_deliveries WHERE id = $1`, [t1.id]))[0].status).toBe('ACCEPTED');

    const t2 = expectData<any>(await world.api('post', `/admin/push/subscriptions/${dev.id}/test`, { token: viewer.accessToken }), 201);
    boundary.webPushQueue.push(410);
    await push.processBatch();
    expect((await q(`SELECT status FROM admin_push_deliveries WHERE id = $1`, [t2.id]))[0].status).toBe('EXPIRED');
    const [sub] = await q(`SELECT revoked_at, revoked_reason FROM admin_push_subscriptions WHERE id = $1`, [dev.id]);
    expect(sub.revoked_reason).toBe('EXPIRED');
    expect((await world.api('post', `/admin/push/subscriptions/${dev.id}/test`, { token: viewer.accessToken })).status).toBe(404);

    const dev2 = expectData<any>(await subscribe(viewer), 201);
    const t3 = expectData<any>(await world.api('post', `/admin/push/subscriptions/${dev2.id}/test`, { token: viewer.accessToken }), 201);
    boundary.webPushQueue.push(400);
    await push.processBatch();
    expect((await q(`SELECT status FROM admin_push_deliveries WHERE id = $1`, [t3.id]))[0].status).toBe('DEAD');
  });

  it('an unacknowledged critical alert is pushed again to every device after the repeat interval (one message per device per round); acknowledgement stops repeats and skips queued ones', async () => {
    await q(`UPDATE admin_push_subscriptions SET revoked_at = now() WHERE revoked_at IS NULL`); // only this test's devices
    const phone = expectData<any>(await subscribe(ops), 201);
    const laptop = expectData<any>(await subscribe(ops), 201);
    const other = expectData<any>(await subscribe(ops2), 201);
    const { order } = await placeOrder();
    const [alert] = await alertsOf(order.id);

    await push.processBatch();
    const round0 = boundary.webPush.filter((m) => m.payload.alertId === alert.id);
    expect(round0).toHaveLength(3);
    expect(round0[0].payload).toMatchObject({ url: `/order-management?order=${order.id}`, tag: `ops-${alert.id}`, priority: 'CRITICAL', renotify: false });
    expect(round0[0].urgency).toBe('high');
    expect(JSON.stringify(round0[0].payload)).not.toMatch(/phone|address|E2E Customer/i);

    await alerts.scan(); // not due yet
    expect((await q(`SELECT count(*)::int AS n FROM admin_push_deliveries WHERE alert_id = $1`, [alert.id]))[0].n).toBe(3);
    await q(`UPDATE ops_alerts SET last_pushed_at = now() - interval '10 minutes' WHERE id = $1`, [alert.id]);
    await alerts.scan();
    await push.processBatch();
    const round1 = boundary.webPush.filter((m) => m.payload.alertId === alert.id && m.payload.renotify);
    expect(round1.map((m) => m.endpoint).sort()).toHaveLength(3);
    const perDevice = await q(`SELECT subscription_id, count(*)::int AS n FROM admin_push_deliveries WHERE alert_id = $1 GROUP BY 1`, [alert.id]);
    expect(perDevice.map((r: any) => [r.subscription_id, r.n]).sort()).toEqual([[phone.id, 2], [laptop.id, 2], [other.id, 2]].sort());

    // A repeat is queued, then someone acknowledges before it is sent: it is skipped, and no further repeats come.
    await q(`UPDATE ops_alerts SET last_pushed_at = now() - interval '10 minutes' WHERE id = $1`, [alert.id]);
    await alerts.scan();
    expectData(await world.api('post', `/admin/ops-alerts/${alert.id}/acknowledge`, { token: ops2.accessToken }));
    await push.processBatch();
    expect((await q(`SELECT status, skip_reason FROM admin_push_deliveries WHERE alert_id = $1 AND round = 2`, [alert.id])).every((r: any) => r.status === 'SKIPPED' && r.skip_reason === 'ACKNOWLEDGED')).toBe(true);
    await q(`UPDATE ops_alerts SET last_pushed_at = now() - interval '10 minutes' WHERE id = $1`, [alert.id]);
    await alerts.scan();
    expect((await q(`SELECT max(round)::int AS r FROM admin_push_deliveries WHERE alert_id = $1`, [alert.id]))[0].r).toBe(2);
  });

  it('without VAPID configuration nothing pretends to work: config says so, registering is refused, nothing is queued — the in-app alert still exists', async () => {
    boundary.webPushConfigured = false;
    expect(expectData<any>(await world.api('get', '/admin/push/config', { token: viewer.accessToken }))).toMatchObject({ configured: false, publicKey: null });
    const refused = await subscribe(ops);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.code).toBe('WEB_PUSH_NOT_CONFIGURED');
    const { order } = await placeOrder();
    const [alert] = await alertsOf(order.id);
    expect(alert.category).toBe('NEW_ORDER');
    expect((await q(`SELECT count(*)::int AS n FROM admin_push_deliveries WHERE alert_id = $1`, [alert.id]))[0].n).toBe(0);
  });
});
