/**
 * Group 8 / phases 10 & 11 — weighted products and payments over real HTTP.
 * Weighted: estimate → actual weight (vendor OR driver, once) → totals recomputed → pickup gate.
 * Payments: COD / PAY_AT_DELIVERY (no payment row), Manual Transfer (claim → review → approve/reject →
 * refund), unsupported methods, wallet payment needing a balance, ONLINE (not available).
 *
 * Wallet payment (PD-001) is implemented as part of PD-006; its full behaviour is covered in 66-wallet-snapshots-tracking.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — weighted products & payments', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let vendor: VendorFixture;
  let other: VendorFixture;
  let superAdmin: Actor;
  let reviewer: Actor;
  const home = { lat: 30.425, lng: 31.565 };

  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const eventsOf = (orderId: string, type: string) => world.ds.query('SELECT amount_minor, actor_user_id FROM financial_events WHERE order_id = $1 AND type = $2', [orderId, type]);
  const place = async (c: Actor, paymentMethod: string) => {
    const body = {
      deliveryAddress: { line1: 'Pay Street', latitude: home.lat, longitude: home.lng },
      paymentMethod,
      ...(paymentMethod === 'MANUAL_TRANSFER' || paymentMethod === 'PAY_AT_DELIVERY' ? { electronicPaymentMethod: 'INSTAPAY' } : {}),
    };
    return world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, body) });
  };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Weigh Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    other = await s.vendor({ name: 'Other Weigh Vendor', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    await s.driver({ lat: 30.4212, lng: 31.5612 });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000', accountName: 'Hatly' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('weighted products', () => {
    let cheese: { id: string };
    const weightedOrder = async (grams = 750) => {
      const c = await s.customer();
      await s.addToCart(c, cheese.id, 1, { requestedWeightGrams: grams });
      const order = await s.checkout(c, home);
      const item = order.segments[0].items[0];
      return { c, order, item };
    };
    const recordVendor = (itemId: string, weightGrams: number, v = vendor) => world.api('post', `/vendor/orders/order-items/${itemId}/weight`, { token: v.manager.accessToken, body: { weightGrams } });

    beforeAll(async () => {
      cheese = await s.product(vendor, { name: 'Cheese', priceMinor: 20000, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN' });
    });

    it('the order stores the ESTIMATE (price/kg × requested grams); the vendor\'s real weight replaces it and totals move by the difference', async () => {
      const { order, item } = await weightedOrder(750);
      expect(item).toMatchObject({ pricingUnitSnapshot: 'WEIGHT', requestedWeightGrams: 750, estimatedAmountMinor: 15000, actualWeightGrams: null, finalAmountMinor: null });
      expect(order.subtotalMinor).toBe(15000);
      const res = await recordVendor(item.id, 820);
      expect(res.status).toBeLessThan(300);
      const [row] = await world.ds.query('SELECT actual_weight_grams, final_amount_minor FROM order_items WHERE id = $1', [item.id]);
      expect(row).toEqual({ actual_weight_grams: 820, final_amount_minor: 16400 }); // 200.00 × 0.82
      const after = await orderRow(order.id);
      expect(Number(after.subtotal_minor)).toBe(16400);
      expect(Number(after.total_minor)).toBe(order.totalMinor + 1400);
      expect(Number((await world.ds.query('SELECT subtotal_minor FROM order_vendor_segments WHERE order_id = $1', [order.id]))[0].subtotal_minor)).toBe(16400);
    });

    it('the actual weight is recorded ONCE: a second record (vendor or driver) is 409 WEIGHT_ALREADY_RECORDED and changes nothing', async () => {
      const { order, item } = await weightedOrder(500);
      expect((await recordVendor(item.id, 480)).status).toBeLessThan(300);
      const again = await recordVendor(item.id, 999);
      expect(again.status).toBe(409);
      expect(again.body.error.details).toEqual({ code: 'WEIGHT_ALREADY_RECORDED' });
      expect(Number((await orderRow(order.id)).subtotal_minor)).toBe(9600);
    });

    it('vendor and driver racing to record the weight: exactly one wins, the totals move exactly once', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const { order, item } = await weightedOrder(1000);
      await s.vendorPrepares(vendor, order.id);
      const driver = await s.driverAssignedTo(order.id);
      const results = await Promise.all([
        recordVendor(item.id, 900),
        world.api('post', `/driver/order-items/${item.id}/weight`, { token: driver.accessToken, body: { weightGrams: 1100 } }),
      ]);
      expect(results.filter((r) => r.status < 300)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(1);
      const [row] = await world.ds.query('SELECT actual_weight_grams, final_amount_minor FROM order_items WHERE id = $1', [item.id]);
      expect([{ actual_weight_grams: 900, final_amount_minor: 18000 }, { actual_weight_grams: 1100, final_amount_minor: 22000 }]).toContainEqual(row);
      expect(Number((await orderRow(order.id)).subtotal_minor)).toBe(row.final_amount_minor);
      expect(await world.ds.query('SELECT id FROM order_item_weight_records WHERE order_item_id = $1', [item.id])).toHaveLength(1);
    });

    it('validates the weight, refuses non-weighted items and other vendors, and closes once the order is picked up', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const { c, order, item } = await weightedOrder(600);
      for (const bad of [0, -5, 1.5, '700']) {
        expect({ bad, status: (await world.api('post', `/vendor/orders/order-items/${item.id}/weight`, { token: vendor.manager.accessToken, body: { weightGrams: bad } })).status }).toEqual({ bad, status: 400 });
      }
      expect((await recordVendor(item.id, 600, other)).status).toBe(403);
      const piece = await s.product(vendor, { priceMinor: 1000, inventoryMode: 'OPEN' });
      await s.addToCart(c, piece.id, 1);
      // a piece item of a different order to prove NOT_A_WEIGHT_ITEM
      const c2 = await s.customer();
      await s.addToCart(c2, piece.id, 1);
      const pieceOrder = await s.checkout(c2, home);
      const notWeight = await recordVendor(pieceOrder.segments[0].items[0].id, 500);
      expect(notWeight.status).toBe(400);
      expect(notWeight.body.error.details).toEqual({ code: 'NOT_A_WEIGHT_ITEM' });

      // pickup gate + window: weight cannot be skipped
      await s.vendorPrepares(vendor, order.id);
      const driver = await s.driverAssignedTo(order.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === order.id);
      const blocked = await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } });
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.details.code).toBe('WEIGHT_NOT_RECORDED');
      expect((await world.ds.query('SELECT status FROM orders WHERE id = $1', [order.id]))[0].status).toBe('ASSIGNED_TO_DRIVER');
      expect((await world.api('post', `/driver/order-items/${item.id}/weight`, { token: driver.accessToken, body: { weightGrams: 610 } })).status).toBeLessThan(300);
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } }));
      const late = await world.api('post', `/driver/order-items/${item.id}/weight`, { token: driver.accessToken, body: { weightGrams: 1 } });
      expect([400, 409]).toContain(late.status); // already recorded / window closed — never silently accepted
    });

    it('the final weighed amount drives what the driver collects, the vendor commission base and the loyalty points', async () => {
      await s.driver({ lat: 30.4215, lng: 31.5615 });
      const commissionVendor = await s.vendor({ name: 'Commission Weigh', serviceAreaId: area.id, lat: 30.4215, lng: 31.5615, commissionBasisPoints: 1000 });
      const w = await s.product(commissionVendor, { priceMinor: 20000, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, w.id, 1, { requestedWeightGrams: 1000 });
      const order = await s.checkout(c, home);
      const item = order.segments[0].items[0];
      expect((await recordVendor(item.id, 1500, commissionVendor)).status).toBeLessThan(300);
      await s.vendorPrepares(commissionVendor, order.id);
      const driver = await s.driverAssignedTo(order.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === order.id);
      expect(delivery.totalMinor).toBe(30000 + order.deliveryFeeMinor);
      for (const st of ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED']) {
        // M4 — Proof of Delivery is required for the DELIVERED transition.
        const body = st === 'DELIVERED' ? { status: st, proofPhotoUrl: await s.uploadFakePhoto(driver.accessToken) } : { status: st };
        expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body }));
      }
      expect((await eventsOf(order.id, 'VENDOR_COMMISSION_RECOGNIZED'))[0].amount_minor).toBe(3000); // 10% of the 300.00 actually weighed
      expect((await world.ds.query('SELECT points_delta FROM loyalty_points_transactions WHERE order_id = $1', [order.id]))[0].points_delta).toBe(300); // 1 point per EGP of the final amount
    });

    it('Manual Transfer is refused for a weighted order (the final amount is unknown), COD is accepted', async () => {
      const c = await s.customer();
      await s.addToCart(c, cheese.id, 1, { requestedWeightGrams: 500 });
      const refused = await place(c, 'MANUAL_TRANSFER');
      expect(refused.status).toBe(400);
      expect(refused.body.error.details).toEqual({ code: 'MANUAL_TRANSFER_NOT_ALLOWED_FOR_WEIGHTED_ORDER' });
      expect((await place(c, 'COD')).status).toBe(201);
    });
  });

  describe('payment methods', () => {
    let product: { id: string; priceMinor: number };
    beforeAll(async () => {
      product = await s.product(vendor, { name: 'Payable', priceMinor: 10000, inventoryMode: 'OPEN' });
    });
    const cartWith = async (qty = 1) => {
      const c = await s.customer();
      await s.addToCart(c, product.id, qty);
      return c;
    };

    it('COD and PAY_AT_DELIVERY create the order with NO payment row; unknown methods and ONLINE are refused', async () => {
      const a = await cartWith();
      const cod = await place(a, 'COD');
      expect(cod.status).toBe(201);
      expect(await paymentOf(cod.body.data.id)).toBeUndefined();
      const b = await cartWith();
      const pad = await place(b, 'PAY_AT_DELIVERY');
      expect(pad.status).toBe(201);
      expect(await paymentOf(pad.body.data.id)).toBeUndefined();

      const c = await cartWith();
      const online = await place(c, 'ONLINE');
      expect(online.status).toBe(400);
      expect(online.body.error.details).toEqual({ code: 'ONLINE_PAYMENT_NOT_AVAILABLE' });
      for (const method of ['CARD', 'wallet', '']) {
        expect({ method, status: (await place(c, method)).status }).toEqual({ method, status: 400 });
      }
      expect((await world.api('post', '/orders', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng } } })).status).toBe(400); // no method at all
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
      expect((await world.api('get', '/cart', { token: c.accessToken })).body.data.groups).toHaveLength(1); // cart intact after every refusal
    });

    // PD-001 / PD-006: wallet payment is a real payment source (full behaviour: 66-wallet-snapshots-tracking). What this asserts:
    // an empty wallet cannot pay, and the customer wallet API (`GET /customer/wallet`, `GET /customer/wallet/transactions`) is
    // customer-only and reports that empty wallet consistently — the rejected attempt must not have moved any money.
    it('WALLET as a payment source needs a balance (empty wallet → WALLET_INSUFFICIENT_BALANCE); the customer wallet endpoints agree', async () => {
      const c = await cartWith();
      const res = await place(c, 'WALLET');
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('WALLET_INSUFFICIENT_BALANCE');

      // The rejected attempt left the wallet untouched and no ledger row behind.
      expect(expectData(await world.api('get', '/customer/wallet', { token: c.accessToken }))).toEqual({ balanceMinor: 0 });
      const ledger = await world.api('get', '/customer/wallet/transactions', { token: c.accessToken });
      expect(ledger.status).toBe(200);
      expect(ledger.body.data).toEqual([]);
      expect(ledger.body.meta.total).toBe(0);
    });

    it('the wallet endpoints are customer-only; the old guessed paths do not exist', async () => {
      const c = await s.customer();
      for (const path of ['/customer/wallet', '/customer/wallet/transactions']) {
        expect((await world.api('get', path)).status).toBe(401);
        expect((await world.api('get', path, { token: reviewer.accessToken })).status).toBe(403);
        expect((await world.api('get', path, { token: c.accessToken })).status).toBe(200);
      }
      for (const path of ['/wallet', '/wallet/balance', '/customer/wallet/balance']) {
        expect([401, 403, 404]).toContain((await world.api('get', path, { token: c.accessToken })).status);
      }
    });

    it('Customer Support contact is independent of Manual Transfer: GET /support/contact serves only the WhatsApp number, customer-only, and never fails when it is unset', async () => {
      const c = await s.customer();
      expect(expectData(await world.api('get', '/support/contact', { token: c.accessToken }))).toEqual({ whatsappNumber: '+201000000000' });
      expect((await world.api('get', '/support/contact')).status).toBe(401);
      expect((await world.api('get', '/support/contact', { token: reviewer.accessToken })).status).toBe(403);
      // Blank value → null (200), while the Manual Transfer config keeps its own contract untouched.
      await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '   ');
      try {
        expect(expectData(await world.api('get', '/support/contact', { token: c.accessToken }))).toEqual({ whatsappNumber: null });
      } finally {
        await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
      }
    });

    it('MANUAL_TRANSFER: payment starts PENDING with the amount snapshotted; config endpoint serves the destination', async () => {
      const cfg = expectData(await world.api('get', '/payments/manual-transfer/config', { token: (await cartWith()).accessToken }));
      expect(cfg).toEqual({ destination: { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000', accountName: 'Hatly' }, whatsappNumber: '+201000000000' });
      const c = await cartWith(2);
      const res = await place(c, 'MANUAL_TRANSFER');
      expect(res.status).toBe(201);
      const payment = await paymentOf(res.body.data.id);
      expect(payment).toMatchObject({ status: 'PENDING', method: 'MANUAL_TRANSFER' });
      expect(Number(payment.amount_minor)).toBe(res.body.data.totalMinor);
    });

    it('the full Manual Transfer path: customer claims → UNDER_REVIEW (idempotent) → reviewer approves → PAID (verifier recorded); a decision is never overwritten', async () => {
      const c = await cartWith();
      const order = (await place(c, 'MANUAL_TRANSFER')).body.data;
      const payment = await paymentOf(order.id);
      const stranger = await s.customer();
      expect((await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: stranger.accessToken, body: {} })).status).toBe(404);
      expect((await paymentOf(order.id)).status).toBe('PENDING');

      const claim = await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      expect(claim.status).toBeLessThan(300);
      expect((await paymentOf(order.id)).status).toBe('UNDER_REVIEW');
      expect((await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} })).status).toBeLessThan(300); // idempotent
      const queue = expectData<any[]>(await world.api('get', '/admin/manual-transfer-payments', { token: reviewer.accessToken }));
      expect(queue.map((p) => p.id)).toContain(payment.id);

      // approve twice concurrently: one wins, the other is a 409 — never two decisions
      const decisions = await Promise.all([
        world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }),
        world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: superAdmin.accessToken }),
      ]);
      expect(decisions.map((d) => d.status).sort()).toEqual([201, 409]);
      const paid = await paymentOf(order.id);
      expect(paid).toMatchObject({ status: 'PAID' });
      expect([reviewer.id, superAdmin.id]).toContain(paid.verified_by_user_id);
      const reject = await world.api('post', `/admin/manual-transfer-payments/${payment.id}/reject`, { token: reviewer.accessToken, body: { reason: 'too late' } });
      expect(reject.status).toBe(409);
      expect((await paymentOf(order.id)).status).toBe('PAID');
      expect((await world.api('get', '/admin/manual-transfer-payments', { token: reviewer.accessToken })).body.data.map((p: any) => p.id)).not.toContain(payment.id);
    });

    it('rejection records the reason and stops there; approval requires the review step first; only VERIFY_MANUAL_PAYMENTS may decide', async () => {
      const c = await cartWith();
      const order = (await place(c, 'MANUAL_TRANSFER')).body.data;
      const payment = await paymentOf(order.id);
      // not claimed yet → cannot be approved straight from PENDING
      const early = await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken });
      expect(early.status).toBe(409);
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      const nobody = await s.admin([]);
      expect((await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: nobody.accessToken })).status).toBe(403);
      expect((await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: c.accessToken })).status).toBe(403);
      const rejected = await world.api('post', `/admin/manual-transfer-payments/${payment.id}/reject`, { token: reviewer.accessToken, body: { reason: 'amount mismatch' } });
      expect(rejected.status).toBeLessThan(300);
      expect(await paymentOf(order.id)).toMatchObject({ status: 'REJECTED', rejection_reason: 'amount mismatch' });
      expect((await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken })).status).toBe(409);
    });

    it('cancelling a PAID manual-transfer order records the full refund automatically (once); cancelling an unpaid one records none', async () => {
      const paidCustomer = await cartWith();
      const paidOrder = (await place(paidCustomer, 'MANUAL_TRANSFER')).body.data;
      const p = await paymentOf(paidOrder.id);
      await world.api('post', `/payments/manual-transfer/orders/${paidOrder.id}/claim`, { token: paidCustomer.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${p.id}/approve`, { token: reviewer.accessToken }), 201);
      expectData(await world.api('patch', `/orders/${paidOrder.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'customer asked' } }));
      const refunds = await eventsOf(paidOrder.id, 'MANUAL_TRANSFER_REFUND_RECORDED');
      expect(refunds).toHaveLength(1);
      expect(refunds[0].amount_minor).toBe(paidOrder.totalMinor);
      expect(refunds[0].actor_user_id).toBe(superAdmin.id); // the acting admin's user id (not a role name)

      const unpaid = await cartWith();
      const unpaidOrder = (await place(unpaid, 'MANUAL_TRANSFER')).body.data;
      expectData(await world.api('patch', `/orders/${unpaidOrder.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'x' } }));
      expect(await eventsOf(unpaidOrder.id, 'MANUAL_TRANSFER_REFUND_RECORDED')).toEqual([]);
    });

    it('the explicit admin refund endpoint is idempotent per payment and only for PAID payments', async () => {
      const c = await cartWith();
      const order = (await place(c, 'MANUAL_TRANSFER')).body.data;
      const p = await paymentOf(order.id);
      const notPaid = await world.api('post', `/admin/manual-transfer-payments/${p.id}/refund`, { token: reviewer.accessToken, body: { amountMinor: 100 } });
      expect(notPaid.status).toBe(400);
      expect(notPaid.body.error.details).toEqual({ code: 'PAYMENT_NOT_PAID' });
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      await world.api('post', `/admin/manual-transfer-payments/${p.id}/approve`, { token: reviewer.accessToken });
      expect((await world.api('post', `/admin/manual-transfer-payments/${p.id}/refund`, { token: reviewer.accessToken, body: { amountMinor: 5000, reason: 'partial' } })).status).toBe(201);
      const again = await world.api('post', `/admin/manual-transfer-payments/${p.id}/refund`, { token: reviewer.accessToken, body: { amountMinor: 5000 } });
      expect(again.status).toBeLessThan(500);
      expect(await eventsOf(order.id, 'MANUAL_TRANSFER_REFUND_RECORDED')).toHaveLength(1); // never recorded twice
      expect((await world.api('post', `/admin/manual-transfer-payments/${p.id}/refund`, { token: reviewer.accessToken, body: { amountMinor: 0 } })).status).toBe(400);
    });

    it('a delivered Manual Transfer order books the driver reimbursement (the driver paid the vendor from pocket) at pickup', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const c = await cartWith(2);
      const order = (await place(c, 'MANUAL_TRANSFER')).body.data;
      const p = await paymentOf(order.id);
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      await world.api('post', `/admin/manual-transfer-payments/${p.id}/approve`, { token: reviewer.accessToken });
      await s.vendorPrepares(vendor, order.id);
      const driver = await s.driverAssignedTo(order.id);
      const delivery = expectData<any[]>(await world.api('get', '/driver/deliveries', { token: driver.accessToken })).find((d) => d.orderId === order.id);
      expectData(await world.api('patch', `/driver/deliveries/${delivery.id}/status`, { token: driver.accessToken, body: { status: 'PICKED_UP' } }));
      const reimbursement = await eventsOf(order.id, 'DRIVER_REIMBURSEMENT_OWED');
      expect(reimbursement).toEqual([{ amount_minor: 20000, actor_user_id: null }]); // vendor amount only, never the delivery fee
    });
  });

  describe('input hardening on checkout', () => {
    it('rejects malformed delivery addresses and unknown fields', async () => {
      const product = await s.product(vendor, { priceMinor: 1000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const post = async (deliveryAddress: unknown, extra: object = {}) => world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress, paymentMethod: 'COD', ...extra }) });
      expect((await post({ latitude: 30.4, longitude: 31.5 })).status).toBe(400); // no line1
      expect((await post({ line1: 'x', latitude: 95, longitude: 31.5 })).status).toBe(400);
      expect((await post({ line1: 'x', latitude: 30.4, longitude: 31.5, admin: true })).status).toBe(400);
      expect((await post({ line1: 'x', latitude: 30.4, longitude: 31.5 }, { totalMinor: 1 })).status).toBe(400); // client can never set money fields
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
      // PD-006 address validation: the delivery address line is capped at 255 characters, exactly like address-book entries
      // (previously uncapped — a characterisation that is now deliberately tightened).
      expect((await post({ line1: 'x'.repeat(300), latitude: 30.4, longitude: 31.5 })).status).toBe(400);
      expect((await post({ line1: 'x'.repeat(255), latitude: 30.4, longitude: 31.5 })).status).toBe(201);
    });
  });
});
