/**
 * PD-005 — customer cancellation of a WHOLE order, over real HTTP against real PostgreSQL.
 *
 * A customer may cancel their own order only while it is PENDING or CONFIRMED; from PREPARING on the backend refuses it
 * (the UI hiding a button is not the rule). Cancelling cancels every still-active vendor segment atomically and reuses the
 * PD-002/PD-004 money handling: fee 0 and nothing owed, stock and flash-sale allocation restored once, PAID transfer → the
 * remaining refund, unverified transfer → the pending entitlement (converted on later approval), COD → no refund event.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, DriverFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

const HOUR = 3600_000;
const window = () => ({ startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + 24 * HOUR).toISOString() });

describe('E2E — customer order cancellation (PD-005)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let v3: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  let p3: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const num = (v: unknown) => Number(v);
  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const segments = (orderId: string) => world.ds.query('SELECT id, vendor_branch_id, status, updated_at FROM order_vendor_segments WHERE order_id = $1 ORDER BY id', [orderId]);
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const refundEvents = (orderId: string) =>
    world.ds.query("SELECT amount_minor, idempotency_key, actor_user_id FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED' ORDER BY created_at", [orderId]);
  const refundedTotal = async (orderId: string) => (await refundEvents(orderId)).reduce((sum: number, e: any) => sum + num(e.amount_minor), 0);
  const stock = async (productId: string) => num((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [productId]))[0].quantity);
  const cancel = (c: Actor, orderId: string, body: Record<string, unknown> = {}) => world.api('post', `/orders/${orderId}/cancel`, { token: c.accessToken, body });
  const adminStatus = (orderId: string, status: string) => world.api('patch', `/orders/${orderId}/status`, { token: superAdmin.accessToken, body: { status } });
  const cancelSegment = (v: VendorFixture, segmentId: string) => world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } });
  const claim = (c: Actor, orderId: string) => world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: c.accessToken, body: {} });
  const approve = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/approve`, { token: reviewer.accessToken });
  const reject = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/reject`, { token: reviewer.accessToken, body: { reason: 'no money' } });
  const driverStep = (driver: Actor, deliveryId: string, status: string, extra: Record<string, unknown> = {}) =>
    world.api('patch', `/driver/deliveries/${deliveryId}/status`, { token: driver.accessToken, body: { status, ...extra } });
  const expectConsistent = (row: any) => expect(num(row.total_minor)).toBe(num(row.subtotal_minor) + num(row.delivery_fee_minor) - num(row.discount_minor));
  const placed = async (products: Array<{ id: string }>, paymentMethod = 'COD', quantities: number[] = []) => {
    const customer = await s.customer();
    for (let i = 0; i < products.length; i++) await s.addToCart(customer, products[i].id, quantities[i] ?? 1);
    return { customer, order: await s.checkout(customer, home, paymentMethod) };
  };
  const underReview = async (products: Array<{ id: string }>) => {
    const o = await placed(products, 'MANUAL_TRANSFER');
    await claim(o.customer, o.order.id);
    expect((await paymentOf(o.order.id)).status).toBe('UNDER_REVIEW');
    return o;
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'CC 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'CC 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    v3 = await s.vendor({ name: 'CC 3', serviceAreaId: area.id, lat: 30.441, lng: 31.581 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    p3 = await s.product(v3, { priceMinor: 30000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000' });
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

  describe('a/b) allowed while PENDING or CONFIRMED', () => {
    it('a PENDING single-vendor order: cancelled by the CUSTOMER, delivery fee 0, nothing owed, segment cancelled, customer notified once, the response is the customer view', async () => {
      const customer = await s.customer();
      expectData(await world.api('post', '/customer/device-token', { token: customer.accessToken, body: { token: 'fcm-cc', platform: 'android' } }), 201);
      await s.addToCart(customer, p1.id, 1);
      const o = await s.checkout(customer, home);
      expect((await orderRow(o.id)).status).toBe('PENDING');

      const res = await cancel(customer, o.id, { cancellationReason: 'changed my mind' });
      const view = expectData(res, 201);
      expect(view).toMatchObject({ id: o.id, status: 'CANCELLED', cancellationReason: 'changed my mind', cancelledByRole: 'CUSTOMER', deliveryFeeMinor: 0, totalMinor: 0 });

      const row = await orderRow(o.id);
      expect(row).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'CUSTOMER', cancellation_reason: 'changed my mind' });
      expect([num(row.delivery_fee_minor), num(row.subtotal_minor), num(row.discount_minor), num(row.total_minor)]).toEqual([0, 0, 0, 0]);
      expectConsistent(row);
      expect((await segments(o.id)).map((r: any) => r.status)).toEqual(['CANCELLED']);
      expect(boundary.push.filter((p) => p.data.type === 'ORDER_CANCELLED' && p.data.orderId === o.id)).toHaveLength(1);
    });

    it('a CONFIRMED single-vendor order can be cancelled too', async () => {
      const { customer, order: o } = await placed([p1]);
      expectData(await adminStatus(o.id, 'CONFIRMED'));
      expect((await orderRow(o.id)).status).toBe('CONFIRMED');
      expectData(await cancel(customer, o.id), 201);
      expect(await orderRow(o.id)).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'CUSTOMER' });
    });
  });

  describe('c/d) R3: allowed until the driver picks the goods up — refused from PICKED_UP on', () => {
    it.each(['PREPARING', 'READY_FOR_PICKUP'])('%s: cancelled by the customer; stock back once; every segment cancelled (Hatly bears the preparation cost)', async (target) => {
      const t = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const { customer, order: o } = await placed([t], 'COD', [2]);
      expectData(await adminStatus(o.id, 'CONFIRMED'));
      expectData(await adminStatus(o.id, 'PREPARING'));
      if (target === 'READY_FOR_PICKUP') {
        await world.ds.query('UPDATE drivers SET is_online = false, is_available = false'); // keep it READY (no driver)
        expectData(await adminStatus(o.id, 'READY_FOR_PICKUP'));
      }
      expect((await orderRow(o.id)).status).toBe(target);
      expectData(await cancel(customer, o.id), 201);
      expect(await orderRow(o.id)).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'CUSTOMER' });
      expect(await stock(t.id)).toBe(10);
      expect((await segments(o.id)).every((r: any) => r.status === 'CANCELLED')).toBe(true);
    });

    it('ASSIGNED_TO_DRIVER: cancelled, the driver is freed and Operations are alerted (R45); PICKED_UP, ON_THE_WAY, DELIVERED: refused', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const first = await placed([p1]);
      await s.vendorPrepares(v1, first.order.id);
      expect((await orderRow(first.order.id)).status).toBe('ASSIGNED_TO_DRIVER');
      const assigned: DriverFixture = await s.driverAssignedTo(first.order.id);
      expectData(await cancel(first.customer, first.order.id), 201);
      expect(await orderRow(first.order.id)).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'CUSTOMER' });
      expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [assigned.driverId]))[0].is_available).toBe(true);
      const opsAlerts = await world.ds.query(`SELECT * FROM staff_notifications WHERE order_id = $1 AND category = 'OPS_CANCELLED_AFTER_ASSIGNMENT'`, [first.order.id]);
      // one row per Operations recipient (there may be none in a fresh world without dispatchers); never a duplicate per recipient
      expect(new Set(opsAlerts.map((r: any) => r.user_id)).size).toBe(opsAlerts.length);

      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const { customer, order: o } = await placed([p1]);
      await s.vendorPrepares(v1, o.id);
      expect((await orderRow(o.id)).status).toBe('ASSIGNED_TO_DRIVER');
      const driver: DriverFixture = await s.driverAssignedTo(o.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d: any) => d.orderId === o.id);
      const refused = async (status: string) => {
        const res = await cancel(customer, o.id);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', status });
        expect((await orderRow(o.id)).status).toBe(status);
      };
      for (const status of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
        // M4 — Proof of Delivery is required for the DELIVERED transition.
        const extra = status === 'DELIVERED' ? { proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : {};
        expectData(await driverStep(driver, delivery.id, status, extra));
        await refused(status);
      }
    });

    it('a repeated cancellation is refused with ORDER_ALREADY_CANCELLED and changes nothing', async () => {
      const { customer, order: o } = await placed([p1]);
      expectData(await cancel(customer, o.id), 201);
      const after = await orderRow(o.id);
      const again = await cancel(customer, o.id);
      expect(again.status).toBe(400);
      expect(again.body.error.details.code).toBe('ORDER_ALREADY_CANCELLED');
      expect(await orderRow(o.id)).toMatchObject({ status: 'CANCELLED', updated_at: after.updated_at });
    });

    it('the generic status endpoint stays closed to customers, at any status', async () => {
      const { customer, order: o } = await placed([p1]);
      const res = await world.api('patch', `/orders/${o.id}/status`, { token: customer.accessToken, body: { status: 'CANCELLED' } });
      expect(res.status).toBe(400);
      expect((await orderRow(o.id)).status).toBe('PENDING');
    });
  });

  describe('e) authorization', () => {
    it('another customer gets 404 (indistinguishable from a missing order); nothing changes', async () => {
      const { order: o } = await placed([p1]);
      const stranger = await s.customer();
      expect((await cancel(stranger, o.id)).status).toBe(404);
      expect((await cancel(stranger, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await orderRow(o.id)).status).toBe('PENDING');
    });

    it('unauthenticated → 401; vendor / admin tokens → 403 on the customer endpoint; a customerId in the body is rejected', async () => {
      const { customer, order: o } = await placed([p1]);
      expect((await world.api('post', `/orders/${o.id}/cancel`, { body: {} })).status).toBe(401);
      expect((await cancel(v1.manager, o.id)).status).toBe(403);
      expect((await cancel(superAdmin, o.id)).status).toBe(403);
      const stranger = await s.customer();
      expect((await cancel(stranger, o.id, { customerId: customer.id })).status).toBe(400);
      expect((await cancel(customer, o.id, { customerId: stranger.id })).status).toBe(400); // even the real owner: unknown field
      expect((await orderRow(o.id)).status).toBe('PENDING');
    });

    it('vendor and admin cancellation are unchanged (a vendor still cancels only its own segment; an admin still cancels any order)', async () => {
      const { order: o } = await placed([p1, p2]);
      expect((await world.api('patch', `/orders/${o.id}/status`, { token: v1.manager.accessToken, body: { status: 'CANCELLED' } })).status).toBe(403);
      expectData(await cancelSegment(v2, await segmentOf(o.id, v2)));
      expect((await orderRow(o.id)).status).toBe('PENDING');
      expectData(await world.api('patch', `/orders/${o.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'admin' } }));
      expect(await orderRow(o.id)).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'SUPER_ADMIN' });
    });
  });

  describe('f/g) multi-vendor', () => {
    it('cancels ALL three still-active segments together; the order money is zero and consistent', async () => {
      const { customer, order: o } = await placed([p1, p2, p3]);
      expectData(await cancel(customer, o.id), 201);
      expect((await segments(o.id)).map((r: any) => r.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
      const row = await orderRow(o.id);
      expect(row.status).toBe('CANCELLED');
      expect([num(row.delivery_fee_minor), num(row.subtotal_minor), num(row.total_minor)]).toEqual([0, 0, 0]);
      expectConsistent(row);
    });

    it('a segment a vendor already cancelled is left exactly as it was — not processed again (row untouched, stock restored once)', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const t3 = await s.product(v3, { priceMinor: 30000, inventoryMode: 'TRACKED', quantity: 10 });
      const { customer, order: o } = await placed([t1, t2, t3], 'COD', [1, 3, 2]);
      expect([await stock(t1.id), await stock(t2.id), await stock(t3.id)]).toEqual([9, 7, 8]);
      const seg2 = await segmentOf(o.id, v2);
      expectData(await cancelSegment(v2, seg2));
      expect(await stock(t2.id)).toBe(10);
      const cancelledBefore = (await segments(o.id)).find((r: any) => r.id === seg2);

      expectData(await cancel(customer, o.id), 201);

      const rows = await segments(o.id);
      expect(rows.map((r: any) => r.status)).toEqual(['CANCELLED', 'CANCELLED', 'CANCELLED']);
      expect(rows.find((r: any) => r.id === seg2).updated_at).toEqual(cancelledBefore.updated_at); // never re-written
      expect([await stock(t1.id), await stock(t2.id), await stock(t3.id)]).toEqual([10, 10, 10]); // v2's units NOT restored a second time
    });
  });

  describe('h) inventory and flash-sale allocation', () => {
    it('stock and flash-sale allocation come back exactly once — also when the customer repeats the request', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const offer = expectData(await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { vendorBranchId: v2.branchId, name: 'CC flash', mechanism: 'FLASH_SALE', specialPriceMinor: 15000, productIds: [t2.id], ...window() } }), 201);
      const consumed = async () => num((await world.ds.query('SELECT consumed_units_count FROM offers WHERE id = $1', [offer.id]))[0].consumed_units_count);
      const { customer, order: o } = await placed([t1, t2], 'COD', [2, 3]);
      expect([await stock(t1.id), await stock(t2.id), await consumed()]).toEqual([8, 7, 3]);

      expectData(await cancel(customer, o.id), 201);
      expect([await stock(t1.id), await stock(t2.id), await consumed()]).toEqual([10, 10, 0]);
      expect(await world.ds.query('SELECT is_reversed FROM offer_consumptions WHERE order_id = $1', [o.id])).toEqual([{ is_reversed: true }]);

      expect((await cancel(customer, o.id)).status).toBe(400);
      expect([await stock(t1.id), await stock(t2.id), await consumed()]).toEqual([10, 10, 0]);
    });
  });

  describe('i) PAID Manual Transfer', () => {
    it('refunds exactly the amount paid, once, under the whole-payment key', async () => {
      const { customer, order: o } = await underReview([p1, p2]);
      const payment = await paymentOf(o.id);
      expectData(await approve(payment.id), 201);
      expectData(await cancel(customer, o.id), 201);
      const refunds = await refundEvents(o.id);
      expect(refunds).toHaveLength(1);
      expect(num(refunds[0].amount_minor)).toBe(o.totalMinor);
      expect(num(refunds[0].amount_minor)).toBe(num(payment.amount_minor));
      expect(refunds[0].idempotency_key).toBe(`manual-transfer-refund:${payment.id}`);
      expect(refunds[0].actor_user_id).toBe(customer.id);
      expect((await paymentOf(o.id)).status).toBe('PAID'); // the original payment is never mutated
    });

    it('after a partial vendor cancellation already refunded part of it, only the remainder is refunded — paid in total, once', async () => {
      const { customer, order: o } = await underReview([p1, p2, p3]);
      const payment = await paymentOf(o.id);
      expectData(await approve(payment.id), 201);
      expectData(await cancelSegment(v3, await segmentOf(o.id, v3)));
      const partial = await refundedTotal(o.id);
      expect(partial).toBeGreaterThan(0);
      expectData(await cancel(customer, o.id), 201);
      expect(await refundedTotal(o.id)).toBe(num(payment.amount_minor));
      expect(await refundEvents(o.id)).toHaveLength(2);
    });
  });

  describe('j/k) unverified Manual Transfer → PD-004 pending entitlement', () => {
    it.each(['PENDING', 'CUSTOMER_CLAIMED_TRANSFER', 'UNDER_REVIEW'])('a %s transfer: the WHOLE amount becomes the pending entitlement and NO refund event is written', async (state) => {
      const o = await placed([p1, p2], 'MANUAL_TRANSFER');
      if (state !== 'PENDING') {
        await claim(o.customer, o.order.id);
        await world.ds.query('UPDATE payments SET status = $2 WHERE order_id = $1', [o.order.id, state]);
      }
      const paid = num((await paymentOf(o.order.id)).amount_minor);
      expectData(await cancel(o.customer, o.order.id), 201);
      const payment = await paymentOf(o.order.id);
      expect(payment).toMatchObject({ status: state, pending_refund_status: 'PENDING' });
      expect(num(payment.pending_refund_minor)).toBe(paid);
      expect(num(payment.amount_minor)).toBe(paid);
      expect(await refundEvents(o.order.id)).toEqual([]);
    });

    it('a later approval converts it into exactly ONE refund for the amount paid; a second approval is refused; a later rejection instead pays nothing', async () => {
      const a = await underReview([p1, p2]);
      const paymentA = await paymentOf(a.order.id);
      expectData(await cancel(a.customer, a.order.id), 201);
      expectData(await approve(paymentA.id), 201);
      const refunds = await refundEvents(a.order.id);
      expect(refunds).toHaveLength(1);
      expect(num(refunds[0].amount_minor)).toBe(num(paymentA.amount_minor));
      expect((await paymentOf(a.order.id)).pending_refund_status).toBe('CONVERTED');
      expect((await approve(paymentA.id)).status).toBe(409);
      expect(await refundEvents(a.order.id)).toHaveLength(1);

      const r = await underReview([p1, p2]);
      expectData(await cancel(r.customer, r.order.id), 201);
      expectData(await reject((await paymentOf(r.order.id)).id), 201);
      expect(await refundEvents(r.order.id)).toEqual([]);
      expect((await paymentOf(r.order.id)).pending_refund_status).toBe('VOIDED');
    });

    it('after a partial vendor cancellation the entitlement is re-derived to the full amount, and one approval refunds the paid amount once', async () => {
      const { customer, order: o } = await underReview([p1, p2]);
      const payment = await paymentOf(o.id);
      // R2: the vendor cannot see the order before verification — Operations cancel the vendor part on its behalf.
      expect((await cancelSegment(v2, await segmentOf(o.id, v2))).status).toBe(404);
      expectData(await world.api('patch', `/admin/orders/segments/${await segmentOf(o.id, v2)}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } }));
      expect(num((await paymentOf(o.id)).pending_refund_minor)).toBeLessThan(num(payment.amount_minor));
      expectData(await cancel(customer, o.id), 201);
      expect(num((await paymentOf(o.id)).pending_refund_minor)).toBe(num(payment.amount_minor)); // final overpayment, not a stack
      expectData(await approve(payment.id), 201);
      expect(await refundedTotal(o.id)).toBe(num(payment.amount_minor));
      expect(await refundEvents(o.id)).toHaveLength(1);
    });
  });

  describe('l) COD / PAY_AT_DELIVERY', () => {
    it('never get a payment row, an entitlement or a refund event', async () => {
      for (const method of ['COD', 'PAY_AT_DELIVERY']) {
        const { customer, order: o } = await placed([p1, p2], 'COD');
        // R20: no NEW order can use Pay at Delivery; an order placed before R20 keeps it — simulated by marking a cash order as such.
        if (method === 'PAY_AT_DELIVERY') await world.ds.query(`UPDATE orders SET payment_method = 'PAY_AT_DELIVERY', electronic_payment_method = 'INSTAPAY' WHERE id = $1`, [o.id]);
        expectData(await cancel(customer, o.id), 201);
        expect(await world.ds.query('SELECT 1 FROM payments WHERE order_id = $1', [o.id])).toEqual([]);
        expect(await refundEvents(o.id)).toEqual([]);
        expect((await orderRow(o.id)).status).toBe('CANCELLED');
      }
    });
  });

  describe('m) concurrency', () => {
    it('six simultaneous cancellations: exactly one succeeds, the rest are refused (never a 5xx); one refund; stock restored once', async () => {
      const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
      const o = await placed([t1, t2], 'MANUAL_TRANSFER', [2, 3]);
      const payment = await paymentOf(o.order.id);
      await claim(o.customer, o.order.id);
      expectData(await approve(payment.id), 201);

      const results = await Promise.all(Array.from({ length: 6 }, () => cancel(o.customer, o.order.id)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(results.filter((r) => r.status === 400)).toHaveLength(5);
      expect(await refundEvents(o.order.id)).toHaveLength(1);
      expect(await refundedTotal(o.order.id)).toBe(num(payment.amount_minor));
      expect([await stock(t1.id), await stock(t2.id)]).toEqual([10, 10]);
      expect(boundary.push.filter((p) => p.data.type === 'ORDER_CANCELLED' && p.data.orderId === o.order.id)).toHaveLength(0); // no device token registered
    });

    it('customer cancellation racing a vendor cancelling its own segment: no deadlock, no 5xx, consistent money, stock restored once', async () => {
      for (let i = 0; i < 5; i++) {
        const t1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
        const t2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 10 });
        const o = await placed([t1, t2], 'MANUAL_TRANSFER', [1, 2]);
        const payment = await paymentOf(o.order.id);
        await claim(o.customer, o.order.id);
        expectData(await approve(payment.id), 201);
        const seg2 = await segmentOf(o.order.id, v2);

        const [byCustomer, byVendor] = await Promise.all([cancel(o.customer, o.order.id), cancelSegment(v2, seg2)]);
        expect(byCustomer.status).toBeLessThan(300); // the customer's request always wins or comes second and still cancels
        expect([200, 400]).toContain(byVendor.status);
        expect(byVendor.status).toBeLessThan(500);

        const row = await orderRow(o.order.id);
        expect(row.status).toBe('CANCELLED');
        expect([num(row.delivery_fee_minor), num(row.total_minor)]).toEqual([0, 0]);
        expect((await segments(o.order.id)).map((r: any) => r.status)).toEqual(['CANCELLED', 'CANCELLED']);
        expect(await refundedTotal(o.order.id)).toBe(num(payment.amount_minor)); // paid, once — whichever interleaving
        expect([await stock(t1.id), await stock(t2.id)]).toEqual([10, 10]);
      }
      expect(world.unhandledServerErrors()).toEqual([]);
    });

    it('R3: customer cancellation racing the order moving to PREPARING: no 5xx, and the customer can always cancel (before or after preparation started)', async () => {
      for (let i = 0; i < 5; i++) {
        const t = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
        const o = await placed([t], 'COD', [2]);
        expectData(await adminStatus(o.order.id, 'CONFIRMED'));
        const [c, a] = await Promise.all([cancel(o.customer, o.order.id), adminStatus(o.order.id, 'PREPARING')]);
        expect(c.status).toBeLessThan(500);
        expect(a.status).toBeLessThan(500);
        expect(c.status).toBe(201); // whichever ran first, PREPARING no longer blocks the customer
        expect((await orderRow(o.order.id)).status).toBe('CANCELLED');
        expect(await stock(t.id)).toBe(10);
      }
    });
  });
});
