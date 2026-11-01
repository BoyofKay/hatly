/**
 * PD-006 — wallet payment, immutable order snapshots, ETA, timeline, tracking, the order list tabs and the refined customer
 * cancellation rule, over real HTTP against real PostgreSQL.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — wallet, snapshots, ETA, tracking, order list (PD-006)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let superAdmin: Actor;
  let reviewer: Actor;
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  const home = { lat: 30.425, lng: 31.565 };

  const num = (v: unknown) => Number(v);
  const addr = (extra: Record<string, unknown> = {}) => ({ line1: 'Wallet Street 1', latitude: home.lat, longitude: home.lng, ...extra });
  const place = async (c: Actor, body: Record<string, unknown>) => world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: addr(), ...body }) });
  const quote = async (c: Actor, body: Record<string, unknown> = {}) => expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: addr(), ...body } }), 201);
  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const details = async (c: Actor, id: string) => expectData<any>(await world.api('get', `/orders/${id}`, { token: c.accessToken }));
  const cancel = (c: Actor, id: string) => world.api('post', `/orders/${id}/cancel`, { token: c.accessToken, body: {} });
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;
  const vendorStatus = (v: VendorFixture, segmentId: string, body: Record<string, unknown>) => world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body });
  const patchBranch = async (v: VendorFixture, body: Record<string, unknown>) => expectData(await world.api('patch', `/admin/vendor-branches/${v.branchId}`, { token: superAdmin.accessToken, body }));
  const cartFor = async (products: Array<{ id: string }>, quantities: number[] = []) => {
    const c = await s.customer();
    for (let i = 0; i < products.length; i++) await s.addToCart(c, products[i].id, quantities[i] ?? 1);
    return c;
  };
  // The wallet can only be credited by loyalty conversion or an approved cash remainder today; the e2e seeds a credit row directly
  // (a documented seam) — every DEBIT below goes through the real checkout.
  let seed = 0;
  const credit = (c: Actor, amountMinor: number) =>
    world.ds.query("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, $2, 'ADMIN_CREDIT', $3, 'e2e seed')", [c.id, amountMinor, `e2e-seed-${c.id}-${seed++}`]);
  const balance = async (c: Actor) => num((await world.ds.query('SELECT COALESCE(SUM(amount_delta_minor), 0) AS b FROM wallet_transactions WHERE customer_id = $1', [c.id]))[0].b);
  const ledger = (c: Actor, type: string) => world.ds.query('SELECT amount_delta_minor, order_id, idempotency_key FROM wallet_transactions WHERE customer_id = $1 AND type = $2 ORDER BY created_at', [c.id, type]);
  const expectConsistent = (row: any) => expect(num(row.total_minor)).toBe(num(row.subtotal_minor) + num(row.delivery_fee_minor) - num(row.discount_minor));

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'WT 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'WT 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    await s.driver({ lat: 30.4212, lng: 31.5612 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('wallet payment', () => {
    it('PARTIAL: the wallet is used first, the server decides the amount, the rest stays on COD; one ORDER_PAYMENT ledger debit; nothing goes negative', async () => {
      const c = await cartFor([p1]); // subtotal 10000 + fee
      await credit(c, 5000);
      const q = (await quote(c, { paymentMethod: 'COD', useWallet: true })).payment.wallet;
      expect(q).toMatchObject({ balanceMinor: 5000, appliedMinor: 5000, available: true });

      const order = expectData<any>(await place(c, { paymentMethod: 'COD', useWallet: true }), 201);
      expect(order).toMatchObject({ paymentMethod: 'COD', walletAmountMinor: 5000, amountDueMinor: order.totalMinor - 5000 });
      expect(await balance(c)).toBe(0);
      const debits = await ledger(c, 'ORDER_PAYMENT');
      expect(debits.map((d: any) => [num(d.amount_delta_minor), d.order_id, d.idempotency_key])).toEqual([[-5000, order.id, `order-payment:${order.id}`]]);
      expect(await paymentOf(order.id)).toBeUndefined(); // the remainder is cash: no payment row
      const d = await details(c, order.id);
      expect(d.payment).toMatchObject({ method: 'COD', walletAmountMinor: 5000, amountDueMinor: order.totalMinor - 5000, status: 'DUE_ON_DELIVERY' });
    });

    it('PARTIAL + Pay-at-Delivery keeps BOTH the wallet amount and the electronic method for the remainder', async () => {
      const c = await cartFor([p1]);
      await credit(c, 3000);
      const order = expectData<any>(await place(c, { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'WE_PAY', useWallet: true }), 201);
      expect(order).toMatchObject({ paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'WE_PAY', walletAmountMinor: 3000, amountDueMinor: order.totalMinor - 3000 });
    });

    it('FULL: when the wallet covers the order the source is WALLET, nothing is due, no electronic method, and fulfilment proceeds', async () => {
      const c = await cartFor([p1]);
      await credit(c, 100000);
      const q = await quote(c, { paymentMethod: 'COD', useWallet: true });
      expect(q.summary).toMatchObject({ walletAppliedMinor: q.summary.totalMinor, amountDueMinor: 0 });
      expect(q.payment.selected.method).toBe('WALLET');

      const order = expectData<any>(await place(c, { paymentMethod: 'COD', useWallet: true, quoteToken: q.quoteToken }), 201);
      expect(order).toMatchObject({ paymentMethod: 'WALLET', walletAmountMinor: order.totalMinor, amountDueMinor: 0, electronicPaymentMethod: null });
      expect(await balance(c)).toBe(100000 - order.totalMinor);
      expect((await details(c, order.id)).payment).toMatchObject({ method: 'WALLET', status: 'PAID', awaitingApproval: false, amountDueMinor: 0 });
      await s.vendorPrepares(v1, order.id);
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
    });

    it('method WALLET explicitly: same result when covered; refused (WALLET_INSUFFICIENT_BALANCE) when it is not — the client cannot force a debit beyond the balance', async () => {
      const rich = await cartFor([p1]);
      await credit(rich, 100000);
      expect(expectData<any>(await place(rich, { paymentMethod: 'WALLET' }), 201).paymentMethod).toBe('WALLET');

      const poor = await cartFor([p1]);
      await credit(poor, 100);
      const res = await place(poor, { paymentMethod: 'WALLET' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toMatchObject({ code: 'WALLET_INSUFFICIENT_BALANCE', balanceMinor: 100 });
      expect(await balance(poor)).toBe(100);
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [poor.id])).toEqual([]);
    });

    it('a client-supplied wallet amount can only LOWER the server amount, never raise it', async () => {
      const c = await cartFor([p1]);
      await credit(c, 8000);
      expect((await quote(c, { paymentMethod: 'COD', useWallet: true, walletAmountMinor: 2000 })).summary.walletAppliedMinor).toBe(2000);
      expect((await quote(c, { paymentMethod: 'COD', useWallet: true, walletAmountMinor: 999999 })).summary.walletAppliedMinor).toBe(8000); // the balance
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', useWallet: true, walletAmountMinor: 999999 }), 201);
      expect(order.walletAmountMinor).toBe(8000);
      expect((await place(c, { paymentMethod: 'COD', walletAmountMinor: 0 })).status).toBe(400); // must be a positive integer
    });

    it('the wallet is not offered when its balance is empty or unusable: no debit, no wallet amount', async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', useWallet: true }), 201);
      expect(order.walletAmountMinor).toBe(0);
      expect(await ledger(c, 'ORDER_PAYMENT')).toEqual([]);
    });

    it('PD-001 (amended): wallet + MANUAL_TRANSFER is ACCEPTED (full coverage: see e2e 67); weighed and unpriced orders still cannot use the wallet', async () => {
      const c = await cartFor([p1]);
      await credit(c, 5000);
      const mt = expectData<any>(await place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY', useWallet: true }), 201);
      expect(num((await orderRow(mt.id)).wallet_amount_minor)).toBe(5000);
      expect(num((await paymentOf(mt.id)).amount_minor)).toBe(mt.totalMinor - 5000); // the Payment holds ONLY the remainder
      expect(await balance(c)).toBe(0);

      const cheese = await s.product(v1, { priceMinor: 20000, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN' });
      const w = await s.customer();
      await s.addToCart(w, cheese.id, 1, { requestedWeightGrams: 500 });
      await credit(w, 50000);
      const weighed = await place(w, { paymentMethod: 'COD', useWallet: true });
      expect(weighed.status).toBe(400);
      expect(weighed.body.error.details.code).toBe('WALLET_NOT_ALLOWED_FOR_WEIGHTED_ORDER');
      expect((await quote(w, { paymentMethod: 'COD', useWallet: true })).payment.wallet.available).toBe(false);
      expect(await balance(w)).toBe(50000);
    });

    it('a balance that changed after the quote makes it stale (the amount due would differ) — never a different charge', async () => {
      const c = await cartFor([p1]);
      await credit(c, 5000);
      const q = await quote(c, { paymentMethod: 'COD', useWallet: true });
      await world.ds.query("INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, idempotency_key, reason) VALUES ($1, -3000, 'ADJUSTMENT', $2, 'e2e drain')", [c.id, `e2e-drain-${c.id}`]);
      const res = await place(c, { paymentMethod: 'COD', useWallet: true, quoteToken: q.quoteToken });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ code: 'QUOTE_STALE', reason: 'AMOUNTS_CHANGED' });
      expect(res.body.error.details.changes).toEqual(expect.arrayContaining(['walletAppliedMinor', 'amountDueMinor']));
      expect(await balance(c)).toBe(2000);
    });

    it('CONCURRENCY: five simultaneous submits of one wallet order create ONE order and ONE debit; the balance never goes negative', async () => {
      const c = await cartFor([p1]);
      await credit(c, 4000);
      const results = await Promise.all(Array.from({ length: 5 }, () => place(c, { paymentMethod: 'COD', useWallet: true })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(await ledger(c, 'ORDER_PAYMENT')).toHaveLength(1);
      expect(await balance(c)).toBe(0);
    });

    it('REFUND: cancelling a wallet-paid order credits the wallet exactly what it paid, once, to the ledger (never elsewhere)', async () => {
      const c = await cartFor([p1]);
      await credit(c, 100000);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', useWallet: true }), 201);
      expect(await balance(c)).toBe(100000 - order.totalMinor);
      expectData(await cancel(c, order.id), 201);
      const refunds = await ledger(c, 'ORDER_REFUND');
      expect(refunds.map((r: any) => [num(r.amount_delta_minor), r.order_id, r.idempotency_key])).toEqual([[order.totalMinor, order.id, `order-refund:${order.id}:cancel`]]);
      expect(await balance(c)).toBe(100000);
      expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED', amount_due_minor: 0, delivery_fee_minor: 0, total_minor: 0 });
      expect((await cancel(c, order.id)).status).toBe(400); // a repeat refunds nothing
      expect(await ledger(c, 'ORDER_REFUND')).toHaveLength(1);
      // admin cancellation of a wallet-paid order refunds the same way
      const c2 = await cartFor([p1]);
      await credit(c2, 100000);
      const o2 = expectData<any>(await place(c2, { paymentMethod: 'WALLET' }), 201);
      expectData(await world.api('patch', `/orders/${o2.id}/status`, { token: superAdmin.accessToken, body: { status: 'CANCELLED', cancellationReason: 'admin' } }));
      expect(await balance(c2)).toBe(100000);
    });

    it('a partial COD wallet order cancelled by the customer: the wallet part goes back to the wallet, the cash part was never paid', async () => {
      const c = await cartFor([p1]);
      await credit(c, 5000);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD', useWallet: true }), 201);
      expectData(await cancel(c, order.id), 201);
      expect(await balance(c)).toBe(5000);
      expect((await ledger(c, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([5000]);
    });

    it('VENDOR SEGMENT cancellation: only the EXCESS of what the wallet paid over what is still owed returns to the wallet; what is due through COD shrinks with the order', async () => {
      // fully wallet-paid two-vendor order: cancelling vendor 2 returns exactly the reduction
      const full = await cartFor([p1, p2]);
      await credit(full, 100000);
      const o = expectData<any>(await place(full, { paymentMethod: 'WALLET' }), 201);
      const removed = 20000 + 500; // vendor 2's merchandise + one additional-vendor fee
      expectData(await vendorStatus(v2, await segmentOf(o.id, v2), { status: 'CANCELLED', reason: 'Out of stock' }));
      const row = await orderRow(o.id);
      expect(num(row.total_minor)).toBe(o.totalMinor - removed);
      expect(await balance(full)).toBe(100000 - o.totalMinor + removed);
      expect((await ledger(full, 'ORDER_REFUND')).map((r: any) => num(r.amount_delta_minor))).toEqual([removed]);
      expect(num(row.amount_due_minor)).toBe(0);
      expectConsistent(row);
      // cancelling the last vendor returns the rest — the wallet ends where it started
      expectData(await vendorStatus(v1, await segmentOf(o.id, v1), { status: 'CANCELLED', reason: 'Out of stock' }));
      expect(await balance(full)).toBe(100000);
      expect((await ledger(full, 'ORDER_REFUND')).reduce((sum: number, r: any) => sum + num(r.amount_delta_minor), 0)).toBe(o.totalMinor);

      // partial wallet (5000) + COD remainder: the reduction is absorbed by the cash part — the wallet keeps paying its 5000
      const part = await cartFor([p1, p2]);
      await credit(part, 5000);
      const o2 = expectData<any>(await place(part, { paymentMethod: 'COD', useWallet: true }), 201);
      expectData(await vendorStatus(v2, await segmentOf(o2.id, v2), { status: 'CANCELLED', reason: 'Out of stock' }));
      const row2 = await orderRow(o2.id);
      expect(await ledger(part, 'ORDER_REFUND')).toEqual([]);
      expect(num(row2.amount_due_minor)).toBe(num(row2.total_minor) - 5000);
    });
  });

  describe('immutable snapshots — history never follows the catalog', () => {
    it('renaming / repricing / re-addressing the vendor, product and saved address afterwards never changes the order', async () => {
      const v = await s.vendor({ name: 'Snap Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const pv = await s.product(v, { name: 'Snap Burger', priceMinor: 12000, inventoryMode: 'OPEN' });
      const c = await s.customer();
      await s.addToCart(c, pv.id, 2);
      const saved = expectData<any>(await world.api('post', '/addresses', { token: c.accessToken, body: { deliveryZoneId: await s.defaultDeliveryZoneId(), line1: 'Original Street 9', latitude: home.lat, longitude: home.lng, governorate: 'الشرقية', landmark: 'near the mosque' } }), 201);
      const order = expectData<any>(await place(c, { addressId: saved.id, deliveryAddress: undefined, paymentMethod: 'COD' }), 201);
      const before = await details(c, order.id);

      await world.ds.query("UPDATE products SET name = 'Renamed', price_minor = 99999, image_url = 'https://cdn/new.png' WHERE id = $1", [pv.id]);
      await world.ds.query("UPDATE vendors SET name = 'Renamed Vendor' WHERE id = (SELECT vendor_id FROM vendor_branches WHERE id = $1)", [v.branchId]);
      await world.ds.query("UPDATE vendor_branches SET name = 'New Branch', address = 'Somewhere Else' WHERE id = $1", [v.branchId]);
      expectData(await world.api('patch', `/addresses/${saved.id}`, { token: c.accessToken, body: { line1: 'Changed Street', landmark: 'changed' } }));

      const after = await details(c, order.id);
      expect(after.segments).toEqual(before.segments);
      expect(after.deliveryAddressSnapshot).toEqual(before.deliveryAddressSnapshot);
      expect(after.deliveryAddressSnapshot).toMatchObject({ line1: 'Original Street 9', governorate: 'الشرقية', landmark: 'near the mosque' });
      expect(after).toMatchObject({ subtotalMinor: before.subtotalMinor, deliveryFeeMinor: before.deliveryFeeMinor, totalMinor: before.totalMinor });
      expect(after.segments[0]).toMatchObject({ vendorBranchName: 'Snap Vendor', branchAddress: '1 Test Street' });
      expect(after.segments[0].items[0]).toMatchObject({ productNameSnapshot: 'Snap Burger', unitPriceMinor: 12000 });
      expect(after.deliveryBreakdown).toMatchObject({ vendorCount: 1, frozenTotalFeeMinor: order.deliveryFeeMinor });
    });

    it('there is no customer route that edits an order\'s address, items or amounts', async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      for (const [method, path] of [['patch', `/orders/${order.id}`], ['put', `/orders/${order.id}`], ['patch', `/orders/${order.id}/address`], ['post', `/orders/${order.id}/address`]] as const) {
        const res = await world.api(method, path, { token: c.accessToken, body: { deliveryAddress: addr({ line1: 'hijack' }), totalMinor: 1 } });
        expect([404, 405]).toContain(res.status);
      }
      expect((await orderRow(order.id)).delivery_address_snapshot.line1).toBe('Wallet Street 1');
    });
  });

  describe('ETA, timeline and tracking', () => {
    it('an order gets a preparation estimate ONLY from the branch\'s configured time; the ETA moves with the vendor\'s estimate and never touches money', async () => {
      await patchBranch(v1, { preparationTimeMinutes: 25 });
      try {
        const c = await cartFor([p1]);
        const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
        const seg = await segmentOf(order.id, v1);
        const row = (await world.ds.query('SELECT preparation_estimate_minutes, expected_ready_at, created_at FROM order_vendor_segments WHERE id = $1', [seg]))[0];
        expect(row.preparation_estimate_minutes).toBe(25);
        expect(new Date(row.expected_ready_at).getTime() - new Date(row.created_at).getTime()).toBeGreaterThan(24 * 60_000);

        const d = await details(c, order.id);
        expect(d.eta.state).toBe('ESTIMATED');
        const travelSeconds = num((await orderRow(order.id)).estimated_travel_seconds);
        expect(travelSeconds).toBeGreaterThan(0);
        expect(new Date(d.eta.estimatedAt).getTime()).toBeCloseTo(new Date(row.expected_ready_at).getTime() + travelSeconds * 1000, -3);

        // the vendor refines its estimate (operational) — the ETA follows, the money does not move
        const later = new Date(Date.now() + 90 * 60_000).toISOString();
        expectData(await vendorStatus(v1, seg, { status: 'CONFIRMED', expectedReadyAt: later }));
        const d2 = await details(c, order.id);
        expect(new Date(d2.eta.estimatedAt).getTime()).toBeGreaterThan(new Date(d.eta.estimatedAt).getTime());
        expect(d2).toMatchObject({ subtotalMinor: d.subtotalMinor, deliveryFeeMinor: d.deliveryFeeMinor, discountMinor: d.discountMinor, totalMinor: d.totalMinor });
        expect(d2.eta.delayed).toBe(false);
      } finally {
        await patchBranch(v1, { preparationTimeMinutes: null });
      }
    });

    it('with no preparation time configured the ETA is UNAVAILABLE with a reason — no fabricated number; cancelled / delivered orders have none', async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      expect((await details(c, order.id)).eta).toMatchObject({ state: 'UNAVAILABLE', reason: 'PREPARATION_TIME_NOT_CONFIGURED', estimatedAt: null });
      expectData(await cancel(c, order.id), 201);
      expect((await details(c, order.id)).eta).toMatchObject({ state: 'CANCELLED', estimatedAt: null });
    });

    it('the timeline records every status change in order, with its actor role; created → confirmed → … → cancelled', async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      expectData(await world.api('patch', `/orders/${order.id}/status`, { token: superAdmin.accessToken, body: { status: 'CONFIRMED' } }));
      expectData(await cancel(c, order.id), 201);
      const d = await details(c, order.id);
      expect(d.timeline.map((t: any) => [t.status, t.actorRole])).toEqual([['PENDING', 'CUSTOMER'], ['CONFIRMED', 'SUPER_ADMIN'], ['CANCELLED', 'CUSTOMER']]);
      const times = d.timeline.map((t: any) => new Date(t.at).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    });

    it('tracking (V1): status, ETA, timeline, per-vendor progress and payment state — with NO driver, NO location, and only for the owner', async () => {
      await patchBranch(v1, { preparationTimeMinutes: 10 });
      await patchBranch(v2, { preparationTimeMinutes: 30 });
      try {
        const c = await cartFor([p1, p2]);
        const order = expectData<any>(await place(c, { paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'ORANGE_CASH' }), 201);
        expectData(await vendorStatus(v1, await segmentOf(order.id, v1), { status: 'CONFIRMED' }));
        const t = expectData<any>(await world.api('get', `/orders/${order.id}/tracking`, { token: c.accessToken }));
        expect(t).toMatchObject({ orderId: order.id, status: 'PENDING', fulfillmentType: 'DELIVERY', customerCanCancel: true });
        // Updated by the ETA/Manual Transfer timing fix (production-readiness slice, see 69-eta-payment-review.e2e-spec.ts):
        // preparation is gated on payment approval, so a still-PENDING transfer reports UNAVAILABLE/PAYMENT_NOT_APPROVED here
        // — never a countdown that implies preparation already started.
        expect(t.eta).toMatchObject({ state: 'UNAVAILABLE', reason: 'PAYMENT_NOT_APPROVED' });
        expect(t.segments.map((x: any) => [x.vendorName, x.status, x.preparationEstimateMinutes])).toEqual(expect.arrayContaining([['WT 1', 'CONFIRMED', 10], ['WT 2', 'PENDING', 30]]));
        expect(t.payment).toMatchObject({ method: 'MANUAL_TRANSFER', electronicMethod: 'ORANGE_CASH', status: 'PENDING', awaitingApproval: true });
        expect(t.timeline[0]).toMatchObject({ status: 'PENDING' });
        const json = JSON.stringify(t);
        for (const forbidden of ['driver', 'latitude', 'longitude', 'lastLocation', 'phone']) expect(json).not.toContain(forbidden);

        const stranger = await s.customer();
        expect((await world.api('get', `/orders/${order.id}/tracking`, { token: stranger.accessToken })).status).toBe(404);
        expect((await world.api('get', `/orders/${order.id}/tracking`)).status).toBe(401);
        expect((await world.api('get', `/orders/${order.id}/tracking`, { token: v1.manager.accessToken })).status).toBe(403);
      } finally {
        await patchBranch(v1, { preparationTimeMinutes: null });
        await patchBranch(v2, { preparationTimeMinutes: null });
      }
    });
  });

  describe('order list tabs', () => {
    it('ongoing · completed · cancelled: each order in exactly one tab, with images, vendors, total, payment and ETA on the card', async () => {
      const c = await s.customer();
      await s.addToCart(c, p1.id, 1);
      const ongoing = await s.checkout(c, home, 'MANUAL_TRANSFER');
      await s.addToCart(c, p2.id, 1);
      const toCancel = await s.checkout(c, home);
      expectData(await cancel(c, toCancel.id), 201);
      await s.addToCart(c, p1.id, 1);
      const delivered = await s.checkout(c, home);
      await world.ds.query("UPDATE orders SET status = 'DELIVERED' WHERE id = $1", [delivered.id]);

      const tab = async (name: string) => expectData<any[]>(await world.api('get', `/orders?tab=${name}`, { token: c.accessToken }));
      expect((await tab('active')).map((o) => o.id)).toEqual([ongoing.id]);
      expect((await tab('completed')).map((o) => o.id)).toEqual([delivered.id]);
      expect((await tab('cancelled')).map((o) => o.id)).toEqual([toCancel.id]);
      const [card] = await tab('active');
      expect(card).toMatchObject({ vendorBranchNames: ['WT 1'], itemCount: 1, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY', awaitingPaymentApproval: true, totalMinor: ongoing.totalMinor });
      expect(card.eta).toMatchObject({ state: 'UNAVAILABLE' });
      expect((await world.api('get', '/orders?tab=nonsense', { token: c.accessToken })).status).toBe(400);
      expect(expectData<any[]>(await world.api('get', '/orders', { token: c.accessToken })).map((o) => o.id).sort()).toEqual([ongoing.id, toCancel.id, delivered.id].sort());
    });
  });

  describe('customer cancellation — refined (PD-005/PD-006)', () => {
    it('the customer can no longer cancel once ANY active vendor has started PREPARING — even while the order status is still PENDING; cancelled segments do not count', async () => {
      const c = await cartFor([p1, p2]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      const seg1 = await segmentOf(order.id, v1);
      expect((await orderRow(order.id)).status).toBe('PENDING');
      expect((await details(c, order.id)).customerCanCancel).toBe(true);

      for (const st of ['CONFIRMED', 'PREPARING']) expectData(await vendorStatus(v1, seg1, { status: st }));
      expect((await orderRow(order.id)).status).toBe('PENDING'); // the order-level status has not moved
      expect((await details(c, order.id)).customerCanCancel).toBe(false);
      const res = await cancel(c, order.id);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', reason: 'VENDOR_SEGMENT_PREPARING' });
      expect((await orderRow(order.id)).status).toBe('PENDING');

      // if that vendor then cancels its own segment, the remaining (not preparing) vendor no longer blocks the customer
      expectData(await vendorStatus(v1, seg1, { status: 'CANCELLED', reason: 'Out of stock' }));
      expect((await details(c, order.id)).customerCanCancel).toBe(true);
      expectData(await cancel(c, order.id), 201);
    });

    it('a customer can never cancel just one vendor\'s segment (no such endpoint, and the vendor endpoint is closed to them)', async () => {
      const c = await cartFor([p1, p2]);
      const order = expectData<any>(await place(c, { paymentMethod: 'COD' }), 201);
      const seg = await segmentOf(order.id, v1);
      expect((await world.api('patch', `/vendor/orders/segments/${seg}/status`, { token: c.accessToken, body: { status: 'CANCELLED', reason: 'Out of stock' } })).status).toBe(403);
      expect((await world.api('post', `/orders/${order.id}/segments/${seg}/cancel`, { token: c.accessToken, body: {} })).status).toBe(404);
      expect((await orderRow(order.id)).status).toBe('PENDING');
    });
  });
});
