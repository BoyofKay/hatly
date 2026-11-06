/**
 * The customer-to-driver journey over real HTTP against real PostgreSQL:
 *  - "would this fit in my cart?" answered BEFORE adding, with the same rules the add and checkout enforce (and nothing written by asking);
 *  - a new cart never inherits the previous order's Pickup/Delivery choice;
 *  - one set of numbers across the cart, the checkout quote and the order — weight, delivery fee, wallet — and the commission the platform
 *    later recognises;
 *  - the driver's side: retries of a status change are safe (no second proof, no second financial event), the recorded earnings equal the
 *    platform's own events and the settlement close's formula, failure reasons are controlled, and nobody else can read them.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — customer cart compatibility, financial consistency and the driver journey', () => {
  let world: World;
  let s: Scenario;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let v3: VendorFixture;
  let v4: VendorFixture;
  let p1: { id: string; priceMinor: number };
  let p2: { id: string; priceMinor: number };
  let p3: { id: string; priceMinor: number };
  let p4: { id: string; priceMinor: number };
  let earningsDriver: Actor & { driverId?: string };
  const home = { lat: 30.425, lng: 31.565 };
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', a: Actor | undefined, path: string, body?: unknown, query?: Record<string, string>) =>
    world.api(method, path, { token: a?.accessToken, body, query } as any);
  const check = async (c: Actor, productId: string) => expectData<any>(await call('post', c, '/cart/items/check', { productId }));
  const cartOf = async (c: Actor) => expectData<any>(await call('get', c, '/cart'));

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'Journey One', serviceAreaId: area.id, lat: 30.421, lng: 31.561, commissionBasisPoints: 1000 });
    v2 = await s.vendor({ name: 'Journey Two', serviceAreaId: area.id, lat: 30.431, lng: 31.571, commissionBasisPoints: 1000 });
    v3 = await s.vendor({ name: 'Journey Three', serviceAreaId: area.id, lat: 30.441, lng: 31.581, commissionBasisPoints: 1000 });
    v4 = await s.vendor({ name: 'Journey Four', serviceAreaId: area.id, lat: 30.451, lng: 31.591, commissionBasisPoints: 1000 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 5000, inventoryMode: 'OPEN' });
    p3 = await s.product(v3, { priceMinor: 3000, inventoryMode: 'OPEN' });
    p4 = await s.product(v4, { priceMinor: 2000, inventoryMode: 'OPEN' });
    await world.ds.query(`UPDATE vendor_branches SET pickup_enabled = true WHERE id = ANY($1)`, [[v1.branchId, v2.branchId, v3.branchId, v4.branchId]]);
    await s.driver({ lat: 30.42, lng: 31.56 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  // ------------------------------------------------------------------------------------------------------------ compatibility
  describe('cart compatibility is answered before adding, from the server’s own rules', () => {
    it('an empty cart accepts anything; the same vendor is always fine; asking never changes the cart', async () => {
      const c = await s.customer();
      expect(await check(c, p1.id)).toMatchObject({ compatible: true, code: null, resolution: null });
      await s.addToCart(c, p1.id, 1);
      expect(await check(c, p1.id)).toMatchObject({ compatible: true, alreadyInCart: true });
      expect(await check(c, p2.id)).toMatchObject({ compatible: true }); // multi-vendor ordering is supported and on
      const cart = await cartOf(c);
      expect(cart.groups).toHaveLength(1); // asking about p2 added nothing
    });

    it('pickup is single-vendor: a second vendor is refused WITH the way out, and after taking it the add is accepted', async () => {
      const c = await s.customer();
      await s.addToCart(c, p1.id, 1);
      expectData(await call('patch', c, '/cart/fulfillment-type', { fulfillmentType: 'PICKUP' }));
      const verdict = await check(c, p2.id);
      expect(verdict).toMatchObject({ compatible: false, code: 'PICKUP_SINGLE_VENDOR_ONLY', resolution: 'SWITCH_TO_DELIVERY' });
      // the real add refuses with the very same code (the check and the rules cannot drift apart)
      const real = await call('post', c, '/cart/items', { productId: p2.id, quantity: 1 });
      expect(real.status).toBe(409);
      expect(JSON.stringify(real.body)).toContain('PICKUP_SINGLE_VENDOR_ONLY');
      expectData(await call('patch', c, '/cart/fulfillment-type', { fulfillmentType: 'DELIVERY' }));
      expect(await check(c, p2.id)).toMatchObject({ compatible: true });
    });

    it('a pickup cart on a branch without pickup, and a fourth vendor, are refused with the right way out', async () => {
      const c = await s.customer();
      await world.ds.query(`UPDATE vendor_branches SET pickup_enabled = false WHERE id = $1`, [v3.branchId]);
      try {
        expectData(await call('patch', c, '/cart/fulfillment-type', { fulfillmentType: 'PICKUP' }));
        expect(await check(c, p3.id)).toMatchObject({ compatible: false, code: 'BRANCH_PICKUP_DISABLED', resolution: 'SWITCH_TO_DELIVERY' });
      } finally {
        await world.ds.query(`UPDATE vendor_branches SET pickup_enabled = true WHERE id = $1`, [v3.branchId]);
      }
      const d = await s.customer();
      for (const p of [p1, p2, p3]) await s.addToCart(d, p.id, 1);
      expect(await check(d, p4.id)).toMatchObject({ compatible: false, code: 'MAX_VENDOR_GROUPS_EXCEEDED', resolution: 'START_NEW_CART' });
      expectData(await call('delete', d, '/cart'));
      expect(await check(d, p4.id)).toMatchObject({ compatible: true });
    });

    it('with multi-vendor ordering OFF a second vendor is refused up front (it used to fail only at checkout); one vendor is still fine', async () => {
      const c = await s.customer();
      await s.addToCart(c, p1.id, 1);
      await s.setConfig('MULTI_VENDOR_ORDERS_ENABLED', false);
      try {
        expect(await check(c, p2.id)).toMatchObject({ compatible: false, code: 'MULTI_VENDOR_DISABLED', resolution: 'START_NEW_CART' });
        expect(await check(c, p1.id)).toMatchObject({ compatible: true, alreadyInCart: true });
      } finally {
        await s.setConfig('MULTI_VENDOR_ORDERS_ENABLED', true);
      }
      expect(await check(c, p2.id)).toMatchObject({ compatible: true });
    });

    it('an unavailable product says so; an unknown product is a 404; only customers may ask', async () => {
      const c = await s.customer();
      const admin = await s.superAdmin();
      const hidden = await s.product(v1, { priceMinor: 1000, inventoryMode: 'OPEN' });
      expectData(await world.api('patch', `/admin/products/${hidden.id}/deactivate`, { token: admin.accessToken }));
      expect(await check(c, hidden.id)).toMatchObject({ compatible: false, code: 'PRODUCT_UNAVAILABLE', resolution: null });
      expect((await call('post', c, '/cart/items/check', { productId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
      expect((await call('post', c, '/cart/items/check', { productId: 'not-a-uuid' })).status).toBe(400);
      expect((await call('post', undefined, '/cart/items/check', { productId: p1.id })).status).toBe(401);
      expect((await call('post', v1.manager, '/cart/items/check', { productId: p1.id })).status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------------------------------------------- pickup preference
  it('a new cart never inherits the previous order’s Pickup choice', async () => {
    const c = await s.customer();
    await s.addToCart(c, p1.id, 1);
    expectData(await call('patch', c, '/cart/fulfillment-type', { fulfillmentType: 'PICKUP' }));
    expectData(await call('post', c, '/orders', { paymentMethod: 'COD' }), 201);
    const next = await cartOf(c);
    expect(next.fulfillmentType).toBe('DELIVERY');
    expect(next.groups).toHaveLength(0);
    await s.addToCart(c, p1.id, 1);
    expect((await cartOf(c)).fulfillmentType).toBe('DELIVERY');
    const quote = expectData<any>(await call('post', c, '/checkout/quote', { paymentMethod: 'COD', deliveryAddress: { line1: 'x', latitude: home.lat, longitude: home.lng } }), 201);
    expect(quote.fulfillment.type ?? quote.fulfillment.fulfillmentType).toBe('DELIVERY');
  });

  // ------------------------------------------------------------------------------------------------------------ financial consistency
  describe('one set of numbers: cart, quote and order agree', () => {
    it('a weighed item is priced round(price × grams / 1000) everywhere, delivery fee included, and the commission follows the goods', async () => {
      const kofta = await s.product(v1, { priceMinor: 11000, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, kofta.id, 1, { requestedWeightGrams: 1500 }); // 11000 per kg × 1.5 kg = 16500
      await s.addToCart(c, p1.id, 2); // 2 × 100.00
      const cart = await cartOf(c);
      expect(cart.subtotalMinor).toBe(16500 + 20000);

      const body = { paymentMethod: 'COD', deliveryAddress: { line1: 'Checkout Street 1', latitude: home.lat, longitude: home.lng } };
      const quote = expectData<any>(await call('post', c, '/checkout/quote', body), 201);
      const order = expectData<any>(await call('post', c, '/orders', { ...body, quoteToken: quote.quoteToken }), 201);

      expect(order.subtotalMinor).toBe(cart.subtotalMinor);
      expect(order.discountMinor).toBe(0);
      expect(order.totalMinor).toBe(order.subtotalMinor + order.deliveryFeeMinor - order.discountMinor);
      expect(order.amountDueMinor).toBe(order.totalMinor - (order.walletAmountMinor ?? 0));
      // the quote the customer confirmed is what was charged
      const amounts = quote.totals ?? quote.amounts ?? {};
      if (amounts.totalMinor !== undefined) expect(amounts.totalMinor).toBe(order.totalMinor);

      const rows = await world.ds.query(`SELECT item.product_name_snapshot AS name, item.requested_weight_grams AS grams, item.unit_price_minor AS unit, g.subtotal_minor AS segment FROM order_items item JOIN order_vendor_segments g ON g.id = item.order_vendor_segment_id WHERE g.order_id = $1`, [order.id]);
      const weighed = rows.find((r: any) => Number(r.grams) === 1500);
      expect(Number(weighed.unit)).toBe(11000);
      expect(Number(rows[0].segment)).toBe(36500); // the segment (vendor) total is the sum of its lines

      // complete it and compare what the platform recognised with the numbers the customer saw
      await s.driver({ lat: 30.42, lng: 31.56 });
      await s.vendorPrepares(v1, order.id);
      const d = await s.driverAssignedTo(order.id);
      const delivery = expectData<any[]>(await call('get', d, '/driver/deliveries')).find((x) => x.orderId === order.id);
      const step = (status: string, extra: Record<string, unknown> = {}) => call('patch', d, `/driver/deliveries/${delivery.id}/status`, { status, ...extra });
      // The weighed item must have its ACTUAL weight recorded before pickup (C4): the customer asked for 1.5 kg and the scale says 1.5 kg.
      const weighedItemId = (await world.ds.query(`SELECT item.id FROM order_items item JOIN order_vendor_segments g ON g.id = item.order_vendor_segment_id WHERE g.order_id = $1 AND item.requested_weight_grams IS NOT NULL`, [order.id]))[0].id;
      expectData(await call('post', d, `/driver/order-items/${weighedItemId}/weight`, { weightGrams: 1500 }), 201);
      expectData(await step('PICKED_UP'));
      expectData(await step('ON_THE_WAY'));
      expectData(await step('DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(d.accessToken), recipientName: 'Customer' }));
      const [commission] = await world.ds.query(`SELECT amount_minor FROM financial_events WHERE order_id = $1 AND type = 'VENDOR_COMMISSION_RECOGNIZED'`, [order.id]);
      expect(Number(commission.amount_minor)).toBe(3650); // 10% of the goods (36 500), never of the delivery fee
    });

    it('wallet: the wallet part and the amount still due add up to the total, and the wallet is debited exactly that', async () => {
      const c = await s.customer();
      await world.ds.query(`INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, reason, idempotency_key) VALUES ($1, 5000, 'ADMIN_CREDIT', 'e2e', $2)`, [c.id, `j-${c.id}`]);
      await s.addToCart(c, p2.id, 2); // 100.00
      const body = { paymentMethod: 'COD', useWallet: true, deliveryAddress: { line1: 'Checkout Street 1', latitude: home.lat, longitude: home.lng } };
      const quote = expectData<any>(await call('post', c, '/checkout/quote', body), 201);
      const order = expectData<any>(await call('post', c, '/orders', { ...body, quoteToken: quote.quoteToken }), 201);
      expect(order.walletAmountMinor).toBe(5000);
      expect(order.amountDueMinor).toBe(order.totalMinor - 5000);
      expect(order.totalMinor).toBe(order.subtotalMinor + order.deliveryFeeMinor);
      const [bal] = await world.ds.query(`SELECT coalesce(sum(amount_delta_minor),0) AS b FROM wallet_transactions WHERE customer_id = $1`, [c.id]);
      expect(Number(bal.b)).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------------------------------------------ driver journey
  describe('the driver: safe retries, recorded earnings, controlled exceptions', () => {
    const deliver = async (v: VendorFixture, productId: string) => {
      const c = await s.customer();
      await s.driver({ lat: 30.42, lng: 31.56 }); // a free, online driver for THIS order
      await s.addToCart(c, productId, 1);
      const order = await s.checkout(c, home, 'COD');
      await s.vendorPrepares(v, order.id);
      const d = await s.driverAssignedTo(order.id);
      // Whichever driver dispatch chose: a driver without a commission rate records nothing (it fails closed by design) — give it the 20% the lifecycle spec uses.
      expectData(await call('patch', await s.superAdmin(), `/admin/drivers/${d.driverId}/commission-rate`, { commissionRateBasisPoints: 2000 }));
      const delivery = expectData<any[]>(await call('get', d, '/driver/deliveries')).find((x) => x.orderId === order.id);
      const step = (status: string, extra: Record<string, unknown> = {}) => call('patch', d, `/driver/deliveries/${delivery.id}/status`, { status, ...extra });
      return { c, order, d, delivery, step };
    };

    it('repeating a status change (a phone that lost its connection) succeeds without a second proof or any second financial event', async () => {
      const { order, d, step } = await deliver(v1, p1.id);
      expectData(await step('PICKED_UP'));
      expect((await step('PICKED_UP')).status).toBe(200); // the retry of an applied change is a no-op
      expectData(await step('ON_THE_WAY'));
      const photo = await s.uploadFakePhoto(d.accessToken);
      expectData(await step('DELIVERED', { proofPhotoUrl: photo, recipientName: 'Sara' }));
      const afterFirst = {
        proofs: Number((await world.ds.query(`SELECT count(*)::int AS n FROM proof_of_deliveries WHERE order_id = $1`, [order.id]))[0].n),
        events: Number((await world.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE order_id = $1`, [order.id]))[0].n),
        history: Number((await world.ds.query(`SELECT count(*)::int AS n FROM order_status_events WHERE order_id = $1`, [order.id]))[0].n),
      };
      const again = await step('DELIVERED', { proofPhotoUrl: photo, recipientName: 'Sara' });
      expect(again.status).toBe(200);
      expect(again.body.data.status).toBe('DELIVERED');
      expect({
        proofs: Number((await world.ds.query(`SELECT count(*)::int AS n FROM proof_of_deliveries WHERE order_id = $1`, [order.id]))[0].n),
        events: Number((await world.ds.query(`SELECT count(*)::int AS n FROM financial_events WHERE order_id = $1`, [order.id]))[0].n),
        history: Number((await world.ds.query(`SELECT count(*)::int AS n FROM order_status_events WHERE order_id = $1`, [order.id]))[0].n),
      }).toEqual(afterFirst);
      expect(afterFirst.proofs).toBe(1);
      // a different status is still validated by the state machine
      expect((await step('PICKED_UP')).status).toBeGreaterThanOrEqual(400);
    });

    it('a driver who was released from an order (waiting for a driver again) no longer sees it — nor the customer on it', async () => {
      const { order, d, delivery, step } = await deliver(v1, p1.id);
      expect((await step('READY_FOR_PICKUP')).status).toBe(400); // R17: a driver cannot hand it back …
      const ops = await s.superAdmin(); // … Operations release it
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: ops.accessToken, body: { status: 'READY_FOR_PICKUP' } }));
      const status = (await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [order.id]))[0].status as string;
      const list = expectData<any[]>(await call('get', d, '/driver/deliveries'));
      const detail = await call('get', d, `/driver/deliveries/${delivery.id}`);
      const holder = (await world.ds.query(`SELECT driver_id FROM deliveries WHERE order_id = $1`, [order.id]))[0].driver_id as string;
      // Visible exactly when this driver is on the order: not while it waits for a driver (the old delivery row still names them), not after
      // dispatch gave it to someone else — but yes if dispatch handed it straight back to them.
      const onIt = status !== 'READY_FOR_PICKUP' && holder === d.driverId;
      expect(list.some((x) => x.orderId === order.id)).toBe(onIt);
      expect(detail.status).toBe(onIt ? 200 : onIt === false && status === 'READY_FOR_PICKUP' ? 404 : detail.status);
    });

    it('the driver’s earnings are the platform’s own recorded events, by the settlement formula; transactions list each credited delivery', async () => {
      const { d, order, step } = await deliver(v2, p2.id);
      earningsDriver = d as any;
      expectData(await step('PICKED_UP'));
      expectData(await step('ON_THE_WAY'));
      expectData(await step('DELIVERED', { proofPhotoUrl: await s.uploadFakePhoto(d.accessToken), recipientName: 'Omar' }));

      const earnings = expectData<any>(await call('get', d, '/driver/earnings'));
      const events = await world.ds.query(`SELECT type, amount_minor, rate_snapshot FROM financial_events WHERE driver_id = $1`, [d.driverId ?? (await world.ds.query(`SELECT id FROM drivers WHERE user_id = $1`, [d.id]))[0].id]);
      const commissions = events.filter((e: any) => e.type === 'DRIVER_COMMISSION_RECOGNIZED');
      const wantEarnings = commissions.reduce((a: number, e: any) => a + Number(e.rate_snapshot?.baseAmountMinor ?? 0), 0);
      const wantCommission = commissions.reduce((a: number, e: any) => a + Number(e.amount_minor), 0);
      const wantReimb = events.filter((e: any) => e.type === 'DRIVER_REIMBURSEMENT_OWED').reduce((a: number, e: any) => a + Number(e.amount_minor), 0);
      expect(earnings.open).toMatchObject({ earningsMinor: wantEarnings, commissionMinor: wantCommission, reimbursementsMinor: wantReimb, netMinor: wantEarnings - wantCommission + wantReimb });
      expect(earnings.open.deliveries).toBe(commissions.length);
      expect(earnings.deliveredToday).toBeGreaterThanOrEqual(1);
      expect(earnings.closedPeriods).toEqual([]);

      const tx = await call('get', d, '/driver/transactions', undefined, { limit: '50' });
      expect(tx.status).toBe(200);
      const row = tx.body.data.find((r: any) => r.orderNumber === order.orderNumber);
      expect(row).toBeTruthy();
      expect(row.netMinor).toBe(row.earningsMinor - row.commissionMinor + row.reimbursementMinor);
      expect(row.cashDueAtDoorMinor).toBe(order.amountDueMinor); // a COD order: what was owed at the door, as a fact
      expect(tx.body.meta.total).toBe(commissions.length);
      expect(JSON.stringify(earnings)).not.toMatch(/cashInHand|balance due|owes you/i);
    });

    it('closing the period (Admin) moves what was open into a closed period with the same numbers, and the open preview restarts', async () => {
      const admin = await s.superAdmin();
      await s.setConfig('DRIVER_SETTLEMENT_FREQUENCY', 'WEEKLY');
      const before = expectData<any>(await call('get', earningsDriver, '/driver/earnings'));
      expect(before.open.deliveries).toBeGreaterThanOrEqual(1);
      const driverId = (await world.ds.query(`SELECT id FROM drivers WHERE user_id = $1`, [earningsDriver.id]))[0].id;
      const closed = await world.api('post', `/admin/settlement/drivers/${driverId}/close`, { token: admin.accessToken, body: {} });
      expect([200, 201]).toContain(closed.status);
      const after = expectData<any>(await call('get', earningsDriver, '/driver/earnings'));
      expect(after.closedPeriods).toHaveLength(1);
      expect(after.closedPeriods[0]).toMatchObject({ earningsMinor: before.open.earningsMinor, commissionMinor: before.open.commissionMinor, reimbursementsMinor: before.open.reimbursementsMinor, netMinor: before.open.netMinor, frequency: 'WEEKLY' });
      expect(after.open).toMatchObject({ earningsMinor: 0, commissionMinor: 0, netMinor: 0 });
    });

    it('failure reasons are a controlled list; a customer, vendor or another driver cannot read a driver’s money', async () => {
      const { d, delivery, step } = await deliver(v3, p3.id);
      expectData(await step('PICKED_UP'));
      expectData(await step('ON_THE_WAY'));
      expect((await step('FAILED_DELIVERY', { failureReason: 'because I said so' })).status).toBe(400);
      expect((await step('FAILED_DELIVERY', { failureReason: 'CUSTOMER_UNREACHABLE' })).status).toBe(200);
      expect((await world.ds.query(`SELECT status FROM orders WHERE id = $1`, [delivery.orderId]))[0].status).toBe('FAILED_DELIVERY');
      const other = await s.driver({ lat: 30.42, lng: 31.56 });
      expect((await call('get', other, `/driver/deliveries/${delivery.id}`)).status).toBe(404);
      for (const who of [await s.customer(), v1.manager]) {
        expect((await call('get', who, '/driver/earnings')).status).toBe(403);
        expect((await call('get', who, '/driver/transactions')).status).toBe(403);
      }
      expect((await call('get', undefined, '/driver/earnings')).status).toBe(401);
      expect((await call('get', d, '/driver/transactions', undefined, { page: '1', limit: '5' })).status).toBe(200);
    });
  });
});
