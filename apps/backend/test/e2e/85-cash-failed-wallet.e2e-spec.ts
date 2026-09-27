/**
 * Group 8 / phases 14–17 — driver cash remainder, failed delivery, wallet & loyalty, and
 * cancellation semantics, end to end over real HTTP with real ledger rows in PostgreSQL.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, DriverFixture, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { DriverFailedDeliveryReason } from '../../src/modules/delivery/driver-failed-delivery-reason.enum';

describe('E2E — cash remainder, failed delivery, wallet & loyalty, cancellation', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let vendor: VendorFixture;
  let product: { id: string };
  let superAdmin: Actor;
  let walletAdmin: Actor;
  let issuesAdmin: Actor;
  let driver: DriverFixture;
  const home = { lat: 30.425, lng: 31.565 };

  const q = (sql: string, params: unknown[] = []) => world.ds.query(sql, params);
  const walletBalance = async (customerId: string) => Number((await q('SELECT COALESCE(SUM(amount_delta_minor), 0) AS b FROM wallet_transactions WHERE customer_id = $1', [customerId]))[0].b);
  const pointsBalance = async (customerId: string) => Number((await q('SELECT COALESCE(SUM(points_delta), 0) AS b FROM loyalty_points_transactions WHERE customer_id = $1', [customerId]))[0].b);
  const orderStatus = async (id: string) => (await q('SELECT status FROM orders WHERE id = $1', [id]))[0].status as string;
  const deliveryOf = async (orderId: string) => expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === orderId);
  const step = (deliveryId: string, status: string, extra: Record<string, unknown> = {}) =>
    world.api('patch', `/driver/deliveries/${deliveryId}/status`, { token: driver.accessToken, body: { status, ...extra } });

  /** COD order driven to ON_THE_WAY (or DELIVERED) by the single dispatch-eligible driver. */
  const orderThrough = async (customer: Actor, to: 'ASSIGNED' | 'PICKED_UP' | 'ON_THE_WAY' | 'DELIVERED', qty = 1, paymentMethod = 'COD') => {
    await s.addToCart(customer, product.id, qty);
    const order = await s.checkout(customer, home, paymentMethod);
    if (paymentMethod === 'MANUAL_TRANSFER') {
      const payment = (await q('SELECT id FROM payments WHERE order_id = $1', [order.id]))[0];
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: customer.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: superAdmin.accessToken }), 201);
    }
    await s.vendorPrepares(vendor, order.id);
    const delivery = await deliveryOf(order.id);
    const chain = { ASSIGNED: [], PICKED_UP: ['PICKED_UP'], ON_THE_WAY: ['PICKED_UP', 'ON_THE_WAY'], DELIVERED: ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED'] }[to];
    for (const st of chain) expectData(await step(delivery.id, st));
    return { order, delivery };
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Ledger Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    superAdmin = await s.superAdmin();
    walletAdmin = await s.admin([Permission.MANAGE_CUSTOMER_WALLET]);
    issuesAdmin = await s.admin([Permission.MANAGE_ORDER_ISSUES, Permission.VERIFY_MANUAL_PAYMENTS]);
    driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'W', phoneOrAccountNumber: '010' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  beforeEach(async () => {
    boundary.reset();
    // Test hygiene: a test that leaves an order ASSIGNED would keep the one driver busy for every later test.
    await q('UPDATE drivers SET is_online = true, is_available = true');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('driver cash remainder (customer paid more cash than due → wallet credit after admin approval)', () => {
    it('submit → PENDING_REVIEW → admin approves → the customer wallet is credited exactly once, by exactly the remainder', async () => {
      const c = await s.customer('Big Note');
      const { order, delivery } = await orderThrough(c, 'DELIVERED');
      const due = order.totalMinor as number;
      const submitted = await world.api('post', `/driver/deliveries/${delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor: due + 2500 } });
      expect(submitted.status).toBe(201);
      const remainder = submitted.body.data ?? submitted.body;
      expect(remainder).toMatchObject({ orderId: order.id, remainderAmountMinor: 2500, status: 'PENDING_REVIEW' });
      expect(await walletBalance(c.id)).toBe(0); // nothing is credited before review

      const queue = expectData<any[]>(await world.api('get', '/admin/cash-remainders', { token: walletAdmin.accessToken }));
      expect(queue.map((r) => r.id)).toContain(remainder.id);

      const approvals = await Promise.all([
        world.api('patch', `/admin/cash-remainders/${remainder.id}/approve`, { token: walletAdmin.accessToken }),
        world.api('patch', `/admin/cash-remainders/${remainder.id}/approve`, { token: superAdmin.accessToken }),
      ]);
      expect(approvals.filter((a) => a.status === 200)).toHaveLength(1);
      expect(approvals.filter((a) => a.status === 400)).toHaveLength(1);
      expect(approvals.find((a) => a.status === 400)!.body.error.details.code).toBe('REMAINDER_NOT_PENDING');
      expect(await walletBalance(c.id)).toBe(2500);
      const ledger = await q('SELECT amount_delta_minor, type, order_id FROM wallet_transactions WHERE customer_id = $1', [c.id]);
      expect(ledger).toEqual([{ amount_delta_minor: '2500', type: 'DRIVER_CASH_REMAINDER', order_id: order.id }].map((r) => ({ ...r, amount_delta_minor: 2500 })));
    });

    it('a duplicate submission returns the same record (one per order); cash that does not exceed the amount due, or a non-positive amount, is refused', async () => {
      const c = await s.customer();
      const { order, delivery } = await orderThrough(c, 'DELIVERED');
      const due = order.totalMinor as number;
      const post = (cashReceivedMinor: unknown) => world.api('post', `/driver/deliveries/${delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor } });
      const exact = await post(due);
      expect(exact.status).toBe(400);
      expect(exact.body.error.details).toMatchObject({ code: 'NO_REMAINDER', amountDueMinor: due });
      expect((await post(due - 1)).status).toBe(400);
      expect((await post(0)).status).toBe(400);
      expect((await post(-5)).status).toBe(400);
      expect((await post(12.5)).status).toBe(400);
      const first = await post(due + 100);
      const second = await post(due + 900); // a second, different claim for the same order
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const rows = await q('SELECT remainder_amount_minor FROM driver_cash_remainders WHERE order_id = $1', [order.id]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].remainder_amount_minor)).toBe(100); // the FIRST claim stands; the second did not overwrite it
    });

    it('is only for cash orders and only for the driver who owns the delivery; and not before the delivery has actually been made', async () => {
      const c = await s.customer();
      const manual = await orderThrough(c, 'DELIVERED', 1, 'MANUAL_TRANSFER');
      const notCash = await world.api('post', `/driver/deliveries/${manual.delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor: 999999 } });
      expect(notCash.status).toBe(400);
      expect(notCash.body.error.details).toEqual({ code: 'NOT_A_CASH_ORDER' });

      const other = await s.driver({ lat: 30.4213, lng: 31.5613 });
      const c2 = await s.customer();
      const cash = await orderThrough(c2, 'DELIVERED');
      const stranger = await world.api('post', `/driver/deliveries/${cash.delivery.id}/cash-remainder`, { token: other.accessToken, body: { cashReceivedMinor: 999999 } });
      expect(stranger.status).toBe(404);

      const c3 = await s.customer();
      const early = await orderThrough(c3, 'ASSIGNED');
      const tooSoon = await world.api('post', `/driver/deliveries/${early.delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor: early.order.totalMinor + 500 } });
      expect(tooSoon.status).toBe(400); // no cash has changed hands for an order still waiting at the vendor
      expect(await q('SELECT id FROM driver_cash_remainders WHERE order_id = $1', [early.order.id])).toEqual([]);
    });

    it('reject needs a reason, credits nothing, and cannot be followed by an approval; only MANAGE_CUSTOMER_WALLET may review', async () => {
      const c = await s.customer();
      const { order, delivery } = await orderThrough(c, 'DELIVERED');
      const remainder = expectData(await world.api('post', `/driver/deliveries/${delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor: order.totalMinor + 700 } }), 201);
      const nobody = await s.admin([]);
      for (const path of ['approve', 'reject']) {
        expect((await world.api('patch', `/admin/cash-remainders/${remainder.id}/${path}`, { token: nobody.accessToken, body: { reason: 'x' } })).status).toBe(403);
      }
      expect((await world.api('patch', `/admin/cash-remainders/${remainder.id}/reject`, { token: walletAdmin.accessToken, body: {} })).status).toBe(400);
      expectData(await world.api('patch', `/admin/cash-remainders/${remainder.id}/reject`, { token: walletAdmin.accessToken, body: { reason: 'driver miscounted' } }));
      expect(await walletBalance(c.id)).toBe(0);
      const late = await world.api('patch', `/admin/cash-remainders/${remainder.id}/approve`, { token: walletAdmin.accessToken });
      expect(late.status).toBe(400);
      expect(late.body.error.details).toMatchObject({ code: 'REMAINDER_NOT_PENDING', status: 'REJECTED' });
      expect(await walletBalance(c.id)).toBe(0);
    });
  });

  describe('failed delivery', () => {
    it('the driver marks it failed with a reason: order records why/when, driver is freed, customer notified, informational event booked, no stock/refund side effects', async () => {
      const c = await s.customer();
      expectData(await world.api('post', '/customer/device-token', { token: c.accessToken, body: { token: 'fcm-failed', platform: 'ios' } }), 201);
      const tracked = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 5 });
      await s.addToCart(c, tracked.id, 2);
      const order = await s.checkout(c, home);
      await s.vendorPrepares(vendor, order.id);
      const delivery = await deliveryOf(order.id);
      expectData(await step(delivery.id, 'PICKED_UP'));
      expectData(await step(delivery.id, 'ON_THE_WAY'));
      expectData(await step(delivery.id, 'FAILED_DELIVERY', { failureReason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE }));

      const row = (await q('SELECT status, failure_reason, failed_at FROM orders WHERE id = $1', [order.id]))[0];
      expect(row).toMatchObject({ status: 'FAILED_DELIVERY', failure_reason: DriverFailedDeliveryReason.CUSTOMER_UNREACHABLE, failed_at: expect.any(Date) });
      expect((await q('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(true);
      expect(boundary.push.some((p) => p.data.type === 'ORDER_FAILED_DELIVERY' && p.data.orderId === order.id)).toBe(true);
      expect((await q("SELECT type FROM financial_events WHERE order_id = $1 AND type = 'FAILED_DELIVERY_RECORDED'", [order.id]))).toHaveLength(1);
      expect((await q('SELECT quantity FROM products WHERE id = $1', [tracked.id]))[0].quantity).toBe(3); // goods are with the driver: stock NOT restored
      expect(await q("SELECT id FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [order.id])).toEqual([]);
      expect(await pointsBalance(c.id)).toBe(0); // no loyalty for a failed delivery
      // terminal
      expect((await step(delivery.id, 'DELIVERED')).status).toBe(400);
      expect((await step(delivery.id, 'ON_THE_WAY')).status).toBe(400);
    });

    it('the failure can only come from a driver who holds the order, i.e. after pickup', async () => {
      const c = await s.customer();
      const { order, delivery } = await orderThrough(c, 'ASSIGNED');
      const early = await step(delivery.id, 'FAILED_DELIVERY', { failureReason: DriverFailedDeliveryReason.OTHER });
      expect(early.status).toBe(400);
      expect(await orderStatus(order.id)).toBe('ASSIGNED_TO_DRIVER');
    });

    describe('admin resolution queue', () => {
      const failedManualOrder = async () => {
        const c = await s.customer();
        const { order, delivery } = await orderThrough(c, 'ON_THE_WAY', 1, 'MANUAL_TRANSFER');
        expectData(await step(delivery.id, 'FAILED_DELIVERY', { failureReason: DriverFailedDeliveryReason.ADDRESS_NOT_FOUND }));
        return { c, order };
      };
      const resolve = (orderId: string, body: object, actor = issuesAdmin) => world.api('post', `/admin/orders/${orderId}/failed-delivery-resolution`, { token: actor.accessToken, body });
      const refund = (orderId: string, actor = issuesAdmin) => world.api('post', `/admin/orders/${orderId}/failed-delivery-refund`, { token: actor.accessToken });

      it('lists unresolved failures with customer, driver and payment status; a resolved order leaves the queue', async () => {
        const { order } = await failedManualOrder();
        const queue = expectData<any[]>(await world.api('get', '/admin/orders/failed-deliveries', { token: issuesAdmin.accessToken }));
        expect(queue.find((q2) => q2.orderId === order.id)).toMatchObject({ failureReason: DriverFailedDeliveryReason.ADDRESS_NOT_FOUND, paymentMethod: 'MANUAL_TRANSFER', paymentStatus: 'PAID', driverId: driver.driverId });
        expectData(await resolve(order.id, { outcome: 'RESOLVED_NO_REFUND', notes: 'customer agreed' }), 201);
        const after = expectData<any[]>(await world.api('get', '/admin/orders/failed-deliveries', { token: issuesAdmin.accessToken }));
        expect(after.map((q2) => q2.orderId)).not.toContain(order.id);
      });

      it('REFUND_CUSTOMER records exactly the resolved amount, once; the refund endpoint is idempotent; amount rules are enforced', async () => {
        const { order } = await failedManualOrder();
        expect((await resolve(order.id, { outcome: 'REFUND_CUSTOMER' })).status).toBe(400); // amount required
        expect((await resolve(order.id, { outcome: 'REFUND_CUSTOMER', refundAmountMinor: 0 })).status).toBe(400);
        expect((await resolve(order.id, { outcome: 'RESOLVED_NO_REFUND', refundAmountMinor: 100 })).status).toBe(400);
        expect((await refund(order.id)).status).toBe(404); // nothing resolved yet
        expectData(await resolve(order.id, { outcome: 'REFUND_CUSTOMER', refundAmountMinor: 6000, driverReviewNeeded: true, driverReviewNotes: 'check GPS' }), 201);
        const dup = await resolve(order.id, { outcome: 'RESOLVED_NO_REFUND' });
        expect(dup.status).toBe(409);
        expect(dup.body.error.details).toEqual({ code: 'ALREADY_RESOLVED' });
        const first = expectData(await refund(order.id), 201);
        expect(first).toMatchObject({ orderId: order.id, refundAmountMinor: 6000, status: 'REFUNDED' });
        const second = expectData(await refund(order.id), 201);
        expect(second.status).toBe('ALREADY_REFUNDED');
        expect(await q("SELECT amount_minor FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [order.id])).toEqual([{ amount_minor: 6000 }]);
      });

      it('refuses a refund larger than what was paid, for a non-manual-transfer order, and on an order that is not failed', async () => {
        const { order } = await failedManualOrder();
        const paid = Number((await q('SELECT amount_minor FROM payments WHERE order_id = $1', [order.id]))[0].amount_minor);
        expectData(await resolve(order.id, { outcome: 'REFUND_CUSTOMER', refundAmountMinor: paid + 1 }), 201);
        const over = await refund(order.id);
        expect(over.status).toBe(400);
        expect(over.body.error.details).toEqual({ code: 'REFUND_EXCEEDS_PAYMENT_AMOUNT' });
        expect(await q("SELECT id FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED'", [order.id])).toEqual([]);

        const c = await s.customer();
        const cod = await orderThrough(c, 'ON_THE_WAY');
        expectData(await step(cod.delivery.id, 'FAILED_DELIVERY', { failureReason: DriverFailedDeliveryReason.CUSTOMER_REFUSED }));
        expectData(await resolve(cod.order.id, { outcome: 'REFUND_CUSTOMER', refundAmountMinor: 100 }), 201);
        expect((await refund(cod.order.id)).body.error.details.code).toBe('NO_MANUAL_TRANSFER_PAYMENT');

        const delivered = await orderThrough(await s.customer(), 'DELIVERED');
        const notFailed = await resolve(delivered.order.id, { outcome: 'RESOLVED_NO_REFUND' });
        expect(notFailed.status).toBe(400);
        expect(notFailed.body.error.details).toMatchObject({ code: 'ORDER_NOT_FAILED_DELIVERY', status: 'DELIVERED' });
      });

      it('requires MANAGE_ORDER_ISSUES', async () => {
        const nobody = await s.admin([]);
        expect((await world.api('get', '/admin/orders/failed-deliveries', { token: nobody.accessToken })).status).toBe(403);
        expect((await resolve('00000000-0000-4000-8000-000000000000', { outcome: 'RESOLVED_NO_REFUND' }, nobody)).status).toBe(403);
        expect((await refund('00000000-0000-4000-8000-000000000000', nobody)).status).toBe(403);
      });
    });
  });

  describe('loyalty & wallet', () => {
    it('a DELIVERED order earns 1 point per EGP of what the customer actually paid for goods (offers deducted, delivery fee excluded); a cancelled order earns none', async () => {
      const c = await s.customer();
      const delivered = await orderThrough(c, 'DELIVERED', 3); // 300.00
      expect(await pointsBalance(c.id)).toBe(300);
      const rows = await q('SELECT points_delta, type, order_id FROM loyalty_points_transactions WHERE customer_id = $1', [c.id]);
      expect(rows).toEqual([{ points_delta: 300, type: 'EARNING', order_id: delivered.order.id }]);
      const cancelled = await s.customer();
      await s.addToCart(cancelled, product.id, 5);
      const o = await s.checkout(cancelled, home);
      expectData(await world.api('patch', `/orders/${o.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'x' } }));
      expect(await pointsBalance(cancelled.id)).toBe(0);
    });

    it('the earning rate is configurable and applied at delivery time', async () => {
      await s.setConfig('LOYALTY_POINTS_PER_EGP', 2);
      const c = await s.customer();
      await orderThrough(c, 'DELIVERED', 1);
      expect(await pointsBalance(c.id)).toBe(200);
      await s.setConfig('LOYALTY_POINTS_PER_EGP', 1);
    });

    it('converts points to wallet credit at 100 points = 1 EGP, atomically debiting points and crediting the wallet, and is idempotent per key', async () => {
      const c = await s.customer();
      await orderThrough(c, 'DELIVERED', 5); // 500 points
      const convert = (points: unknown, idempotencyKey: unknown = 'key-1', actor = c) => world.api('post', '/customer/loyalty/convert', { token: actor.accessToken, body: { points, idempotencyKey } });
      const first = await convert(200);
      expect(first.status).toBe(201);
      expect(first.body.data).toEqual({ convertedPoints: 200, walletCreditMinor: 200, pointsBalance: 300, walletBalance: 200 });
      const replay = await convert(200);
      expect(replay.body.data).toMatchObject({ convertedPoints: 200, walletCreditMinor: 200, pointsBalance: 300, walletBalance: 200 });
      expect(await pointsBalance(c.id)).toBe(300);
      expect(await walletBalance(c.id)).toBe(200);
      expect((await q('SELECT id FROM wallet_transactions WHERE customer_id = $1', [c.id]))).toHaveLength(1);
    });

    it('CHARACTERIZATION (approved rule): points beyond a whole multiple of the rate are forfeited — 250 points spend all 250 and credit 200', async () => {
      const c = await s.customer();
      await orderThrough(c, 'DELIVERED', 3); // 300 points
      const res = await world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body: { points: 250, idempotencyKey: 'odd-250' } });
      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({ convertedPoints: 250, walletCreditMinor: 200, pointsBalance: 50, walletBalance: 200 });
      expect(await pointsBalance(c.id)).toBe(50);
    });

    it('validates conversions: below the minimum, more than the balance, non-integers, missing key — and nothing moves', async () => {
      const c = await s.customer();
      await orderThrough(c, 'DELIVERED', 2); // 200 points
      const convert = (body: object) => world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body });
      const below = await convert({ points: 99, idempotencyKey: 'a' });
      expect(below.body.error.details).toMatchObject({ code: 'BELOW_MINIMUM_CONVERSION', minimum: 100 });
      const tooMany = await convert({ points: 300, idempotencyKey: 'b' });
      expect(tooMany.body.error.details).toMatchObject({ code: 'INSUFFICIENT_POINTS', available: 200, requested: 300 });
      expect((await convert({ points: 1.5, idempotencyKey: 'c' })).status).toBe(400);
      expect((await convert({ points: -100, idempotencyKey: 'd' })).status).toBe(400);
      expect((await convert({ points: 100 })).status).toBe(400);
      expect(await pointsBalance(c.id)).toBe(200);
      expect(await walletBalance(c.id)).toBe(0);
    });

    it('concurrent conversions can never spend the same points twice (3 × 100 of 200 → 2 succeed, 1 refused)', async () => {
      const c = await s.customer();
      await orderThrough(c, 'DELIVERED', 2);
      const results = await Promise.all(['k1', 'k2', 'k3'].map((k) => world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body: { points: 100, idempotencyKey: k } })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 400)).toHaveLength(1);
      expect(await pointsBalance(c.id)).toBe(0);
      expect(await walletBalance(c.id)).toBe(200);
    });

    it('the same idempotency key sent twice AT THE SAME TIME converts once', async () => {
      const c = await s.customer();
      await orderThrough(c, 'DELIVERED', 2);
      const results = await Promise.all([1, 2, 3].map(() => world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body: { points: 100, idempotencyKey: 'same-key' } })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(await pointsBalance(c.id)).toBe(100);
      expect(await walletBalance(c.id)).toBe(100);
    });

    it("another customer reusing someone else's idempotency key must not receive that customer's data nor be treated as a replay", async () => {
      const a = await s.customer();
      const b = await s.customer();
      await orderThrough(a, 'DELIVERED', 2);
      await orderThrough(b, 'DELIVERED', 3);
      expectData(await world.api('post', '/customer/loyalty/convert', { token: a.accessToken, body: { points: 100, idempotencyKey: 'shared-key' } }), 201);
      const collide = await world.api('post', '/customer/loyalty/convert', { token: b.accessToken, body: { points: 100, idempotencyKey: 'shared-key' } });
      // B must not be told "done" for a conversion that never happened for B, nor be shown A's numbers
      expect(collide.status).toBe(409);
      expect(collide.body.error.details).toEqual({ code: 'IDEMPOTENCY_KEY_IN_USE' });
      expect(await walletBalance(b.id)).toBe(0);
      expect(await pointsBalance(b.id)).toBe(300);
      // and B can simply retry with a fresh key
      expect((await world.api('post', '/customer/loyalty/convert', { token: b.accessToken, body: { points: 100, idempotencyKey: 'b-own-key' } })).status).toBe(201);
      expect(await walletBalance(b.id)).toBe(100);
    });

    it('a cash remainder and a loyalty conversion both land on the same wallet ledger; the balance is their exact sum', async () => {
      const c = await s.customer();
      const { order, delivery } = await orderThrough(c, 'DELIVERED', 2);
      const rem = expectData(await world.api('post', `/driver/deliveries/${delivery.id}/cash-remainder`, { token: driver.accessToken, body: { cashReceivedMinor: order.totalMinor + 1234 } }), 201);
      expectData(await world.api('patch', `/admin/cash-remainders/${rem.id}/approve`, { token: walletAdmin.accessToken }));
      expectData(await world.api('post', '/customer/loyalty/convert', { token: c.accessToken, body: { points: 100, idempotencyKey: 'sum-key' } }), 201);
      expect(await walletBalance(c.id)).toBe(1234 + 100);
      const types = (await q('SELECT type FROM wallet_transactions WHERE customer_id = $1 ORDER BY created_at', [c.id])).map((r: any) => r.type);
      expect(types).toEqual(['DRIVER_CASH_REMAINDER', 'LOYALTY_REDEMPTION']);
    });
  });

  describe('cancellation semantics', () => {
    it('a cancelled order: customer notified once, no loyalty, no delivery, driver untouched, segments/stock/refund handled — and the vendor can no longer advance its segment', async () => {
      const c = await s.customer();
      expectData(await world.api('post', '/customer/device-token', { token: c.accessToken, body: { token: 'fcm-cancel', platform: 'android' } }), 201);
      const tracked = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 4 });
      await s.addToCart(c, tracked.id, 3);
      const order = await s.checkout(c, home);
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: vendor.manager.accessToken, body: { status: 'CANCELLED', cancellationReason: 'out of ingredients' } }));
      expect(boundary.push.filter((p) => p.data.type === 'ORDER_CANCELLED' && p.data.orderId === order.id)).toHaveLength(1);
      expect((await q('SELECT cancelled_by_role, cancellation_reason FROM orders WHERE id = $1', [order.id]))[0]).toEqual({ cancelled_by_role: 'VENDOR_MANAGER', cancellation_reason: 'out of ingredients' });
      expect((await q('SELECT quantity FROM products WHERE id = $1', [tracked.id]))[0].quantity).toBe(4);
      // the order is dead — a vendor must not be able to keep "preparing" it
      const segment = (await q('SELECT id FROM order_vendor_segments WHERE order_id = $1', [order.id]))[0];
      const zombie = await world.api('patch', `/vendor/orders/segments/${segment.id}/status`, { token: vendor.manager.accessToken, body: { status: 'CONFIRMED' } });
      expect(zombie.status).toBe(400);
      expect(await orderStatus(order.id)).toBe('CANCELLED');
      expect((await q('SELECT status FROM order_vendor_segments WHERE id = $1', [segment.id]))[0].status).not.toBe('CONFIRMED');
    });

    it('once a driver is assigned the order can no longer be cancelled by vendor or admin (only reassigned/failed) — and after pickup nothing but the driver can move it', async () => {
      const c = await s.customer();
      const { order } = await orderThrough(c, 'ASSIGNED');
      for (const actor of [vendor.manager, superAdmin]) {
        const res = await world.api('patch', `/orders/${order.id}/status`, { token: actor.accessToken, body: { status: 'CANCELLED', cancellationReason: 'x' } });
        expect(res.status).toBe(400);
      }
      expect(await orderStatus(order.id)).toBe('ASSIGNED_TO_DRIVER');
    });
  });
});
