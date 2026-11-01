/**
 * Order operations milestone, over real HTTP against real PostgreSQL:
 *  - segment rejection needs a reason; every transition leaves a history row (actor, role, on-behalf flag, reason);
 *  - Hatly operations act on the vendor's behalf with MANAGE_ORDER_FULFILMENT (and are refused without it);
 *  - partial rejection money (wallet refund exactly once, repeated / concurrent rejection never refunds twice; Manual Transfer refund
 *    obligation + the "really sent" marker) and the customer-facing refund summary;
 *  - per-branch automatic acceptance (accepted only — never preparing/ready);
 *  - dispatch is never silent: AUTO_ASSIGN_DISABLED / NO_ELIGIBLE_DRIVER alerts, one open alert per order and reason, resolved by an assignment;
 *  - Hatly/Wasally segments become dispatch-ready on their own, Manual Transfer only once approved;
 *  - the manual-address vendor filter by delivery zone.
 *
 * Delivery pricing: 10 EGP / 100 m, 15 EGP minimum, 5 EGP (500 minor) per additional vendor.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { AdHocFulfilmentService } from '../../src/modules/orders/ad-hoc-fulfilment.service';

describe('E2E — order operations (rejection, on-behalf, refunds, auto-accept, dispatch alerts, Hatly/Wasally readiness)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let fulfiller: Actor; // MANAGE_ORDER_FULFILMENT
  let outsider: Actor; // a staff account WITHOUT it
  let reviewer: Actor; // VERIFY_MANUAL_PAYMENTS
  let dispatcher: Actor; // ASSIGN_REASSIGN_ORDERS
  let commissioner: Actor; // MANAGE_VENDOR_COMMISSION
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const num = (v: unknown) => Number(v);

  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const segmentStatus = async (id: string) => (await world.ds.query('SELECT status FROM order_vendor_segments WHERE id = $1', [id]))[0].status;
  const events = (segmentId: string) =>
    world.ds.query('SELECT * FROM order_vendor_segment_events WHERE segment_id = $1 ORDER BY created_at, id', [segmentId]);
  const vendorStatus = (v: VendorFixture, segmentId: string, body: Record<string, unknown>) =>
    world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body });
  const adminStatus = (a: Actor, segmentId: string, body: Record<string, unknown>) =>
    world.api('patch', `/admin/orders/segments/${segmentId}/status`, { token: a.accessToken, body });
  const reject = (v: VendorFixture, segmentId: string, reason = 'Out of stock') => vendorStatus(v, segmentId, { status: 'CANCELLED', reason });
  const details = async (c: Actor, id: string) => expectData<any>(await world.api('get', `/orders/${id}`, { token: c.accessToken }));
  const ledger = (c: Actor, type: string) =>
    world.ds.query('SELECT amount_delta_minor, order_id FROM wallet_transactions WHERE customer_id = $1 AND type = $2 ORDER BY created_at', [c.id, type]);
  let seed = 0;
  const credit = (c: Actor, amountMinor: number) =>
    world.ds.query("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `ops-seed-${c.id}-${seed++}`]);
  const openAlerts = (orderId: string) =>
    world.ds.query('SELECT reason, detail FROM dispatch_alerts WHERE order_id = $1 AND resolved_at IS NULL AND deleted_at IS NULL ORDER BY created_at', [orderId]);
  const allAlerts = (orderId: string) => world.ds.query('SELECT reason, resolved_at FROM dispatch_alerts WHERE order_id = $1 ORDER BY created_at', [orderId]);

  const addr = (extra: Record<string, unknown> = {}) => ({ line1: 'Ops Street 1', latitude: home.lat, longitude: home.lng, ...extra });
  const place = async (c: Actor, body: Record<string, unknown>) =>
    world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: addr(), ...body }) });
  const cartFor = async (products: Array<{ id: string }>) => {
    const c = await s.customer();
    for (const p of products) await s.addToCart(c, p.id, 1);
    return c;
  };
  const twoVendorOrder = async (paymentMethod = 'COD', walletCredit = 0) => {
    const c = await cartFor([p1, p2]);
    if (walletCredit) await credit(c, walletCredit);
    const order = paymentMethod === 'MANUAL_TRANSFER' ? await s.checkout(c, home, 'MANUAL_TRANSFER') : expectData<any>(await place(c, { paymentMethod }), 201);
    return { c, order };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    fulfiller = await s.admin([Permission.MANAGE_ORDER_FULFILMENT, Permission.VIEW_ORDERS], 'Ops Fulfiller');
    outsider = await s.admin([Permission.VIEW_ORDERS], 'Ops Viewer');
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'Ops Reviewer');
    dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS, Permission.VIEW_ORDERS], 'Ops Dispatcher');
    commissioner = await s.admin([Permission.MANAGE_VENDOR_COMMISSION], 'Ops Commissioner');
    v1 = await s.vendor({ name: 'OP 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'OP 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false); // the dispatch cases switch it on explicitly
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('rejection reason and segment history', () => {
    it('a rejection without a reason is a 400 and changes nothing; with a reason it is recorded (actor, role, from → to, reason, not on behalf)', async () => {
      const { c, order } = await twoVendorOrder();
      const seg = await segmentOf(order.id, v2);
      expect((await vendorStatus(v2, seg, { status: 'CANCELLED' })).status).toBe(400);
      expect((await vendorStatus(v2, seg, { status: 'CANCELLED', reason: '   ' })).status).toBe(400);
      expect(await segmentStatus(seg)).toBe('PENDING');

      expectData(await reject(v2, seg, 'Kitchen closed'));
      const rows = await events(seg);
      expect(rows.map((r: any) => [r.from_status, r.to_status])).toEqual([[null, 'PENDING'], ['PENDING', 'CANCELLED']]);
      expect(rows[1]).toMatchObject({ actor_role: 'VENDOR_MANAGER', on_behalf_of_vendor: false, reason: 'Kitchen closed' });
      expect(rows[1].actor_user_id).toBe(v2.manager.id);

      const d = await details(c, order.id);
      expect(d.partialRejection).toEqual({ rejectedSegmentCount: 1, activeSegmentCount: 1 });
      const rejected = d.segments.find((x: any) => x.id === seg);
      expect(rejected.rejectionReason).toBe('Kitchen closed');
    });

    it('the vendor can never act on another vendor\'s segment (403), reason or not', async () => {
      const { order } = await twoVendorOrder();
      expect((await reject(v1, await segmentOf(order.id, v2))).status).toBe(403);
    });
  });

  describe('Hatly operations on behalf of a vendor (MANAGE_ORDER_FULFILMENT)', () => {
    it('without the permission it is refused (403) and nothing changes; with it the SAME transition runs and is recorded as on-behalf with the admin as actor', async () => {
      const { c, order } = await twoVendorOrder();
      const seg = await segmentOf(order.id, v1);
      expect((await adminStatus(outsider, seg, { status: 'CONFIRMED' })).status).toBe(403);
      expect((await adminStatus(c, seg, { status: 'CONFIRMED' })).status).toBe(403);
      expect(await segmentStatus(seg)).toBe('PENDING');

      expectData(await adminStatus(fulfiller, seg, { status: 'CONFIRMED' }));
      expect(await segmentStatus(seg)).toBe('CONFIRMED');
      const last = (await events(seg)).pop();
      expect(last).toMatchObject({ from_status: 'PENDING', to_status: 'CONFIRMED', on_behalf_of_vendor: true });
      expect(last.actor_user_id).toBe(fulfiller.id);

      // on-behalf rejection also needs the reason, and drives the same partial-cancellation money logic
      const seg2 = await segmentOf(order.id, v2);
      expect((await adminStatus(fulfiller, seg2, { status: 'CANCELLED' })).status).toBe(400);
      expectData(await adminStatus(fulfiller, seg2, { status: 'CANCELLED', reason: 'Vendor phoned: closed' }));
      expect((await orderRow(order.id)).status).toBe('PENDING');
      const d = await details(c, order.id);
      expect(d.segments.find((x: any) => x.id === seg2).history.pop()).toMatchObject({ toStatus: 'CANCELLED', actorRole: 'HATLY', reason: 'Vendor phoned: closed' });
      expect(JSON.stringify(d)).not.toContain(fulfiller.id); // the customer never learns which staff member acted

      // the vendor's own view labels the on-behalf action
      const vendorView = expectData<any>(await world.api('get', `/vendor/orders/${order.id}`, { token: v1.manager.accessToken }));
      expect(vendorView.segments[0].history.pop()).toMatchObject({ toStatus: 'CONFIRMED', onBehalfOfVendor: true });
    });

    it('the admin order detail carries the segment history (with names), the refund summary and the dispatch attempts', async () => {
      const { order } = await twoVendorOrder();
      const seg = await segmentOf(order.id, v2);
      expectData(await adminStatus(fulfiller, seg, { status: 'CANCELLED', reason: 'No stock' }));
      const adminView = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: fulfiller.accessToken }));
      const entry = adminView.segments.find((x: any) => x.id === seg).history.pop();
      expect(entry).toMatchObject({ toStatus: 'CANCELLED', onBehalfOfVendor: true, actorName: 'Ops Fulfiller', reason: 'No stock' });
      expect(adminView.refundSummary).toMatchObject({ walletRefundedMinor: 0, totalRefundMinor: 0 });
      expect(Array.isArray(adminView.dispatchAttempts)).toBe(true);
    });
  });

  describe('partial rejection — money', () => {
    it('wallet-funded, 2 vendors: rejecting one refunds exactly the removed amount ONCE; repeating or racing the rejection never refunds twice; the customer sees the refund summary', async () => {
      const { c, order } = await twoVendorOrder('WALLET', 200000);
      expect(order.paymentMethod).toBe('WALLET');
      const before = await orderRow(order.id);
      const seg = await segmentOf(order.id, v2);

      const [a, b] = await Promise.all([reject(v2, seg), reject(v2, seg)]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect((await reject(v2, seg)).status).toBe(400);

      const after = await orderRow(order.id);
      const removed = num(before.total_minor) - num(after.total_minor);
      expect(removed).toBe(20000 + 500); // v2's merchandise + one additional-vendor fee; base delivery fee fixed
      expect((await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([removed]);
      expect(num(after.total_minor)).toBe(num(after.subtotal_minor) + num(after.delivery_fee_minor) - num(after.discount_minor));

      const d = await details(c, order.id);
      expect(d.refundSummary).toMatchObject({ walletRefundedMinor: removed, totalRefundMinor: removed, status: 'REFUNDED_TO_WALLET' });
    });

    it('the LAST active segment rejected cancels the whole order and refunds everything that was paid — once', async () => {
      const { c, order } = await twoVendorOrder('WALLET', 200000);
      const total = num((await orderRow(order.id)).total_minor);
      expectData(await reject(v2, await segmentOf(order.id, v2)));
      expectData(await reject(v1, await segmentOf(order.id, v1)));
      expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED' });
      const refunds = (await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor));
      expect(refunds.reduce((x: number, y: number) => x + y, 0)).toBe(total);
      expect((await reject(v1, await segmentOf(order.id, v1))).status).toBe(400);
      expect((await ledger(c, 'ORDER_REFUND')).length).toBe(refunds.length);
    });

    it('COD: the amount due shrinks with the rejection and no refund exists; the example A100 + B80 + delivery 20 + fee 5 → 120 follows the same rule', async () => {
      const { c, order } = await twoVendorOrder('COD');
      const before = await orderRow(order.id);
      expectData(await reject(v2, await segmentOf(order.id, v2)));
      const after = await orderRow(order.id);
      expect(num(after.amount_due_minor)).toBe(num(before.amount_due_minor) - 20000 - 500);
      expect(await ledger(c, 'ORDER_REFUND')).toEqual([]);
      expect((await details(c, order.id)).refundSummary).toMatchObject({ totalRefundMinor: 0, status: 'NONE' });
    });

    it('Manual Transfer, APPROVED: a refund obligation is recorded; it is NOT shown as sent until operations mark it sent (once, audited, permissioned)', async () => {
      const { c, order } = await twoVendorOrder('MANUAL_TRANSFER');
      const payment = (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [order.id]))[0];
      expect((await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} })).status).toBeLessThan(300);
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      const before = await orderRow(order.id);
      expectData(await reject(v2, await segmentOf(order.id, v2)));
      const removed = num(before.total_minor) - num((await orderRow(order.id)).total_minor);

      const d1 = await details(c, order.id);
      expect(d1.refundSummary).toMatchObject({ transferRefundRecordedMinor: removed, transferRefundSentMinor: 0 });
      expect(d1.refundSummary.transferRefunds[0].sentAt).toBeNull();

      const pending = expectData<any[]>(await world.api('get', '/admin/manual-transfer-payments/refunds?sent=false', { token: reviewer.accessToken }));
      const row = pending.find((r) => r.orderId === order.id || r.order_id === order.id);
      expect(row).toBeTruthy();
      const eventId = row.id ?? row.eventId;
      expect((await world.api('post', `/admin/manual-transfer-payments/refunds/${eventId}/mark-sent`, { token: outsider.accessToken, body: {} })).status).toBe(403);
      expectData(await world.api('post', `/admin/manual-transfer-payments/refunds/${eventId}/mark-sent`, { token: reviewer.accessToken, body: { note: 'InstaPay ref 123' } }), 201);
      await world.api('post', `/admin/manual-transfer-payments/refunds/${eventId}/mark-sent`, { token: reviewer.accessToken, body: {} }); // repeat: no second marker
      expect(await world.ds.query('SELECT id FROM refund_payouts WHERE financial_event_id = $1', [eventId])).toHaveLength(1);

      const d2 = await details(c, order.id);
      expect(d2.refundSummary).toMatchObject({ transferRefundRecordedMinor: removed, transferRefundSentMinor: removed });
      expect(d2.refundSummary.transferRefunds[0].sentAt).toBeTruthy();
    });
  });

  describe('per-branch automatic acceptance', () => {
    it('only the permitted admin can switch it; when ON new segments of THAT branch start CONFIRMED (accepted only — never preparing/ready) with a SYSTEM history row; other branches stay manual', async () => {
      const path = `/admin/vendor-branches/${v1.branchId}/auto-accept`;
      expect((await world.api('patch', path, { token: outsider.accessToken, body: { autoAcceptEnabled: true } })).status).toBe(403);
      expectData(await world.api('patch', path, { token: commissioner.accessToken, body: { autoAcceptEnabled: true } }));
      try {
        const { order } = await twoVendorOrder();
        const s1 = await segmentOf(order.id, v1);
        expect(await segmentStatus(s1)).toBe('CONFIRMED');
        expect(await segmentStatus(await segmentOf(order.id, v2))).toBe('PENDING');
        const rows = await events(s1);
        expect(rows.map((r: any) => [r.from_status, r.to_status])).toEqual([[null, 'CONFIRMED']]); // accepted only
        expect(rows[0]).toMatchObject({ actor_user_id: null, on_behalf_of_vendor: false });
        expect(rows[0].reason).toMatch(/automatic/i);
        expect((await orderRow(order.id)).status).toBe('PENDING'); // one branch accepting does not advance the order
      } finally {
        expectData(await world.api('patch', path, { token: commissioner.accessToken, body: { autoAcceptEnabled: false } }));
      }
      const { order: manual } = await twoVendorOrder();
      expect(await segmentStatus(await segmentOf(manual.id, v1))).toBe('PENDING');
    });
  });

  describe('dispatch is never silent', () => {
    const readyOrder = async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      await s.vendorPrepares(v1, order.id);
      return order;
    };

    it('automatic assignment OFF: ONE open AUTO_ASSIGN_DISABLED alert (with detail) + an attempt row; an admin assignment resolves it', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
      const order = await readyOrder();
      expect((await orderRow(order.id)).status).toBe('READY_FOR_PICKUP');
      const open = await openAlerts(order.id);
      expect(open).toHaveLength(1);
      expect(open[0].reason).toBe('AUTO_ASSIGN_DISABLED');
      expect(open[0].detail).toBeTruthy();
      expect((await world.ds.query('SELECT outcome FROM dispatch_attempts WHERE order_id = $1', [order.id])).map((r: any) => r.outcome)).toContain('AUTO_ASSIGN_DISABLED');

      const listed = expectData<any[]>(await world.api('get', '/admin/dispatch-alerts?open=true', { token: dispatcher.accessToken }));
      expect(listed.find((a) => a.orderId === order.id)).toMatchObject({ reason: 'AUTO_ASSIGN_DISABLED' });
      const summary = expectData<any>(await world.api('get', '/admin/control-tower/summary', { token: dispatcher.accessToken }));
      expect(summary.operations.openDispatchAlerts.AUTO_ASSIGN_DISABLED).toBeGreaterThanOrEqual(1);

      expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: dispatcher.accessToken, body: { driverId: driver.driverId } }), 201);
      expect(await openAlerts(order.id)).toEqual([]);
      const history = await allAlerts(order.id);
      expect(history).toHaveLength(1);
      expect(history[0].resolved_at).toBeTruthy();
    });

    it('automatic assignment ON but no eligible driver: ONE open NO_ELIGIBLE_DRIVER alert however often it is retried; a later assignment resolves it', async () => {
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      try {
        await world.ds.query('UPDATE drivers SET is_online = false');
        const order = await readyOrder();
        expect((await openAlerts(order.id)).map((a: any) => a.reason)).toEqual(['NO_ELIGIBLE_DRIVER']);
        const { AutomaticDispatchService } = await import('../../src/modules/delivery/automatic-dispatch.service');
        const service = world.app.get(AutomaticDispatchService);
        await service.attemptAutomaticDispatch(order.id);
        await service.attemptAutomaticDispatch(order.id);
        expect(await openAlerts(order.id)).toHaveLength(1);
        expect(await allAlerts(order.id)).toHaveLength(1);

        const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
        expectData(await world.api('post', `/admin/orders/${order.id}/assign-driver`, { token: dispatcher.accessToken, body: { driverId: driver.driverId } }), 201);
        expect(await openAlerts(order.id)).toEqual([]);
      } finally {
        await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false);
      }
    });
  });

  describe('Hatly / Wasally segments (no vendor)', () => {
    let address: Record<string, unknown>;
    const wasally = { adHocPlaceName: "Mom's house", adHocServiceType: 'DELIVER_TO_PLACE', pickupLatitude: 30.35, pickupLongitude: 31.5, destinationLatitude: 30.36, destinationLongitude: 31.51, freeTextDescription: 'A key', quantity: 1 };

    beforeAll(async () => {
      address = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56, deliveryZoneId: (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id };
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    });

    const wasallyOrder = async (paymentMethod: string) => {
      const c = await s.customer();
      expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: wasally }), 201);
      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: await withQuoteToken(world, c.accessToken, { deliveryAddress: address, paymentMethod, ...(paymentMethod === 'MANUAL_TRANSFER' ? { electronicPaymentMethod: 'INSTAPAY' } : {}) }),
      });
      return { c, res };
    };

    it('COD: the segment moves PENDING → CONFIRMED → PREPARING → READY_FOR_PICKUP by itself (SYSTEM history) and the order is ready for dispatch', async () => {
      const { c, res } = await wasallyOrder('COD');
      expect(res.status).toBe(201);
      const orderId = res.body.data.id;
      expect((await orderRow(orderId)).status).toBe('READY_FOR_PICKUP');
      const seg = (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1', [orderId]))[0].id;
      const rows = await events(seg);
      expect(rows.map((r: any) => r.to_status)).toEqual(['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);
      expect(rows.slice(1).every((r: any) => r.actor_user_id === null && r.on_behalf_of_vendor === false)).toBe(true);
      expect((await openAlerts(orderId)).map((a: any) => a.reason)).toEqual(['AUTO_ASSIGN_DISABLED']); // never silent
      expect((await details(c, orderId)).status).toBe('READY_FOR_PICKUP');
    });

    it('Manual Transfer: NOT dispatch-ready until the transfer is approved — then the periodic pass makes it ready (payment verification is never bypassed)', async () => {
      const { c, res } = await wasallyOrder('MANUAL_TRANSFER');
      expect(res.status).toBe(201);
      const orderId = res.body.data.id;
      const fulfilment = world.app.get(AdHocFulfilmentService);
      expect((await orderRow(orderId)).status).toBe('PENDING');
      await fulfilment.sweep();
      expect((await orderRow(orderId)).status).toBe('PENDING');

      const payment = (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
      await world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: c.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      await fulfilment.sweep();
      await fulfilment.sweep(); // repeated pass: nothing left to do, nothing doubled
      expect((await orderRow(orderId)).status).toBe('READY_FOR_PICKUP');
      const seg = (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1', [orderId]))[0].id;
      expect((await events(seg)).map((r: any) => r.to_status)).toEqual(['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']);
    });
  });

  describe('manual address: vendors filtered by the address delivery zone', () => {
    it('GET /vendors?deliveryZoneId only lists branches whose service area covers the zone, and rejects a malformed id', async () => {
      const zone = await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1200 });
      const sector = await s.sector('Zone Filter');
      await s.assignSector(v1, sector.id);
      const farArea = await s.serviceArea({ name: 'Elsewhere', lat: 27.0, lng: 29.0, radiusMeters: 5000 });
      const farZone = await s.deliveryZone({ serviceAreaId: farArea.id, feeMinor: 900 });
      const list = (q: string) => world.api('get', `/vendors?sectorId=${sector.id}${q}`);
      const inArea = await list(`&deliveryZoneId=${zone.id}`);
      const elsewhere = await list(`&deliveryZoneId=${farZone.id}`);
      const unfiltered = await list('');
      expect(inArea.status).toBe(200);
      expect(inArea.body.data.map((b: any) => b.id)).toContain(v1.branchId);
      expect(elsewhere.body.data).toEqual([]); // a zone of another area: correctly empty, never an unfiltered fallback
      expect(unfiltered.body.data.length).toBeGreaterThanOrEqual(1);
      expect((await list('&deliveryZoneId=not-a-uuid')).status).toBe(400);
    });
  });
});
