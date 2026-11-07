/**
 * Hatly Service checkout with an UNPRICED request, over real HTTP. A Hatly Service order must be creatable while the price of
 * the custom request is still pending (explicit state, never a numeric 0), COD-only; Hatly operations later confirm the price
 * and the order's totals are recomputed authoritatively on the backend — atomically, idempotently and safely under concurrency.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, withQuoteToken, DEFAULT_PASSWORD } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Hatly Service: pending price → confirmed price', () => {
  let world: World;
  let s: Scenario;
  let pricer: Actor; // Hatly operations with MANAGE_HATLY_SERVICE_PRICING
  // PD-009 (amended): Hatly Service is priced and served by the address's ACTIVE zone (set in beforeAll); the pin is kept to
  // prove it plays no part in the price.
  const address: Record<string, unknown> = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56 };
  const COD = { deliveryAddress: address, paymentMethod: 'COD' };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    // PD-009 (amended): Hatly Service fee = the zone's fee × the multiplier. Registered-vendor distance pricing is deliberately
    // NOT configured here — Hatly Service must not depend on it.
    address.deliveryZoneId = (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id;
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    pricer = await s.admin([Permission.MANAGE_HATLY_SERVICE_PRICING]);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  const addItem = (c: Actor, body: Record<string, unknown>) => world.api('post', '/cart/adhoc-items', { token: c.accessToken, body });
  const buyItem = (description: string, extra: Record<string, unknown> = {}) => ({
    adHocPlaceName: 'Corner Pharmacy',
    adHocServiceType: 'BUY_FROM_PLACE',
    pickupLatitude: 30.3,
    pickupLongitude: 31.45,
    destinationLatitude: 30.31,
    destinationLongitude: 31.46,
    freeTextDescription: description,
    quantity: 1,
    ...extra,
  });
  const placeOrder = async (c: Actor, body: Record<string, unknown> = COD) =>
    world.api('post', '/orders', {
      token: c.accessToken,
      body: await withQuoteToken(world, c.accessToken, body),
    });
  const details = async (c: Actor, orderId: string) => expectData<any>(await world.api('get', `/orders/${orderId}`, { token: c.accessToken }));
  const confirm = (itemId: string, amountMinor: unknown, token = pricer.accessToken) =>
    world.api('post', `/admin/orders/items/${itemId}/confirm-price`, {
      token,
      body: { amountMinor },
    });
  const dbOrder = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];

  /** A customer with a placed, UNPRICED Hatly Service order of `itemCount` requests. */
  async function pendingOrder(name: string, itemCount = 1) {
    const c = await s.customer(name);
    expectData(await addItem(c, buyItem('Item 1')), 201);
    for (let i = 2; i <= itemCount; i++) {
      const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expectData(
        await addItem(c, {
          cartVendorGroupId: cart.groups[0].id,
          freeTextDescription: `Item ${i}`,
          quantity: 1,
        }),
        201,
      );
    }
    const res = await placeOrder(c);
    expect(res.status).toBe(201);
    const order = await details(c, res.body.data.id);
    return {
      c,
      order,
      itemIds: order.segments[0].items.map((i: any) => i.id) as string[],
      deliveryFeeMinor: order.deliveryFeeMinor as number,
    };
  }

  describe('checkout is NOT blocked by an unpriced request', () => {
    it('THE CART ITSELF does not block it: the cart view reports readyForCheckout (it used to say false for any Hatly Service request, which disabled "Continue to checkout" in the app) while hasUnpricedItems stays true as information', async () => {
      const c = await s.customer('Cart Ready');
      expectData(await addItem(c, buyItem('Panadol')), 201);
      const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(cart).toMatchObject({
        readyForCheckout: true,
        hasUnpricedItems: true,
        subtotalMinor: 0,
      });
      expect(cart.groups[0]).toMatchObject({
        groupType: 'AD_HOC_SERVICE',
        subtotalMinor: null,
      });
      expect(cart.groups[0].items[0]).toMatchObject({
        unitPriceMinor: null,
        lineTotalMinor: null,
      });
    });

    it('the quote says so explicitly: pending pricing, no total/amount due (null, not 0), COD only, and the order can be placed', async () => {
      const c = await s.customer('Quote Pending');
      expectData(await addItem(c, buyItem('Panadol Extra, two boxes')), 201);
      const quote = await world.api('post', '/checkout/quote', {
        token: c.accessToken,
        body: COD,
      });
      expect(quote.status).toBe(201);
      const q = quote.body.data;
      expect(q).toMatchObject({
        canPlaceOrder: true,
        hasPendingPricing: true,
        blockers: [],
      });
      expect(q.summary.totalMinor).toBeNull();
      expect(q.summary.amountDueMinor).toBeNull();
      expect(q.summary.deliveryFeeMinor).toBe(2250); // the Hatly Service charge IS known: zone fee 15.00 × 1.5
      expect(q.payment.options).toMatchObject({
        cod: true,
        payAtDelivery: false,
        manualTransfer: { available: false },
      });
      expect(q.payment.wallet.available).toBe(false);
      expect(q.quoteToken).toBeTruthy();
    });

    it('creating the order succeeds with an explicit pending state: item PENDING, total/amount due unknown, COD, no payment row, and success is not payment', async () => {
      const { c, order } = await pendingOrder('Create Pending');
      expect(order).toMatchObject({
        // Hatly/Wasally have no vendor: once the payment gate passes (COD) the order is dispatch-ready on its own, price still pending
        status: 'READY_FOR_PICKUP',
        paymentMethod: 'COD',
        hasPendingPricing: true,
        totalMinor: null,
        amountDueMinor: null,
      });
      expect(order.subtotalMinor).toBe(0);
      const item = order.segments[0].items[0];
      expect(item).toMatchObject({
        productId: null,
        priceStatus: 'PENDING',
        actualAmountMinor: null,
        unitPriceMinor: null,
      });
      expect(await world.ds.query('SELECT id FROM payments WHERE order_id = $1', [order.id])).toEqual([]); // nothing was paid or requested
      expect((await dbOrder(order.id)).has_pending_ad_hoc_pricing).toBe(true);
      expect(c.id).toBeDefined();
    });

    it('both service types keep their own route semantics (origin → destination, each frozen in its own slot — PD-012)', async () => {
      const buy = await pendingOrder('Buy Semantics');
      const seg = (await world.ds.query('SELECT * FROM order_vendor_segments WHERE order_id = $1', [buy.order.id]))[0];
      expect(seg).toMatchObject({
        ad_hoc_service_type_snapshot: 'BUY_FROM_PLACE',
        ad_hoc_pickup_latitude_snapshot: 30.3,
        ad_hoc_pickup_longitude_snapshot: 31.45,
      });
      expect(seg).toMatchObject({ ad_hoc_destination_latitude_snapshot: 30.31, ad_hoc_destination_longitude_snapshot: 31.46 });

      const c = await s.customer('Deliver Semantics');
      expectData(
        await addItem(c, {
          adHocPlaceName: 'Friend Home',
          adHocServiceType: 'DELIVER_TO_PLACE',
          pickupLatitude: 30.45,
          pickupLongitude: 31.65,
          destinationLatitude: 30.5,
          destinationLongitude: 31.7,
          freeTextDescription: 'A parcel',
          quantity: 1,
        }),
        201,
      );
      const res = await placeOrder(c);
      expect(res.status).toBe(201);
      const seg2 = (await world.ds.query('SELECT * FROM order_vendor_segments WHERE order_id = $1', [res.body.data.id]))[0];
      expect(seg2).toMatchObject({
        ad_hoc_service_type_snapshot: 'DELIVER_TO_PLACE',
        ad_hoc_destination_latitude_snapshot: 30.5,
        ad_hoc_destination_longitude_snapshot: 31.7,
      });
      expect(seg2).toMatchObject({ ad_hoc_pickup_latitude_snapshot: 30.45, ad_hoc_pickup_longitude_snapshot: 31.65 });
    });

    it('a missing customer address is rejected — never replaced by a Hatly location — and creates no order', async () => {
      const c = await s.customer('No Address');
      expectData(await addItem(c, buyItem('Needs an address')), 201);
      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: { paymentMethod: 'COD' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('DELIVERY_ADDRESS_REQUIRED');
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });
  });

  describe("a saved DEFAULT address (what the app's checkout screen shows preselected)", () => {
    it('the quote preselects it (source DEFAULT, with its id); the order names that id with the quote token and is created; an order that names no address at all is still refused', async () => {
      const c = await s.customer('Default Addr');
      const saved = await s.address(c, { lat: 30.42, lng: 31.56 });
      expectData(await addItem(c, buyItem('Needs the default address')), 201);

      const quote = await world.api('post', '/checkout/quote', {
        token: c.accessToken,
        body: { paymentMethod: 'COD' },
      });
      expect(quote.status).toBe(201);
      expect(quote.body.data.address).toMatchObject({
        addressId: saved.id,
        source: 'DEFAULT',
      });
      expect(quote.body.data).toMatchObject({
        canPlaceOrder: true,
        hasPendingPricing: true,
      });

      const bare = await world.api('post', '/orders', {
        token: c.accessToken,
        body: { paymentMethod: 'COD', quoteToken: quote.body.data.quoteToken },
      });
      expect(bare.status).toBe(400);
      expect(bare.body.error.details.code).toBe('DELIVERY_ADDRESS_REQUIRED');

      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: {
          addressId: saved.id,
          paymentMethod: 'COD',
          quoteToken: quote.body.data.quoteToken,
        },
      });
      expect(res.status).toBe(201);
      expect(await details(c, res.body.data.id)).toMatchObject({
        // Hatly/Wasally have no vendor: once the payment gate passes (COD) the order is dispatch-ready on its own, price still pending
        status: 'READY_FOR_PICKUP',
        hasPendingPricing: true,
        totalMinor: null,
      });
    });
  });

  describe('COD only: an unpriced Hatly Service order can never enter an electronic or wallet flow', () => {
    it.each([
      [
        'PAY_AT_DELIVERY',
        {
          paymentMethod: 'PAY_AT_DELIVERY',
          electronicPaymentMethod: 'INSTAPAY',
        },
        'PAY_AT_DELIVERY_NOT_AVAILABLE', // R20: refused for every new order, before any other payment rule
      ],
      [
        'MANUAL_TRANSFER',
        {
          paymentMethod: 'MANUAL_TRANSFER',
          electronicPaymentMethod: 'INSTAPAY',
        },
        'ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER',
      ],
      ['WALLET as the method', { paymentMethod: 'WALLET' }, 'ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER'],
      ['wallet applied to COD', { paymentMethod: 'COD', useWallet: true }, 'WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER'],
      ['ONLINE', { paymentMethod: 'ONLINE' }, 'ONLINE_PAYMENT_NOT_AVAILABLE'],
    ])('%s is rejected with a specific code and no order is created', async (_label, payment, code) => {
      const c = await s.customer('Cod Only');
      expectData(await addItem(c, buyItem('Unpriced')), 201);
      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: { deliveryAddress: address, ...payment },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe(code);
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
      // the same quote endpoint reports it as a blocker, so the app never offers it
      const quote = await world.api('post', '/checkout/quote', {
        token: c.accessToken,
        body: { deliveryAddress: address, ...payment },
      });
      expect(quote.body.data.canPlaceOrder).toBe(false);
    });

    it('a wallet balance does not change that: a customer WITH wallet money still cannot use it on an unpriced order', async () => {
      const c = await s.customer('Has Wallet');
      await world.ds.query(
        `INSERT INTO wallet_transactions (customer_id, amount_delta_minor, type, reason, idempotency_key) VALUES ($1, 500000, 'ADMIN_CREDIT', 'e2e', $2)`,
        [c.id, `e2e-${c.id}`],
      );
      expectData(await addItem(c, buyItem('Unpriced')), 201);
      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: {
          deliveryAddress: address,
          paymentMethod: 'COD',
          useWallet: true,
        },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER');
    });
  });

  describe('operations confirm the price (authoritative recompute)', () => {
    it('confirming replaces PENDING with the amount; subtotal, total and amount due are recomputed server-side and the customer sees them on reopen', async () => {
      const { c, order, itemIds, deliveryFeeMinor } = await pendingOrder('Confirm Flow');
      const res = await confirm(itemIds[0], 25000);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        orderItemId: itemIds[0],
        amountMinor: 25000,
        recordedByRole: 'ADMIN',
        alreadyApplied: false,
      });

      const after = await details(c, order.id);
      expect(after).toMatchObject({
        hasPendingPricing: false,
        subtotalMinor: 25000,
        totalMinor: 25000 + deliveryFeeMinor,
        amountDueMinor: 25000 + deliveryFeeMinor,
        paymentMethod: 'COD',
      });
      expect(after.segments[0].items[0]).toMatchObject({
        priceStatus: 'CONFIRMED',
        actualAmountMinor: 25000,
        unitPriceMinor: null,
      }); // the checkout snapshot is untouched
      expect(after.checkoutQuoteSnapshot ?? null).toBeNull(); // not exposed to the customer; the stored snapshot below must be historical
      const stored = await dbOrder(order.id);
      expect(stored.checkout_quote_snapshot.amounts.totalMinor).toBeNull(); // history preserved: what the customer saw at checkout
      expect(Number(stored.total_minor)).toBe(25000 + deliveryFeeMinor);
      // the audit trail: who confirmed, when, how much
      const [record] = await world.ds.query('SELECT * FROM ad_hoc_purchase_records WHERE order_item_id = $1', [itemIds[0]]);
      expect(record).toMatchObject({
        recorded_by_role: 'ADMIN',
        recorded_by_user_id: pricer.id,
        recorded_by_driver_id: null,
      });
      expect(Number(record.amount_minor)).toBe(25000);
      expect(await world.ds.query(`SELECT id FROM financial_events WHERE order_id = $1 AND type = 'DRIVER_REIMBURSEMENT_OWED'`, [order.id])).toEqual([]);
    });

    it('with several requests the total stays unknown until the LAST one is priced, then equals the exact sum', async () => {
      const { c, order, itemIds, deliveryFeeMinor } = await pendingOrder('Two Items', 2);
      expect(itemIds).toHaveLength(2);
      expect((await confirm(itemIds[0], 12000)).status).toBe(201);
      const mid = await details(c, order.id);
      expect(mid).toMatchObject({
        hasPendingPricing: true,
        totalMinor: null,
        amountDueMinor: null,
        subtotalMinor: 12000,
      });
      expect(mid.segments[0].items.map((i: any) => i.priceStatus).sort()).toEqual(['CONFIRMED', 'PENDING']);
      expect((await confirm(itemIds[1], 8000)).status).toBe(201);
      expect(await details(c, order.id)).toMatchObject({
        hasPendingPricing: false,
        subtotalMinor: 20000,
        totalMinor: 20000 + deliveryFeeMinor,
        amountDueMinor: 20000 + deliveryFeeMinor,
      });
    });

    it('is idempotent: repeating the same confirmation is a 200 no-op; a different amount is a 409 and the recorded price stands', async () => {
      const { c, order, itemIds, deliveryFeeMinor } = await pendingOrder('Idempotent');
      expect((await confirm(itemIds[0], 9900)).status).toBe(201);
      const again = await confirm(itemIds[0], 9900);
      expect(again.status).toBe(200);
      expect(again.body.data.alreadyApplied).toBe(true);
      const conflict = await confirm(itemIds[0], 10000);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.details.code).toBe('PURCHASE_ALREADY_RECORDED');
      expect(await details(c, order.id)).toMatchObject({
        subtotalMinor: 9900,
        totalMinor: 9900 + deliveryFeeMinor,
      });
      expect(await world.ds.query('SELECT id FROM ad_hoc_purchase_records WHERE order_item_id = $1', [itemIds[0]])).toHaveLength(1);
    });

    it.each([0, -1, 1.5, '100', null])('a non-positive-integer amount (%j) is a 400 and changes nothing', async (amount) => {
      const { c, order, itemIds } = await pendingOrder('Bad Amount');
      expect((await confirm(itemIds[0], amount)).status).toBe(400);
      expect(await details(c, order.id)).toMatchObject({
        hasPendingPricing: true,
        totalMinor: null,
      });
    });

    it('is refused for an order that was cancelled, and for an item that is not a Hatly Service request', async () => {
      const { c, order, itemIds } = await pendingOrder('Cancelled');
      // (the customer's own cancel window closes at READY_FOR_PICKUP; an admin cancels)
      const superAdmin = await s.superAdmin();
      const cancelled = await world.api('patch', `/orders/${order.id}/status`, {
        token: superAdmin.accessToken,
        body: { status: 'CANCELLED', cancellationReason: 'changed my mind' },
      });
      expect(cancelled.status).toBe(200);
      const res = await confirm(itemIds[0], 5000);
      expect(res.status).toBe(409);
      expect(res.body.error.details.code).toBe('ORDER_NOT_PRICEABLE');
      expect((await confirm('00000000-0000-4000-8000-000000000000', 5000)).status).toBe(404);
      expect((await confirm('not-a-uuid', 5000)).status).toBe(400);
    });

    it('is authorization-protected: anonymous 401; customer, driver, vendor and an admin WITHOUT the permission are 403 — and none of them changed anything', async () => {
      const { c, order, itemIds } = await pendingOrder('Authz');
      const area = await s.serviceArea({ radiusMeters: 50000 });
      const vendor = await s.vendor({
        name: 'Authz Vendor',
        serviceAreaId: area.id,
        lat: 30.421,
        lng: 31.561,
      });
      const driver = await s.driver({ lat: 30.4212, lng: 31.5612 });
      const unpermitted = await s.admin([Permission.VIEW_ORDERS]);
      expect((await world.api('post', `/admin/orders/items/${itemIds[0]}/confirm-price`, { body: { amountMinor: 100 } })).status).toBe(401);
      for (const token of [c.accessToken, driver.accessToken, vendor.manager.accessToken, unpermitted.accessToken]) {
        expect((await confirm(itemIds[0], 100, token)).status).toBe(403);
      }
      expect(await details(c, order.id)).toMatchObject({
        hasPendingPricing: true,
        totalMinor: null,
      });
      expect(DEFAULT_PASSWORD).toBeTruthy();
    });
  });

  describe('concurrency', () => {
    it('10 simultaneous IDENTICAL confirmations: one is recorded, the rest are idempotent replays — the total is applied exactly once', async () => {
      const { c, order, itemIds, deliveryFeeMinor } = await pendingOrder('Race Same');
      const results = await Promise.all(Array.from({ length: 10 }, () => confirm(itemIds[0], 7777)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 200)).toHaveLength(9);
      expect(await world.ds.query('SELECT id FROM ad_hoc_purchase_records WHERE order_item_id = $1', [itemIds[0]])).toHaveLength(1);
      expect(await details(c, order.id)).toMatchObject({
        subtotalMinor: 7777,
        totalMinor: 7777 + deliveryFeeMinor,
      });
    });

    it("simultaneous CONFLICTING amounts: exactly one wins, every other attempt is a 409, and the order holds the winner's amount only", async () => {
      const { c, order, itemIds, deliveryFeeMinor } = await pendingOrder('Race Different');
      const amounts = [1000, 2000, 3000, 4000, 5000, 6000];
      const results = await Promise.all(amounts.map((a) => confirm(itemIds[0], a)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      const winner = amounts[results.findIndex((r) => r.status === 201)];
      expect(await details(c, order.id)).toMatchObject({
        subtotalMinor: winner,
        totalMinor: winner + deliveryFeeMinor,
      });
    });

    it('pricing the requests of ONE order concurrently loses no update: the total is the exact sum', async () => {
      const { c, order, itemIds, deliveryFeeMinor } = await pendingOrder('Race Siblings', 3);
      const amounts = [1100, 2200, 3300];
      const results = await Promise.all(itemIds.map((id, i) => confirm(id, amounts[i])));
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await details(c, order.id)).toMatchObject({
        hasPendingPricing: false,
        subtotalMinor: 6600,
        totalMinor: 6600 + deliveryFeeMinor,
        amountDueMinor: 6600 + deliveryFeeMinor,
      });
    });
  });

  describe('Admin UI contract: list filter, list flag, detail fields, own permissions', () => {
    it('GET /admin/orders?hasPendingPricing=true returns only orders with a PENDING Hatly Service request, flags them, and drops an order once every request is priced; an order without a pending request is never flagged', async () => {
      const viewer = await s.admin([Permission.VIEW_ORDERS], 'Pricing Viewer');
      const { c, order, itemIds } = await pendingOrder('Admin List Pending', 2);

      const listPending = async () => world.api('get', `/admin/orders?hasPendingPricing=true&search=${order.orderNumber}`, { token: viewer.accessToken });
      let res = await listPending();
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        id: order.id,
        hasPendingHatlyServicePricing: true,
      });

      expect((await confirm(itemIds[0], 1500)).status).toBe(201);
      res = await listPending();
      expect(res.body.data[0]).toMatchObject({
        id: order.id,
        hasPendingHatlyServicePricing: true,
      }); // one request still pending

      expect((await confirm(itemIds[1], 2500)).status).toBe(201);
      res = await listPending();
      expect(res.body.data).toEqual([]); // fully priced: no longer pending
      const all = await world.api('get', `/admin/orders?search=${order.orderNumber}`, { token: viewer.accessToken });
      expect(all.body.data[0]).toMatchObject({
        id: order.id,
        hasPendingHatlyServicePricing: false,
        totalMinor: expect.any(Number),
      });
      expect(c.id).toBeDefined();
    });

    it('rejects a malformed hasPendingPricing value and treats false as no filter', async () => {
      const viewer = await s.admin([Permission.VIEW_ORDERS], 'Pricing Viewer 2');
      expect(
        (
          await world.api('get', '/admin/orders?hasPendingPricing=maybe', {
            token: viewer.accessToken,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await world.api('get', '/admin/orders?hasPendingPricing=false', {
            token: viewer.accessToken,
          })
        ).status,
      ).toBe(200);
    });

    it('the detail carries what the screen needs: per-segment Hatly Service request details, the delivery address, wallet/amount due and the pending flag — and totals only once every request is priced', async () => {
      const viewer = await s.admin([Permission.VIEW_ORDERS], 'Pricing Viewer 3');
      const { order, itemIds, deliveryFeeMinor } = await pendingOrder('Admin Detail Fields');
      const detail = async () =>
        expectData<any>(
          await world.api('get', `/admin/orders/${order.id}`, {
            token: viewer.accessToken,
          }),
        );

      const pending = await detail();
      expect(pending).toMatchObject({
        hasPendingAdHocPricing: true,
        hasPendingHatlyServicePricing: true,
        totalMinor: null,
        amountDueMinor: null,
        walletAmountMinor: 0,
        deliveryAddress: {
          line1: 'Customer Home',
          latitude: 30.42,
          longitude: 31.56,
        },
      });
      expect(pending.segments[0].hatlyService).toEqual({
        serviceType: 'BUY_FROM_PLACE',
        placeName: 'Corner Pharmacy',
        pickupLatitude: 30.3,
        pickupLongitude: 31.45,
        destinationLatitude: 30.31,
        destinationLongitude: 31.46,
        // PD-012: the route as it was frozen at checkout (both ends were chosen by the customer here).
        route: {
          service: 'HATLY',
          origin: { latitude: 30.3, longitude: 31.45, label: null, source: 'CUSTOMER' },
          destination: { latitude: 30.31, longitude: 31.46, label: null, source: 'CUSTOMER' },
        },
      });
      expect(pending.segments[0].items[0]).toMatchObject({
        priceStatus: 'PENDING',
        freeTextDescription: 'Item 1',
        actualAmountMinor: null,
      });

      expect((await confirm(itemIds[0], 4200)).status).toBe(201);
      expect(await detail()).toMatchObject({
        hasPendingHatlyServicePricing: false,
        subtotalMinor: 4200,
        totalMinor: 4200 + deliveryFeeMinor,
        amountDueMinor: 4200 + deliveryFeeMinor,
      });
    });

    it('GET /admin/me/permissions: an ADMIN gets exactly its grants, a SUPER_ADMIN the whole catalog, everyone else 403/401', async () => {
      const without = await s.admin([Permission.VIEW_ORDERS], 'No Pricing');
      const withPricing = await s.admin([Permission.VIEW_ORDERS, Permission.MANAGE_HATLY_SERVICE_PRICING], 'With Pricing');
      const superAdmin = await s.superAdmin();
      const customer = await s.customer('Not Admin');

      expect(
        expectData<any>(
          await world.api('get', '/admin/me/permissions', {
            token: without.accessToken,
          }),
        ),
      ).toEqual({ role: 'ADMIN', permissions: [Permission.VIEW_ORDERS] });
      expect(
        expectData<any>(
          await world.api('get', '/admin/me/permissions', {
            token: withPricing.accessToken,
          }),
        ).permissions.sort(),
      ).toEqual([Permission.MANAGE_HATLY_SERVICE_PRICING, Permission.VIEW_ORDERS].sort());
      const superRes = expectData<any>(
        await world.api('get', '/admin/me/permissions', {
          token: superAdmin.accessToken,
        }),
      );
      expect(superRes.role).toBe('SUPER_ADMIN');
      expect(superRes.permissions).toContain(Permission.MANAGE_HATLY_SERVICE_PRICING);
      expect(
        (
          await world.api('get', '/admin/me/permissions', {
            token: customer.accessToken,
          })
        ).status,
      ).toBe(403);
      expect((await world.api('get', '/admin/me/permissions')).status).toBe(401);
    });
  });
});
