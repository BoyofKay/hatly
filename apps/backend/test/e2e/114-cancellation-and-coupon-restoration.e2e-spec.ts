/**
 * PD-014, over real HTTP against real PostgreSQL:
 *  A. a customer may cancel a Hatly / Wasally order after it passed the payment gate and until a driver is assigned — wallet / COD /
 *     Manual Transfer money handling, duplicate requests, the cancel-vs-assignment race (exactly one wins);
 *  B. a rejected vendor part (or a cancelled order) gives back its discount / coupon entitlement exactly once, without any extra money.
 *
 * Delivery pricing: 10 EGP / 100 m, 15 EGP minimum, 5 EGP (500 minor) per additional vendor.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { boundary } from './support/external-boundary';
import { Permission } from '../../src/modules/permissions/permission.enum';

const HOUR = 3600_000;
const window = () => ({ startAt: new Date(Date.now() - HOUR).toISOString(), endAt: new Date(Date.now() + 24 * HOUR).toISOString() });
const ADDITIONAL_VENDOR_FEE = 500;

describe('E2E — customer cancellation of Hatly/Wasally orders and discount/coupon restoration (PD-014)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let reviewer: Actor;
  let dispatcher: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let v3: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  let p3: { id: string };
  const home = { lat: 30.425, lng: 31.565 };
  const num = (v: unknown) => Number(v);

  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const details = async (c: Actor, id: string) => expectData<any>(await world.api('get', `/orders/${id}`, { token: c.accessToken }));
  const cancel = (c: Actor, id: string) => world.api('post', `/orders/${id}/cancel`, { token: c.accessToken, body: {} });
  const reject = (v: VendorFixture, segmentId: string, reason = 'Out of stock') =>
    world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body: { status: 'CANCELLED', reason } });
  const ledger = (c: Actor, type: string) =>
    world.ds.query('SELECT amount_delta_minor, order_id FROM wallet_transactions WHERE customer_id = $1 AND type = $2 ORDER BY created_at', [c.id, type]);
  const refundEvents = (orderId: string) =>
    world.ds.query("SELECT id, amount_minor FROM financial_events WHERE order_id = $1 AND type = 'MANUAL_TRANSFER_REFUND_RECORDED' ORDER BY created_at", [orderId]);
  let seed = 0;
  const credit = (c: Actor, amountMinor: number) =>
    world.ds.query("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `pd14-seed-${c.id}-${seed++}`]);
  const offerRow = async (id: string) => (await world.ds.query('SELECT * FROM offers WHERE id = $1', [id]))[0];
  const consumptions = (orderId: string) =>
    world.ds.query('SELECT mechanism_snapshot, order_vendor_segment_id, discount_applied_minor, is_reversed, reversed_at FROM offer_consumptions WHERE order_id = $1 ORDER BY created_at', [orderId]);
  const createOffer = async (body: Record<string, unknown>) =>
    expectData<any>(await world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { ...window(), ...body } }), 201);
  const expectConsistent = (row: any) => expect(num(row.total_minor)).toBe(num(row.subtotal_minor) + num(row.delivery_fee_minor) - num(row.discount_minor));

  const addr = (extra: Record<string, unknown> = {}) => ({ line1: 'PD14 Street 1', latitude: home.lat, longitude: home.lng, ...extra });
  const place = async (c: Actor, body: Record<string, unknown>) =>
    world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: addr(), ...body }) });
  const quote = async (c: Actor, body: Record<string, unknown>) =>
    expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: addr(), ...body } }), 201);
  const cartFor = async (products: Array<{ id: string }>) => {
    const c = await s.customer();
    for (const p of products) await s.addToCart(c, p.id, 1);
    return c;
  };

  // ---- Hatly / Wasally ----
  let serviceAddress: Record<string, unknown>;
  const wasallyItem = { adHocPlaceName: "Mom's house", adHocServiceType: 'DELIVER_TO_PLACE', pickupLatitude: 30.35, pickupLongitude: 31.5, destinationLatitude: 30.36, destinationLongitude: 31.51, freeTextDescription: 'A key', quantity: 1 };
  const hatlyItem = { adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', pickupLatitude: 30.3, pickupLongitude: 31.45, destinationLatitude: 30.31, destinationLongitude: 31.46, freeTextDescription: 'Panadol', quantity: 1 };
  /** A placed Hatly (BUY_FROM_PLACE, unpriced, COD only) or Wasally (DELIVER_TO_PLACE, priced) order. */
  const serviceOrder = async (item: Record<string, unknown>, paymentMethod: string, walletCredit = 0) => {
    const c = await s.customer();
    if (walletCredit) await credit(c, walletCredit);
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: item }), 201);
    const res = await world.api('post', '/orders', {
      token: c.accessToken,
      body: await withQuoteToken(world, c.accessToken, { deliveryAddress: serviceAddress, paymentMethod, ...(paymentMethod === 'MANUAL_TRANSFER' ? { electronicPaymentMethod: 'INSTAPAY' } : {}) }),
    });
    expect(res.status).toBe(201);
    return { c, order: res.body.data };
  };
  const assign = (orderId: string, driverId: string) =>
    world.api('post', `/admin/orders/${orderId}/assign-driver`, { token: dispatcher.accessToken, body: { driverId } });
  const openAlerts = (orderId: string) => world.ds.query('SELECT id FROM dispatch_alerts WHERE order_id = $1 AND resolved_at IS NULL AND deleted_at IS NULL', [orderId]);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS], 'PD14 Reviewer');
    dispatcher = await s.admin([Permission.ASSIGN_REASSIGN_ORDERS, Permission.VIEW_ORDERS], 'PD14 Dispatcher');
    v1 = await s.vendor({ name: 'PD 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'PD 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    v3 = await s.vendor({ name: 'PD 3', serviceAreaId: area.id, lat: 30.441, lng: 31.581 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    p3 = await s.product(v3, { priceMinor: 30000, inventoryMode: 'OPEN' });
    serviceAddress = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56, deliveryZoneId: (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id };
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    await s.setConfig('AUTOMATIC_DISPATCH_ENABLED', false); // the race tests assign explicitly
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('A. customer cancellation of Hatly / Wasally orders', () => {
    it.each([
      ['Hatly', hatlyItem],
      ['Wasally', wasallyItem],
    ])('%s (COD): cancellable after the payment gate and before a driver — recorded as the customer\'s, alert resolved, nothing owed, history kept', async (_name, item) => {
      const { c, order } = await serviceOrder(item as Record<string, unknown>, 'COD');
      expect((await orderRow(order.id)).status).toBe('READY_FOR_PICKUP');
      expect((await details(c, order.id)).customerCanCancel).toBe(true);
      expect((await openAlerts(order.id)).length).toBe(1); // waiting for a manual assignment

      expectData(await cancel(c, order.id), 201);

      const row = await orderRow(order.id);
      expect(row).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'CUSTOMER' });
      expect(num(row.total_minor) === 0 || row.total_minor === null).toBe(true);
      expect(num(row.amount_due_minor ?? 0)).toBe(0); // COD: the amount due is simply gone — no refund event
      expect(await refundEvents(order.id)).toEqual([]);
      expect(await openAlerts(order.id)).toEqual([]);
      const segs = await world.ds.query('SELECT id, status FROM order_vendor_segments WHERE order_id = $1', [order.id]);
      expect(segs.every((x: any) => x.status === 'CANCELLED')).toBe(true);
      const hist = await world.ds.query('SELECT to_status FROM order_vendor_segment_events WHERE segment_id = $1 ORDER BY created_at', [segs[0].id]);
      expect(hist.map((h: any) => h.to_status)).toContain('READY_FOR_PICKUP'); // earlier history preserved
      const d = await details(c, order.id);
      expect(d.status).toBe('CANCELLED');
      expect(d.customerCanCancel).toBe(false);
      const timeline = await world.ds.query('SELECT to_status, actor_role FROM order_status_events WHERE order_id = $1 ORDER BY created_at', [order.id]);
      expect(timeline.at(-1)).toMatchObject({ to_status: 'CANCELLED', actor_role: 'CUSTOMER' });
    });

    it('R40: after a driver is assigned the customer can still cancel until the purchase is recorded; the driver is freed', async () => {
      const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
      const { c, order } = await serviceOrder(wasallyItem, 'COD');
      expectData(await assign(order.id, driver.driverId), 201);
      expect((await details(c, order.id)).customerCanCancel).toBe(true);
      expectData(await cancel(c, order.id), 201);
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(true);
    });

    it('R40: once the driver recorded the purchase the customer is refused (SERVICE_PURCHASE_RECORDED) and nothing changes', async () => {
      const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
      const { c, order } = await serviceOrder(wasallyItem, 'COD');
      expectData(await assign(order.id, driver.driverId), 201);
      const [item] = await world.ds.query(
        `SELECT oi.id FROM order_items oi JOIN order_vendor_segments g ON g.id = oi.order_vendor_segment_id WHERE g.order_id = $1 LIMIT 1`, [order.id]);
      await world.ds.query(
        `INSERT INTO ad_hoc_purchase_records (order_item_id, amount_minor, recorded_by_driver_id, recorded_by_role) VALUES ($1, 1000, $2, 'DRIVER')`, [item.id, driver.driverId]);
      expect((await details(c, order.id)).customerCanCancel).toBe(false);
      const res = await cancel(c, order.id);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', reason: 'SERVICE_PURCHASE_RECORDED' });
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
    });

    it('Wallet (Wasally): the wallet is refunded exactly the amount it paid, once — a duplicate request is a 400 and credits nothing more', async () => {
      const { c, order } = await serviceOrder(wasallyItem, 'WALLET', 200000);
      const total = num((await orderRow(order.id)).total_minor);
      expect(total).toBeGreaterThan(0);
      expect((await ledger(c, 'ORDER_PAYMENT')).map((r: any) => num(r.amount_delta_minor))).toEqual([-total]);

      expectData(await cancel(c, order.id), 201);
      expect((await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([total]);
      expect((await cancel(c, order.id)).status).toBe(400);
      expect((await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([total]);
      expect((await details(c, order.id)).refundSummary).toMatchObject({ walletRefundedMinor: total, totalRefundMinor: total });
    });

    it('Manual Transfer (Wasally), APPROVED: a refund OBLIGATION of exactly the amount paid is recorded — never shown as sent until operations mark it', async () => {
      const { c, order } = await serviceOrder(wasallyItem, 'MANUAL_TRANSFER');
      expect((await orderRow(order.id)).status).toBe('PENDING'); // the payment gate is closed
      const payment = (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [order.id]))[0];
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      const { AdHocFulfilmentService } = await import('../../src/modules/orders/ad-hoc-fulfilment.service');
      await world.app.get(AdHocFulfilmentService).sweep(); // what the 10-second pass does
      expect((await orderRow(order.id)).status).toBe('READY_FOR_PICKUP');
      const paid = num((await world.ds.query('SELECT amount_minor FROM payments WHERE id = $1', [payment.id]))[0].amount_minor);

      expectData(await cancel(c, order.id), 201);
      expect((await refundEvents(order.id)).map((e: any) => num(e.amount_minor))).toEqual([paid]);
      expect((await cancel(c, order.id)).status).toBe(400);
      expect((await refundEvents(order.id)).length).toBe(1);
      const summary = (await details(c, order.id)).refundSummary;
      expect(summary).toMatchObject({ transferRefundRecordedMinor: paid, transferRefundSentMinor: 0 });
      expect(summary.transferRefunds[0].sentAt).toBeNull();
      expect(await world.ds.query('SELECT id FROM refund_payouts WHERE financial_event_id = $1', [(await refundEvents(order.id))[0].id])).toEqual([]);
    });

    it('Manual Transfer (Wasally) before approval: cancellable (PD-004 pending entitlement, no refund event)', async () => {
      const { c, order } = await serviceOrder(wasallyItem, 'MANUAL_TRANSFER');
      expectData(await cancel(c, order.id), 201);
      expect(await refundEvents(order.id)).toEqual([]);
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
    });

    it('someone else\'s order is a 404, a vendor order that is READY_FOR_PICKUP is cancellable (R3), and the ADMIN keeps cancelling a READY service order', async () => {
      const { c, order } = await serviceOrder(wasallyItem, 'COD');
      const stranger = await s.customer();
      expect((await cancel(stranger, order.id)).status).toBe(404);
      expect((await orderRow(order.id)).status).toBe('READY_FOR_PICKUP');

      const vendorCustomer = await cartFor([p1]);
      const vendorOrder = expectData<any>(await place(vendorCustomer, { paymentMethod: 'COD' }), 201);
      await s.vendorPrepares(v1, vendorOrder.id);
      expect(['READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER']).toContain((await orderRow(vendorOrder.id)).status);
      expectData(await cancel(vendorCustomer, vendorOrder.id), 201); // R3: until the driver picks up

      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'support' } }));
      expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED', cancelled_by_role: 'SUPER_ADMIN' });
      void c;
    });

    describe('concurrency', () => {
      it('cancel vs driver assignment, raced 8 times: exactly ONE wins every time, and the loser leaves no trace', async () => {
        const outcomes: string[] = [];
        for (let i = 0; i < 8; i++) {
          const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
          const { c, order } = await serviceOrder(wasallyItem, 'WALLET', 200000);
          const total = num((await orderRow(order.id)).total_minor);
          const [cancelRes, assignRes] = await Promise.all([cancel(c, order.id), assign(order.id, driver.driverId)]);
          const row = await orderRow(order.id);
          const refunds = (await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor));
          const deliveries = await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1', [order.id]);
          const driverFree = (await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available;

          if (cancelRes.status === 201) {
            outcomes.push('cancel');
            expect(assignRes.status).toBeGreaterThanOrEqual(400); // never assigned after a successful cancel
            expect(row.status).toBe('CANCELLED');
            expect(refunds).toEqual([total]);
            expect(deliveries).toEqual([]); // the losing assignment rolled back entirely
            expect(driverFree).toBe(true);
          } else {
            outcomes.push('assign');
            expect(assignRes.status).toBe(201);
            expect(cancelRes.status).toBe(400); // never cancelled after a successful assignment
            expect(row.status).toBe('ASSIGNED_TO_DRIVER');
            expect(refunds).toEqual([]);
            expect(deliveries).toHaveLength(1);
            expect(driverFree).toBe(false);
          }
        }
        expect(outcomes).toHaveLength(8);
        expect(world.unhandledServerErrors()).toEqual([]);
      });

      it('after a successful cancel, a later assignment attempt is refused (ORDER_NOT_ASSIGNABLE) and leaves no delivery', async () => {
        const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
        const { c, order } = await serviceOrder(hatlyItem, 'COD');
        expectData(await cancel(c, order.id), 201);
        const res = await assign(order.id, driver.driverId);
        expect(res.status).toBe(409);
        expect(res.body.error.details.code).toBe('ORDER_NOT_ASSIGNABLE');
        expect(await world.ds.query('SELECT id FROM deliveries WHERE order_id = $1', [order.id])).toEqual([]);
        expect((await world.ds.query('SELECT is_available FROM drivers WHERE id = $1', [driver.driverId]))[0].is_available).toBe(true);
      });

      it('duplicate cancellation requests sent at once: one succeeds, the rest are 400, the wallet is credited exactly once', async () => {
        const { c, order } = await serviceOrder(wasallyItem, 'WALLET', 200000);
        const total = num((await orderRow(order.id)).total_minor);
        const results = await Promise.all([cancel(c, order.id), cancel(c, order.id), cancel(c, order.id), cancel(c, order.id)]);
        expect(results.filter((r) => r.status === 201)).toHaveLength(1);
        expect(results.filter((r) => r.status === 400)).toHaveLength(3);
        expect((await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([total]);
        expect(world.unhandledServerErrors()).toEqual([]);
      });

      it('a cancelled order that returns to the pool is not retried by the automatic dispatch: no new alert appears for it', async () => {
        const { c, order } = await serviceOrder(hatlyItem, 'COD');
        expectData(await cancel(c, order.id), 201);
        const { AutomaticDispatchService } = await import('../../src/modules/delivery/automatic-dispatch.service');
        await world.app.get(AutomaticDispatchService).attemptAutomaticDispatch(order.id);
        expect(await openAlerts(order.id)).toEqual([]);
      });
    });
  });

  describe('B. discount / coupon restoration', () => {
    it('PERCENTAGE coupon: rejecting the coupon\'s vendor returns its entitlement once — counters, history row, no extra money; repeated and concurrent rejection change nothing more', async () => {
      const offer = await createOffer({ vendorBranchId: v2.branchId, name: 'Ten off', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, couponCode: 'PD14PCT' });
      const c = await cartFor([p1, p2]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', couponCode: 'PD14PCT' }), 201);
      expect(order.discountMinor).toBe(2000);
      expect(await offerRow(offer.id)).toMatchObject({ consumed_units_count: 1 });
      expect(num((await offerRow(offer.id)).consumed_discount_minor)).toBe(2000);
      const before = await orderRow(order.id);

      const seg = await segmentOf(order.id, v2);
      const [a, b] = await Promise.all([reject(v2, seg), reject(v2, seg)]);
      expect([a.status, b.status].sort()).toEqual([200, 400]);
      expect((await reject(v2, seg)).status).toBe(400);

      const after = await orderRow(order.id);
      expect(num(after.discount_minor)).toBe(0); // the coupon left with its vendor part
      expect(num(before.total_minor) - num(after.total_minor)).toBe(20000 - 2000 + ADDITIONAL_VENDOR_FEE); // what the customer owed for that part
      expect(num(after.amount_due_minor)).toBe(num(before.amount_due_minor) - (20000 - 2000 + ADDITIONAL_VENDOR_FEE));
      expectConsistent(after);
      const rows = await consumptions(order.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ is_reversed: true });
      expect(rows[0].reversed_at).toBeTruthy();
      expect(num(rows[0].discount_applied_minor)).toBe(2000); // history untouched
      const restored = await offerRow(offer.id);
      expect(num(restored.consumed_units_count)).toBe(0);
      expect(num(restored.consumed_discount_minor)).toBe(0);
      expect(await ledger(c, 'ORDER_REFUND')).toEqual([]); // COD: no money moved, and nothing was credited for the coupon
    });

    it('FIXED coupon on another vendor: rejecting a DIFFERENT vendor leaves the coupon consumed; rejecting the last (coupon) vendor cancels the order and restores it', async () => {
      const offer = await createOffer({ vendorBranchId: v1.branchId, name: 'Fifteen off', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1500, couponCode: 'PD14FIX' });
      const c = await cartFor([p1, p2]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', couponCode: 'PD14FIX' }), 201);
      expect(order.discountMinor).toBe(1500);

      expectData(await reject(v2, await segmentOf(order.id, v2)));
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(1); // v1's coupon part still stands
      expect(num((await orderRow(order.id)).discount_minor)).toBe(1500);
      expectConsistent(await orderRow(order.id));

      expectData(await reject(v1, await segmentOf(order.id, v1))); // the last active part
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(0);
      expect(num((await offerRow(offer.id)).consumed_discount_minor)).toBe(0);
      expect((await consumptions(order.id)).every((r: any) => r.is_reversed)).toBe(true);
    });

    it('rounding in minor units: a 33.33 % coupon on 10005 restores exactly the rounded amount that was consumed (3335), never more', async () => {
      const odd = await s.product(v3, { priceMinor: 10005, inventoryMode: 'OPEN' });
      const offer = await createOffer({ vendorBranchId: v3.branchId, name: 'Third', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 3333, couponCode: 'PD14ODD' });
      const c = await cartFor([p1, odd]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', couponCode: 'PD14ODD' }), 201);
      expect(order.discountMinor).toBe(3335);
      expect(num((await offerRow(offer.id)).consumed_discount_minor)).toBe(3335);
      const before = await orderRow(order.id);
      expectData(await reject(v3, await segmentOf(order.id, v3)));
      const after = await orderRow(order.id);
      expect(num(before.total_minor) - num(after.total_minor)).toBe(10005 - 3335 + ADDITIONAL_VENDOR_FEE);
      expect(num(after.discount_minor)).toBe(0);
      expect(num((await offerRow(offer.id)).consumed_discount_minor)).toBe(0);
      expectConsistent(after);
    });

    it('per-customer limit: after the coupon\'s part is rejected the customer may use the code again; before that the limit holds', async () => {
      await createOffer({ vendorBranchId: v2.branchId, name: 'Once', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1000, couponCode: 'PD14ONCE', perCustomerLifetimeLimit: 1 });
      const c = await cartFor([p2]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', couponCode: 'PD14ONCE' }), 201);
      await s.addToCart(c, p2.id, 1);
      expect((await quote(c, { paymentMethod: 'COD', couponCode: 'PD14ONCE' })).coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_CUSTOMER_LIMIT_REACHED' });

      expectData(await cancel(c, order.id), 201); // the whole order, by the customer
      await s.addToCart(c, p2.id, 1);
      expect((await quote(c, { paymentMethod: 'COD', couponCode: 'PD14ONCE' })).coupon).toMatchObject({ status: 'APPLIED' });
    });

    it('global usage limit and budget cap: both come back with the cancelled order, and only once', async () => {
      const offer = await createOffer({ vendorBranchId: v2.branchId, name: 'Scarce', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 2000, couponCode: 'PD14SCARCE', totalAllocationLimit: 1, budgetCapMinor: 2000 });
      const a = await cartFor([p2]);
      const orderA = expectData<any>(await place(a, { paymentMethod: 'COD', couponCode: 'PD14SCARCE' }), 201);
      const b = await cartFor([p2]);
      expect((await quote(b, { paymentMethod: 'COD', couponCode: 'PD14SCARCE' })).coupon.reasonCode).toBe('COUPON_USAGE_LIMIT_REACHED');

      expectData(await cancel(a, orderA.id), 201);
      expect((await cancel(a, orderA.id)).status).toBe(400);
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(0);
      expect(num((await offerRow(offer.id)).consumed_discount_minor)).toBe(0);
      const orderB = expectData<any>(await place(b, { paymentMethod: 'COD', couponCode: 'PD14SCARCE' }), 201);
      expect(orderB.discountMinor).toBe(2000);
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(1); // consumed by B exactly once
    });

    it('WALLET: the refund is the amount actually paid for the rejected part (price − its coupon + one additional-vendor fee) — the coupon is not refunded a second time', async () => {
      await createOffer({ vendorBranchId: v2.branchId, name: 'W', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 1200, couponCode: 'PD14WAL' });
      const c = await cartFor([p1, p2]);
      await credit(c, 500000);
      const order = expectData<any>(await place(c, { paymentMethod: 'WALLET', couponCode: 'PD14WAL' }), 201);
      const before = await orderRow(order.id);
      expectData(await reject(v2, await segmentOf(order.id, v2)));
      const owedForPart = 20000 - 1200 + ADDITIONAL_VENDOR_FEE;
      expect((await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([owedForPart]);
      expect(num(before.total_minor) - num((await orderRow(order.id)).total_minor)).toBe(owedForPart);
      await reject(v2, await segmentOf(order.id, v2)); // repeat: 400, nothing more
      expect((await ledger(c, 'ORDER_REFUND')).length).toBe(1);
    });

    it('MANUAL TRANSFER (approved): the refund obligation is the amount paid for the rejected part, recorded once', async () => {
      await createOffer({ vendorBranchId: v2.branchId, name: 'T', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 500, couponCode: 'PD14TRF' });
      const c = await cartFor([p1, p2]);
      const order = await s.checkout(c, home, 'MANUAL_TRANSFER', { couponCode: 'PD14TRF' });
      const payment = (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [order.id]))[0];
      await world.api('post', `/payments/manual-transfer/orders/${order.id}/claim`, { token: c.accessToken, body: {} });
      expectData(await world.api('post', `/admin/manual-transfer-payments/${payment.id}/approve`, { token: reviewer.accessToken }), 201);
      const before = await orderRow(order.id);
      expectData(await reject(v2, await segmentOf(order.id, v2)));
      const owedForPart = 20000 - 1000 + ADDITIONAL_VENDOR_FEE; // 5 % of 20000 = 1000
      expect((await refundEvents(order.id)).map((e: any) => num(e.amount_minor))).toEqual([owedForPart]);
      expect(num(before.total_minor) - num((await orderRow(order.id)).total_minor)).toBe(owedForPart);
      await reject(v2, await segmentOf(order.id, v2));
      expect((await refundEvents(order.id)).length).toBe(1);
    });

    it('MULTIPLE rejected parts (automatic offers on three vendors): each rejected part restores its own discount; the remaining part keeps its own', async () => {
      const m1 = await s.vendor({ name: 'PD M1', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
      const m2 = await s.vendor({ name: 'PD M2', serviceAreaId: area.id, lat: 30.432, lng: 31.572 });
      const m3 = await s.vendor({ name: 'PD M3', serviceAreaId: area.id, lat: 30.442, lng: 31.582 });
      const [q1, q2, q3] = [await s.product(m1, { priceMinor: 10000, inventoryMode: 'OPEN' }), await s.product(m2, { priceMinor: 20000, inventoryMode: 'OPEN' }), await s.product(m3, { priceMinor: 30000, inventoryMode: 'OPEN' })];
      const o1 = await createOffer({ vendorBranchId: m1.branchId, name: 'A1', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500 });
      const o2 = await createOffer({ vendorBranchId: m2.branchId, name: 'A2', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 700 });
      const o3 = await createOffer({ vendorBranchId: m3.branchId, name: 'A3', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 900 });
      const c = await cartFor([q1, q2, q3]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      expect(order.discountMinor).toBe(2100);

      expectData(await reject(m1, await segmentOf(order.id, m1)));
      expectData(await reject(m3, await segmentOf(order.id, m3)));
      const after = await orderRow(order.id);
      expect(after.status).toBe('PENDING');
      expect(num(after.discount_minor)).toBe(700); // only m2's discount remains
      expect(num(after.subtotal_minor)).toBe(20000);
      expectConsistent(after);
      expect([num((await offerRow(o1.id)).consumed_units_count), num((await offerRow(o2.id)).consumed_units_count), num((await offerRow(o3.id)).consumed_units_count)]).toEqual([0, 1, 0]);
      expect([num((await offerRow(o1.id)).consumed_discount_minor), num((await offerRow(o2.id)).consumed_discount_minor), num((await offerRow(o3.id)).consumed_discount_minor)]).toEqual([0, 700, 0]);

      expectData(await reject(m2, await segmentOf(order.id, m2))); // the final remaining part
      expect((await orderRow(order.id)).status).toBe('CANCELLED');
      expect(num((await offerRow(o2.id)).consumed_units_count)).toBe(0);
      expect((await consumptions(order.id)).every((r: any) => r.is_reversed)).toBe(true);
    });

    it('FLASH SALE + coupon on the same vendor: rejecting it returns BOTH the flash-sale allocation and the coupon entitlement; the coupon never applied to the flash-sale item', async () => {
      const vf = await s.vendor({ name: 'PD Flash', serviceAreaId: area.id, lat: 30.423, lng: 31.563 }); // its own vendor: the other coupons here are branch-wide
      const pFlash = await s.product(vf, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const pPlain = await s.product(vf, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const flash = await createOffer({ vendorBranchId: vf.branchId, name: 'Flash', mechanism: 'FLASH_SALE', specialPriceMinor: 8000, productIds: [pFlash.id] });
      const coupon = await createOffer({ vendorBranchId: vf.branchId, name: 'Cpn', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, couponCode: 'PD14FLASH', productIds: [pPlain.id] });
      const c = await cartFor([pFlash, pPlain]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', couponCode: 'PD14FLASH' }), 201);
      expect(order.discountMinor).toBe(2000 + 1000); // flash 2000 on the flash item + 10 % of the OTHER item only
      expect(num((await offerRow(flash.id)).consumed_units_count)).toBe(1);
      expect(num((await offerRow(coupon.id)).consumed_units_count)).toBe(1);

      expectData(await reject(vf, await segmentOf(order.id, vf)));
      expect((await orderRow(order.id)).status).toBe('CANCELLED'); // it was the only vendor
      expect(num((await offerRow(flash.id)).consumed_units_count)).toBe(0);
      expect(num((await offerRow(coupon.id)).consumed_units_count)).toBe(0);
      expect(num((await offerRow(coupon.id)).consumed_discount_minor)).toBe(0);
      const rows = await consumptions(order.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r: any) => r.is_reversed)).toBe(true);
    });

    it('whole-order cancellation by the customer, by an admin and after a repeat: the coupon is restored once each time it applies', async () => {
      const offer = await createOffer({ vendorBranchId: v1.branchId, name: 'WholeCpn', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 800, couponCode: 'PD14WHOLE' });
      const c1 = await cartFor([p1]);
      const o1 = expectData<any>(await place(c1, { paymentMethod: 'COD', couponCode: 'PD14WHOLE' }), 201);
      const c2 = await cartFor([p1]);
      const o2 = expectData<any>(await place(c2, { paymentMethod: 'COD', couponCode: 'PD14WHOLE' }), 201);
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(2);

      expectData(await cancel(c1, o1.id), 201);
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(1);
      await cancel(c1, o1.id);
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(1);

      expectData(await world.api('patch', `/orders/${o2.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'support' } }));
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(0);
      expect(num((await offerRow(offer.id)).consumed_discount_minor)).toBe(0);
    });

    it('rejecting a vendor part that carried NO discount does not touch another part\'s coupon (the entitlement belongs to its own segment)', async () => {
      const offer = await createOffer({ vendorBranchId: v1.branchId, name: 'Own', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 600, couponCode: 'PD14OWN' });
      const c = await cartFor([p1, p3]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', couponCode: 'PD14OWN' }), 201);
      expectData(await reject(v3, await segmentOf(order.id, v3)));
      expect(num((await offerRow(offer.id)).consumed_units_count)).toBe(1);
      expect((await consumptions(order.id)).map((r: any) => r.is_reversed)).toEqual([false]);
      expect(num((await orderRow(order.id)).discount_minor)).toBe(600);
    });
  });
});
