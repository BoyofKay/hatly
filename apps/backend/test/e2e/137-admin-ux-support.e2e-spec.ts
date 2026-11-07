/**
 * Admin UX release (2026-11-07) — the backend support behind the clearer Admin screens. Read-side additions only; no business rule changes:
 *  - an order that ends (here: cancelled) closes its open dispatch alerts, and an open alert on an ended order is never counted or listed;
 *  - the transfer-review list carries the order number, order total and customer, so the reviewer never decodes an internal id;
 *  - a Manual Transfer payment can be found by its order number (for refunds), with what was already refunded; permissioned like the rest;
 *  - the operations facts count the transfers waiting for review.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Admin UX support (alerts on ended orders, transfer review context, refund lookup)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let reviewer: Actor;
  let viewer: Actor;
  let dispatcher: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'UX Reviewer');
    viewer = await s.admin([Permission.VIEW_ORDERS], 'UX Viewer');
    dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS, Permission.VIEW_ORDERS], 'UX Dispatcher');
    vendor = await s.vendor({ name: 'UX Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 9000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('cancelling an order closes its open dispatch alerts; the Control Tower neither counts nor lists an open alert of an ended order', async () => {
    const c = await s.customer();
    const order = await s.simpleOrder(c, vendor, product.id, home);
    const [seg] = await q('SELECT id FROM order_vendor_segments WHERE order_id = $1', [order.id]);
    // A stale alert like the ones production accumulated (raised while the order still waited, never closed when it was cancelled).
    await q(`INSERT INTO dispatch_alerts (order_id, reason, detail) VALUES ($1, 'NO_ELIGIBLE_DRIVER', 'test')`, [order.id]);
    const countOpen = async () => {
      const summary = expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: viewer.accessToken }));
      return summary.operations.openDispatchAlerts.NO_ELIGIBLE_DRIVER as number;
    };
    const before = await countOpen();

    // An alert left open on an ended order (written behind the state machine's back) is still never shown as open.
    await q(`UPDATE orders SET status = 'CANCELLED' WHERE id = $1`, [order.id]);
    expect(await countOpen()).toBe(before - 1);
    const listed = expectData<any[]>(await world.api('get', '/admin/dispatch-alerts?open=true', { token: dispatcher.accessToken }));
    expect(listed.some((a) => a.orderId === order.id)).toBe(false);
    await q(`UPDATE orders SET status = 'PENDING' WHERE id = $1`, [order.id]);

    // The real path: the order is cancelled through the state machine — its alert is closed with it.
    expectData(await world.api('patch', `/admin/orders/segments/${seg.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', reason: 'Customer asked to cancel' } }));
    expect((await q('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('CANCELLED');
    const [alert] = await q('SELECT resolved_at FROM dispatch_alerts WHERE order_id = $1', [order.id]);
    expect(alert.resolved_at).toBeTruthy();
    expect(await countOpen()).toBe(before - 1);
  });

  it('the transfer-review list carries the order number, total and customer; the facts count it; the refund lookup finds the payment by order number', async () => {
    const c = await s.customer();
    await s.addToCart(c, product.id, 1);
    const order = await s.checkout(c, home, 'MANUAL_TRANSFER');
    const [{ order_number: orderNumber, total_minor: total }] = await q('SELECT order_number, total_minor FROM orders WHERE id = $1', [order.id]);
    const facts = async () => expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: viewer.accessToken })).operations.transfersToVerify as number;
    const waitingBefore = await facts();

    expect((await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} })).status).toBeLessThan(300);
    expect(await facts()).toBe(waitingBefore + 1);

    const list = expectData<any[]>(await world.api('get', '/admin/manual-transfer-payments', { token: reviewer.accessToken }));
    const row = list.find((p) => p.orderId === order.id);
    expect(row).toMatchObject({ orderNumber, orderStatus: 'PENDING', orderTotalMinor: Number(total), customerName: c.fullName ?? expect.anything() });
    expect(typeof row.customerPhone).toBe('string');

    // Not yet paid: the lookup still answers (so the form can say why a refund is impossible), status UNDER_REVIEW.
    const early = expectData<any>(await world.api('get', `/admin/manual-transfer-payments/by-order/${orderNumber.toLowerCase()}`, { token: reviewer.accessToken }));
    expect(early).toMatchObject({ paymentId: row.id, orderId: order.id, orderNumber, status: 'UNDER_REVIEW', refundedMinor: 0 });

    expectData(await world.api('post', `/admin/manual-transfer-payments/${row.id}/approve`, { token: reviewer.accessToken }), 201);
    expect(await facts()).toBe(waitingBefore);
    expectData(await world.api('post', `/admin/manual-transfer-payments/${row.id}/refund`, { token: reviewer.accessToken, body: { amountMinor: 1000, reason: 'Goodwill' } }), 201);
    const after = expectData<any>(await world.api('get', `/admin/manual-transfer-payments/by-order/${orderNumber}`, { token: reviewer.accessToken }));
    expect(after).toMatchObject({ status: 'PAID', amountMinor: Number(row.amountMinor), refundedMinor: 1000 });

    const missing = await world.api('get', '/admin/manual-transfer-payments/by-order/HT-999999999', { token: reviewer.accessToken });
    expect(missing.status).toBe(404);
    expect(missing.body.error.details.code).toBe('TRANSFER_NOT_FOUND');
    expect((await world.api('get', `/admin/manual-transfer-payments/by-order/${orderNumber}`, { token: viewer.accessToken })).status).toBe(403);
    expect((await world.api('get', `/admin/manual-transfer-payments/by-order/${orderNumber}`)).status).toBe(401);
  });
});
