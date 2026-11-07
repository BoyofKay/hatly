/**
 * Decision register release 2 (2026-11-07):
 *  - R21: an InstaPay / Vodafone Cash order whose money is not verified within MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES is cancelled
 *    automatically, stock released; money arriving later is refunded on approval and the order is never reactivated. Unset = off.
 *  - R20: no new Pay-at-Delivery order (the quote never offers it; the order is refused).
 *  - R3: Operations can cancel an order whose driver is assigned but has not picked up (the driver is freed).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { ManualTransferExpiryService } from '../../src/modules/admin-platform/orders/manual-transfer-expiry.service';
import { withQuoteToken } from './support/actors';

describe('E2E — transfer verification window (R21), Pay-at-Delivery retired (R20), Operations cancel at ASSIGNED (R3)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let tracked: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const orderRow = async (id: string) => (await q('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await q('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const stock = async (productId: string) => Number((await q('SELECT quantity FROM products WHERE id = $1', [productId]))[0].quantity);
  const sweep = () => world.app.get(ManualTransferExpiryService).cancelExpired();
  const age = (orderId: string, minutes: number) => q(`UPDATE orders SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [orderId, minutes]);
  const transferOrder = async (quantity = 1) => {
    const c = await s.customer();
    await s.addToCart(c, tracked.id, quantity);
    return { c, order: await s.checkout(c, home, 'MANUAL_TRANSFER') };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'Expiry Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    tracked = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 100 });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  beforeEach(async () => {
    boundary.reset();
    await q("DELETE FROM business_config WHERE key = 'MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES'");
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('R21 — transfer verification window', () => {
    it('unset (default): nothing is ever cancelled automatically, however old the order', async () => {
      const { order } = await transferOrder();
      await age(order.id, 60 * 24 * 30);
      expect(await sweep()).toEqual({ cancelled: [], skipped: 0 });
      expect((await orderRow(order.id)).status).toBe('PENDING');
      // isolation: this deliberately ancient order must not be picked up by the next test's sweep
      expect((await world.api('post', `/admin/orders/${order.id}/cancel`, { token: superAdmin.accessToken, body: { reasonCode: 'OTHER', reasonText: 'test cleanup' } })).status).toBeLessThan(300);
    });

    it('only whole minutes from 15 to 10080 are accepted, and the setting can be cleared', async () => {
      for (const value of [10, 10081, 30.5, '60']) {
        const res = await world.api('put', '/admin/business-config/MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES', { token: superAdmin.accessToken, body: { value } });
        expect(res.status).toBe(400);
      }
      expectData(await world.api('put', '/admin/business-config/MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES', { token: superAdmin.accessToken, body: { value: 60 } }));
      const cleared = await world.api('delete', '/admin/business-config/MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES', { token: superAdmin.accessToken });
      expect(cleared.status).toBeLessThan(300);
      expect(await q("SELECT 1 FROM business_config WHERE key = 'MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES'")).toHaveLength(0);
    });

    it('past the window an unverified order (pending, claimed or under review) is cancelled, stock comes back, nothing is refunded yet', async () => {
      await s.setConfig('MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES', 30);
      const before = await stock(tracked.id);
      const pending = await transferOrder(2);
      const claimed = await transferOrder(1);
      expectData(await world.api('post', `/payments/manual-transfer/orders/${claimed.order.id}/claim`, { token: claimed.c.accessToken, body: {} }), 201);
      const fresh = await transferOrder(1);
      expect(await stock(tracked.id)).toBe(before - 4);
      await age(pending.order.id, 31);
      await age(claimed.order.id, 45);
      await age(fresh.order.id, 10); // still within the window

      const result = await sweep();
      expect(result.cancelled.sort()).toEqual([pending.order.id, claimed.order.id].sort());
      for (const o of [pending, claimed]) {
        const row = await orderRow(o.order.id);
        expect(row).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'ADMIN' });
        expect(row.cancellation_reason).toContain('PAYMENT_NOT_VERIFIED');
        expect((await paymentOf(o.order.id)).status).not.toBe('PAID');
      }
      expect((await orderRow(fresh.order.id)).status).toBe('PENDING');
      expect(await stock(tracked.id)).toBe(before - 1); // the two cancelled orders' 3 units are back
      expect(await q("SELECT 1 FROM financial_events WHERE order_id = ANY($1) AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [[pending.order.id, claimed.order.id]])).toHaveLength(0);

      expect(await sweep()).toEqual({ cancelled: [], skipped: 0 }); // idempotent
    });

    it('money that arrives after the cancellation: approval refunds it once — the order stays cancelled', async () => {
      await s.setConfig('MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES', 30);
      const { c, order } = await transferOrder();
      expectData(await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} }), 201);
      await age(order.id, 31);
      await sweep();
      const payment = await paymentOf(order.id);
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      const refunds = await q("SELECT amount_minor FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [order.id]);
      expect(refunds).toHaveLength(1);
      expect(Number(refunds[0].amount_minor)).toBe(Number(payment.amount_minor));
    });

    it('a verified (PAID) or rejected transfer is never touched by the window', async () => {
      await s.setConfig('MANUAL_TRANSFER_VERIFICATION_WINDOW_MINUTES', 30);
      const paid = await transferOrder();
      const rejected = await transferOrder();
      for (const o of [paid, rejected]) expectData(await world.api('post', `/payments/manual-transfer/orders/${o.order.id}/claim`, { token: o.c.accessToken, body: {} }), 201);
      expectData(await world.api('post', `/admin/manual-transfer-payments/${(await paymentOf(paid.order.id)).id}/approve`, { token: reviewer.accessToken }), 201);
      expectData(await world.api('post', `/admin/manual-transfer-payments/${(await paymentOf(rejected.order.id)).id}/reject`, { token: reviewer.accessToken, body: { reason: 'no money' } }), 201);
      await age(paid.order.id, 120);
      await age(rejected.order.id, 120);
      expect((await sweep()).cancelled).not.toEqual(expect.arrayContaining([paid.order.id]));
      expect((await orderRow(paid.order.id)).status).not.toBe('CANCELLED');
      expect((await orderRow(rejected.order.id)).status).not.toBe('CANCELLED');
    });
  });

  describe('R20 — Pay at Delivery is not offered for new orders', () => {
    it('the quote never offers it and placing an order with it is refused; nothing is created', async () => {
      const c = await s.customer();
      await s.addToCart(c, tracked.id, 1);
      const address = { line1: 'R20 Street 1', latitude: home.lat, longitude: home.lng };
      const quote = expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } }), 201);
      expect(quote.payment.options.payAtDelivery).toBe(false);
      const before = Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [c.id]))[0].n);
      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: await withQuoteToken(world, c.accessToken, { deliveryAddress: address, paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'INSTAPAY' }),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('PAY_AT_DELIVERY_NOT_AVAILABLE');
      expect(Number((await q('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [c.id]))[0].n)).toBe(before);
    });
  });

  describe('R3 — Operations cancel before pickup', () => {
    it('an order with an assigned driver (not picked up) can be cancelled from the admin order page; the driver is freed', async () => {
      await q('UPDATE drivers SET is_online = false, is_available = false');
      const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
      const c = await s.customer();
      await s.addToCart(c, tracked.id, 1);
      const order = await s.checkout(c, home, 'COD');
      await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', true);
      await s.vendorPrepares(v1, order.id);
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
      const ops = await s.admin([Permission.MANAGE_ORDER_ISSUES]);
      const res = await world.api('post', `/admin/orders/${order.id}/cancel`, { token: ops.accessToken, body: { reasonCode: 'CUSTOMER_REQUEST', reasonText: 'customer called' } });
      expect(res.status).toBeLessThan(300);
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      expect((await q('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(true);
    });
  });
});
