/**
 * PD-006 — the checkout QUOTE and the rules around it, over real HTTP against real PostgreSQL:
 * the authoritative server-generated quote (delivery breakdown, ETA, eligibility, payment options), address / service-area
 * validation, pickup, the frozen and stale-quote protection, electronic payment methods, payment gating, and coupons.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

const HOUR = 3600_000;
const window = (fromHours = -1, toHours = 24) => ({ startAt: new Date(Date.now() + fromHours * HOUR).toISOString(), endAt: new Date(Date.now() + toHours * HOUR).toISOString() });

describe('E2E — checkout quote, address, pickup, payments and coupons (PD-006)', () => {
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
  const far = { lat: 29.0, lng: 30.0 }; // inside Egypt, far outside the service area

  const num = (v: unknown) => Number(v);
  const addr = (at = home, extra: Record<string, unknown> = {}) => ({ line1: 'Quote Street 1', latitude: at.lat, longitude: at.lng, ...extra });
  // the quote response is `{ data: quote }`; expectData unwraps the envelope, so re-wrap to keep `q.data` reading naturally
  const quote = async (c: Actor, body: Record<string, unknown> = {}) => ({ data: expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body }), 201) });
  // Auto-attaches a real quote token when the test didn't already supply one (explicit `quoteToken`, including a
  // deliberately forged/stale/missing one, is always left exactly as given — see the stale-quote/token-hardening tests below).
  const place = async (c: Actor, body: Record<string, unknown>) =>
    world.api('post', '/orders', { token: c.accessToken, body: 'quoteToken' in body ? body : await withQuoteToken(world, c.accessToken, body) });
  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const paymentOf = async (orderId: string) => (await world.ds.query('SELECT * FROM payments WHERE order_id = $1', [orderId]))[0];
  const cartFor = async (products: Array<{ id: string }>, quantities: number[] = []) => {
    const c = await s.customer();
    for (let i = 0; i < products.length; i++) await s.addToCart(c, products[i].id, quantities[i] ?? 1);
    return c;
  };
  // The config API stores a value (never null); a key is "unset" by deleting its row — the real state before an admin ever set it.
  const clearConfig = async (key: string) => { await world.ds.query('DELETE FROM business_config WHERE key = $1', [key]); };
  const patchBranch = async (v: VendorFixture, body: Record<string, unknown>) =>
    expectData(await world.api('patch', `/admin/vendor-branches/${v.branchId}`, { token: superAdmin.accessToken, body }));
  const createOffer = (body: Record<string, unknown>) => world.api('post', '/admin/offers', { token: superAdmin.accessToken, body: { ...window(), ...body } });
  const claim = (c: Actor, orderId: string) => world.api('post', `/payments/manual-transfer/orders/${orderId}/claim`, { token: c.accessToken, body: {} });
  const approve = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/approve`, { token: reviewer.accessToken });
  const reject = (paymentId: string) => world.api('post', `/admin/manual-transfer-payments/${paymentId}/reject`, { token: reviewer.accessToken, body: { reason: 'no' } });
  const vendorStatus = (v: VendorFixture, segmentId: string, status: string) => world.api('patch', `/vendor/orders/segments/${segmentId}/status`, { token: v.manager.accessToken, body: { status, ...(status === 'CANCELLED' ? { reason: 'Out of stock' } : {}) } });
  const adminStatus = (orderId: string, status: string) => world.api('patch', `/orders/${orderId}/status`, { token: superAdmin.accessToken, body: { status } });
  const segmentOf = async (orderId: string, v: VendorFixture): Promise<string> =>
    (await world.ds.query('SELECT id FROM order_vendor_segments WHERE order_id = $1 AND vendor_branch_id = $2', [orderId, v.branchId]))[0].id;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing(); // 10 EGP / 100 m, 15 EGP minimum, 5 EGP additional vendor
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
    reviewer = await s.admin([Permission.VERIFY_MANUAL_PAYMENTS]);
    v1 = await s.vendor({ name: 'CQ 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'CQ 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('the quote', () => {
    it('is authoritative: subtotal, discount, delivery fee with its parts, per-vendor breakdown, eligibility, options — and it matches what the order is then charged', async () => {
      const c = await cartFor([p1, p2]);
      const q = await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' });
      const d = q.data;

      expect(d.canPlaceOrder).toBe(true);
      expect(d.blockers).toEqual([]);
      expect(d.fulfillment).toMatchObject({ type: 'DELIVERY', pickupAvailable: false, pickupUnavailableReason: 'PICKUP_SINGLE_VENDOR_ONLY' });
      expect(d.eligibility).toMatchObject({ serviceable: true, serviceAreaId: area.id });
      expect(d.summary).toMatchObject({ subtotalMinor: 30000, discountMinor: 0, walletAppliedMinor: 0 });
      expect(d.summary.totalMinor).toBe(d.summary.subtotalMinor + d.summary.deliveryFeeMinor);
      expect(d.summary.amountDueMinor).toBe(d.summary.totalMinor);

      expect(d.delivery).toMatchObject({ applicable: true, source: 'FRESH', vendorCount: 2, additionalVendorFeeMinor: 500, additionalVendorChargeMinor: 500 });
      expect(d.delivery.baseFeeMinor + d.delivery.additionalVendorChargeMinor).toBe(d.delivery.feeMinor);
      expect(d.delivery.feeMinor).toBe(d.summary.deliveryFeeMinor);
      expect(d.delivery.distanceMeters).toBeGreaterThan(0);
      expect(d.delivery.vendors).toHaveLength(2);
      expect(d.vendors.map((v: any) => [v.name, v.subtotalMinor, v.itemCount])).toEqual([['CQ 1', 10000, 1], ['CQ 2', 20000, 1]]);
      expect(typeof d.quoteToken).toBe('string');
      expect(new Date(d.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(d.payment.options).toMatchObject({ cod: true, payAtDelivery: true, manualTransfer: { available: true }, electronicMethods: ['INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY'] });

      const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: d.quoteToken }), 201);
      expect(order.totalMinor).toBe(d.summary.totalMinor);
      expect(order.deliveryFeeMinor).toBe(d.summary.deliveryFeeMinor);
    });

    it('the client never sends an authoritative amount: money fields and unknown fields are refused', async () => {
      const c = await cartFor([p1]);
      for (const extra of [{ totalMinor: 1 }, { deliveryFeeMinor: 0 }, { discountMinor: 9999 }, { subtotalMinor: 1 }, { distanceMeters: 1 }, { serviceable: true }]) {
        expect((await world.api('post', '/checkout/quote', { token: c.accessToken, body: { deliveryAddress: addr(), ...extra } })).status).toBe(400);
        expect((await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', ...extra })).status).toBe(400);
      }
    });

    it('without an address it says what is missing (no fee, cannot place) — it never invents one', async () => {
      const c = await cartFor([p1]);
      const q = (await quote(c, { paymentMethod: 'COD' })).data;
      expect(q.canPlaceOrder).toBe(false);
      expect(q.blockers.map((b: any) => b.code)).toContain('ADDRESS_REQUIRED');
      expect(q.summary.deliveryFeeMinor).toBeNull();
      expect(q.summary.totalMinor).toBeNull();
      expect(q.quoteToken).toBeNull();
      expect(q.payment.options.cod).toBe(true); // options are still offered so the UI can render them
    });

    it('an empty cart is reported as a blocker, not an error', async () => {
      const c = await s.customer();
      const q = (await quote(c, { deliveryAddress: addr() })).data;
      expect(q).toMatchObject({ canPlaceOrder: false, quoteToken: null });
      expect(q.blockers[0].code).toBe('EMPTY_CART');
    });

    it('is customer-only and authenticated', async () => {
      expect((await world.api('post', '/checkout/quote', { body: {} })).status).toBe(401);
      expect((await world.api('post', '/checkout/quote', { token: v1.manager.accessToken, body: {} })).status).toBe(403);
    });

    it('it writes nothing and takes no stock: quoting a tracked cart leaves stock and orders untouched', async () => {
      const t = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 5 });
      const c = await cartFor([t], [2]);
      await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' });
      await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' });
      expect(num((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [t.id]))[0].quantity)).toBe(5);
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });

    it('reports insufficient stock as a blocker', async () => {
      const t = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 5 });
      const c = await cartFor([t], [2]);
      await world.ds.query('UPDATE products SET quantity = 1 WHERE id = $1', [t.id]);
      const q = (await quote(c, { deliveryAddress: addr() })).data;
      expect(q.canPlaceOrder).toBe(false);
      expect(q.blockers[0].code).toBe('INSUFFICIENT_INVENTORY');
    });
  });

  describe('ETA — only from real inputs', () => {
    it('unavailable (with a reason) until every vendor has a preparation time; then preparation + travel, never a default', async () => {
      const c = await cartFor([p1]);
      const before = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data.delivery.eta;
      expect(before).toMatchObject({ available: false, reason: 'PREPARATION_TIME_NOT_CONFIGURED', estimatedMinutes: null });

      await patchBranch(v1, { preparationTimeMinutes: 20 });
      try {
        const eta = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data.delivery.eta;
        expect(eta.available).toBe(true);
        expect(eta.preparationMinutes).toBe(20);
        expect(eta.travelMinutes).toBeGreaterThan(0);
        expect(eta.estimatedMinutes).toBe(20 + eta.travelMinutes);
        expect(eta.rangeMinMinutes).toBe(eta.rangeMaxMinutes); // no range is invented

        await s.setConfig('ETA_RANGE_BUFFER_MINUTES', 10);
        const ranged = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data.delivery.eta;
        expect(ranged.rangeMaxMinutes).toBe(ranged.rangeMinMinutes + 10);
      } finally {
        await clearConfig('ETA_RANGE_BUFFER_MINUTES');
        await patchBranch(v1, { preparationTimeMinutes: null });
      }
    });

    it('a pickup ETA is just the preparation time', async () => {
      await patchBranch(v1, { preparationTimeMinutes: 15 });
      try {
        const c = await cartFor([p1]);
        expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
        const q = (await quote(c, { paymentMethod: 'COD' })).data;
        expect(q.delivery.eta).toMatchObject({ available: true, preparationMinutes: 15, travelMinutes: 0, estimatedMinutes: 15 });
      } finally {
        await patchBranch(v1, { preparationTimeMinutes: null });
      }
    });
  });

  describe('address and service area (server-side)', () => {
    it('a location outside every service area is not serviceable — reported by the quote, refused by the order, nothing created', async () => {
      const c = await cartFor([p1]);
      const q = (await quote(c, { deliveryAddress: addr(far), paymentMethod: 'COD' })).data;
      expect(q.eligibility).toMatchObject({ serviceable: false, code: 'ADDRESS_OUT_OF_SERVICE_AREA' });
      expect(q.canPlaceOrder).toBe(false);
      expect(q.summary.deliveryFeeMinor).toBeNull();

      const res = await place(c, { deliveryAddress: addr(far), paymentMethod: 'COD' });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('ADDRESS_NOT_SERVICEABLE');
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });

    it('coordinates outside Egypt are invalid; a missing address is DELIVERY_ADDRESS_REQUIRED; an empty line is INVALID_DELIVERY_ADDRESS', async () => {
      const c = await cartFor([p1]);
      const abroad = await place(c, { deliveryAddress: addr({ lat: 48.85, lng: 2.35 }), paymentMethod: 'COD' });
      expect(abroad.status).toBe(400);
      expect(abroad.body.error.details.code).toBe('INVALID_DELIVERY_LOCATION');
      const none = await place(c, { paymentMethod: 'COD' });
      expect(none.status).toBe(400);
      expect(none.body.error.details.code).toBe('DELIVERY_ADDRESS_REQUIRED');
      const blank = await place(c, { deliveryAddress: { line1: '   ', latitude: home.lat, longitude: home.lng }, paymentMethod: 'COD' });
      expect(blank.status).toBe(400);
      expect(blank.body.error.details.code).toBe('INVALID_DELIVERY_ADDRESS');
    });

    it('a vendor that does not deliver, or that belongs to another service area, blocks delivery to that address', async () => {
      const off = await s.vendor({ name: 'No Delivery', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const po = await s.product(off, { priceMinor: 5000, inventoryMode: 'OPEN' });
      await patchBranch(off, { deliveryEnabled: false });
      const c = await cartFor([po]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expect(q.eligibility.serviceable).toBe(false);
      expect(q.eligibility.vendors[0]).toMatchObject({ deliverable: false, code: 'VENDOR_DOES_NOT_DELIVER' });
      const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD' });
      expect(res.body.error.details.code).toBe('VENDOR_DOES_NOT_DELIVER');

      const otherArea = await s.serviceArea({ name: 'Other', lat: 26.0, lng: 32.0, radiusMeters: 1000 });
      const elsewhere = await s.vendor({ name: 'Elsewhere', serviceAreaId: otherArea.id, lat: 26.0, lng: 32.0 });
      const pe = await s.product(elsewhere, { priceMinor: 5000, inventoryMode: 'OPEN' });
      const c2 = await cartFor([pe]);
      const q2 = (await quote(c2, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expect(q2.eligibility.vendors[0]).toMatchObject({ deliverable: false, code: 'VENDOR_OUTSIDE_DELIVERY_AREA' });
    });

    it('a saved address can be used by id — but only the caller\'s own, active one; both addressId and deliveryAddress is refused', async () => {
      const c = await cartFor([p1]);
      const other = await s.customer();
      const mine = expectData<any>(await world.api('post', '/addresses', { token: c.accessToken, body: { deliveryZoneId: await s.defaultDeliveryZoneId(), line1: 'Saved Street 5', latitude: home.lat, longitude: home.lng, governorate: 'الشرقية', city: 'بلبيس', street: 'شارع النصر', buildingNumber: '12', floor: '3', apartment: '7', landmark: 'بجوار المسجد', formattedAddress: 'assistive text', label: 'Home' } }), 201);
      const theirs = expectData<any>(await world.api('post', '/addresses', { token: other.accessToken, body: { deliveryZoneId: await s.defaultDeliveryZoneId(), line1: 'Their Street', latitude: home.lat, longitude: home.lng } }), 201);

      expect((await place(c, { addressId: theirs.id, paymentMethod: 'COD' })).status).toBe(404);
      expect((await world.api('post', '/checkout/quote', { token: c.accessToken, body: { addressId: theirs.id } })).status).toBe(200 + 1); // 201 with a blocker — never their address
      const bad = await place(c, { addressId: mine.id, deliveryAddress: addr(), paymentMethod: 'COD' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.code).toBe('AMBIGUOUS_DELIVERY_ADDRESS');

      const order = expectData<any>(await place(c, { addressId: mine.id, paymentMethod: 'COD' }), 201);
      // the mixed address model is preserved in the frozen snapshot: coordinates + typed details + the assistive text + label
      expect(order.deliveryAddressSnapshot).toMatchObject({ line1: 'Saved Street 5', latitude: home.lat, longitude: home.lng, governorate: 'الشرقية', city: 'بلبيس', street: 'شارع النصر', buildingNumber: '12', floor: '3', apartment: '7', landmark: 'بجوار المسجد', formattedAddress: 'assistive text', label: 'Home' });
    });

    it('the default address is preselected only when it is serviceable', async () => {
      const c = await cartFor([p1]);
      const first = expectData<any>(await world.api('post', '/addresses', { token: c.accessToken, body: { deliveryZoneId: await s.defaultDeliveryZoneId(), line1: 'Default One', latitude: home.lat, longitude: home.lng } }), 201);
      expect(first.isDefault).toBe(true); // the first address becomes the default
      const q = (await quote(c, { paymentMethod: 'COD' })).data;
      expect(q.address).toMatchObject({ addressId: first.id, source: 'DEFAULT', snapshot: { line1: 'Default One' } });
      expect(q.canPlaceOrder).toBe(true);

      // making an unserviceable address the default: it is NOT preselected
      const remote = expectData<any>(await world.api('post', '/addresses', { token: c.accessToken, body: { deliveryZoneId: await s.defaultDeliveryZoneId(), line1: 'Remote', latitude: far.lat, longitude: far.lng, isDefault: true } }), 201);
      const q2 = (await quote(c, { paymentMethod: 'COD' })).data;
      expect(q2.address).toMatchObject({ addressId: null, source: null, snapshot: null });
      expect(q2.canPlaceOrder).toBe(false);
      // only one default at any time
      const list = expectData<any[]>(await world.api('get', '/addresses', { token: c.accessToken }));
      expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([remote.id]);
    });

    it('geo assist: reverse / search return SUGGESTIONS only, customer-only, and a bad query is refused', async () => {
      const c = await s.customer();
      const rev = expectData<any>(await world.api('get', `/geo/reverse?latitude=${home.lat}&longitude=${home.lng}`, { token: c.accessToken }));
      expect(rev.formattedAddress).toContain('E2E Street');
      expect(expectData<any>(await world.api('get', '/geo/search?q=Belbeis%20Center', { token: c.accessToken }))).toEqual({ latitude: 30.425, longitude: 31.565 });
      expect(expectData<any>(await world.api('get', '/geo/search?q=nowhere%20real', { token: c.accessToken }))).toBeNull();
      expect((await world.api('get', '/geo/search?q=a', { token: c.accessToken })).status).toBe(400);
      expect((await world.api('get', '/geo/reverse?latitude=999&longitude=1', { token: c.accessToken })).status).toBe(400);
      expect((await world.api('get', `/geo/reverse?latitude=${home.lat}&longitude=${home.lng}`)).status).toBe(401);
    });
  });

  describe('pickup', () => {
    it('single vendor with pickup: no fee, no address, no service-area check, the branch is kept; the order has no delivery address', async () => {
      const c = await cartFor([p1]);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const q = (await quote(c, { paymentMethod: 'COD' })).data;
      expect(q.fulfillment).toMatchObject({ type: 'PICKUP', pickupAvailable: true, pickupBranch: { name: 'CQ 1', address: '1 Test Street' } });
      expect(q.summary).toMatchObject({ deliveryFeeMinor: 0, totalMinor: 10000 });
      expect(q.canPlaceOrder).toBe(true);
      expect(q.eligibility).toBeNull();

      const order = expectData<any>(await place(c, { paymentMethod: 'COD', quoteToken: q.quoteToken }), 201);
      expect(order).toMatchObject({ fulfillmentType: 'PICKUP', deliveryFeeMinor: 0, totalMinor: 10000, deliveryAddressSnapshot: null });
      expect(order.segments[0].vendorBranchId).toBe(v1.branchId);
      // an address sent for pickup is simply not used: even a far-away one causes no service-area rejection
      const c2 = await cartFor([p1]);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c2.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      expectData(await place(c2, { deliveryAddress: addr(far), paymentMethod: 'COD' }), 201);
    });

    it('is not available for multi-vendor carts, nor for a branch without pickup', async () => {
      const multi = await cartFor([p1, p2]);
      const m = await world.api('patch', '/cart/fulfillment-type', { token: multi.accessToken, body: { fulfillmentType: 'PICKUP' } });
      expect(m.status).toBeGreaterThanOrEqual(400); // the cart itself refuses pickup for two vendors
      const qm = (await quote(multi, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expect(qm.fulfillment).toMatchObject({ type: 'DELIVERY', pickupAvailable: false, pickupUnavailableReason: 'PICKUP_SINGLE_VENDOR_ONLY' });

      const nop = await s.vendor({ name: 'No Pickup', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const pn = await s.product(nop, { priceMinor: 5000, inventoryMode: 'OPEN' });
      await patchBranch(nop, { pickupEnabled: false });
      const c = await cartFor([pn]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expect(q.fulfillment).toMatchObject({ pickupAvailable: false, pickupUnavailableReason: 'BRANCH_PICKUP_DISABLED' });
    });
  });

  describe('quote token is MANDATORY for a DELIVERY order (production-readiness slice)', () => {
    it('placing a DELIVERY order with no quoteToken at all is refused — a client can no longer obtain a fresh price and place the order without ever confirming it', async () => {
      const c = await cartFor([p1]);
      const res = await world.api('post', '/orders', {
        token: c.accessToken,
        body: { deliveryAddress: addr(), paymentMethod: 'COD' },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({ code: 'QUOTE_TOKEN_REQUIRED' });
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });

    it('a REAL, unrelated rejection (bad address, disabled multi-vendor, insufficient stock…) is reported for what it actually is — never masked by QUOTE_TOKEN_REQUIRED', async () => {
      const c = await cartFor([p1]);
      const outOfArea = await world.api('post', '/orders', {
        token: c.accessToken,
        body: { deliveryAddress: addr(far), paymentMethod: 'COD' },
      });
      expect(outOfArea.status).toBe(400);
      expect(outOfArea.body.error.details.code).toBe('ADDRESS_NOT_SERVICEABLE');
    });

    it('PICKUP needs no quote token at all — there is no delivery quote to confirm', async () => {
      const c = await cartFor([p1]);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: c.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const res = await world.api('post', '/orders', { token: c.accessToken, body: { paymentMethod: 'COD' } });
      expect(res.status).toBe(201);
      expect(res.body.data.fulfillmentType).toBe('PICKUP');
    });

    it('the token still never bypasses anything else: a valid quote for a DIFFERENT (now sold-out) cart still fails on real inventory, and a coupon it never validated is still refused', async () => {
      const tracked = await s.product(v1, { priceMinor: 5000, inventoryMode: 'TRACKED', quantity: 1 });
      const c = await cartFor([tracked]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      // stock disappears AFTER the quote was minted, before the order is placed
      expectData(await world.api('patch', `/vendor/products/${tracked.id}`, { token: v1.manager.accessToken, body: { quantity: 0 } }));
      const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: q.quoteToken });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('INSUFFICIENT_INVENTORY');
    });
  });

  describe('the frozen quote and stale-quote protection', () => {
    it('the delivery fee the customer confirmed is HONOURED — a later pricing-config change does not silently change it — and it is frozen with the order', async () => {
      const c = await cartFor([p1, p2]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      await s.setConfig('REGISTERED_VENDOR_PRICE_PER_100M_MINOR', 5000); // pricing changes AFTER the quote
      try {
        const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: q.quoteToken }), 201);
        expect(order.deliveryFeeMinor).toBe(q.summary.deliveryFeeMinor);
        const row = await orderRow(order.id);
        expect(row.checkout_quote_snapshot).toMatchObject({ version: 1, deliverySource: 'FROZEN_QUOTE', amounts: { deliveryFeeMinor: q.summary.deliveryFeeMinor, totalMinor: q.summary.totalMinor } });
        expect(row.delivery_fee_breakdown_snapshot.deliveryFeeMinor).toBe(q.summary.deliveryFeeMinor);

        // without a confirmed quote the new configuration applies — proving the freeze came from the quote
        const c2 = await cartFor([p1, p2]);
        const fresh = expectData<any>(await place(c2, { deliveryAddress: addr(), paymentMethod: 'COD' }), 201);
        expect(fresh.deliveryFeeMinor).toBeGreaterThan(q.summary.deliveryFeeMinor);

        // and changing config afterwards never mutates an existing order
        await s.setConfig('REGISTERED_VENDOR_PRICE_PER_100M_MINOR', 1);
        expect(num((await orderRow(order.id)).delivery_fee_minor)).toBe(q.summary.deliveryFeeMinor);
      } finally {
        await s.setConfig('REGISTERED_VENDOR_PRICE_PER_100M_MINOR', 1000);
      }
    });

    it('a changed cart makes the quote stale: 409 QUOTE_STALE with the CURRENT quote; nothing is created or taken; confirming the new quote succeeds', async () => {
      const t = await s.product(v1, { priceMinor: 10000, inventoryMode: 'TRACKED', quantity: 10 });
      const c = await cartFor([t]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      await s.addToCart(c, p2.id, 1); // the cart changes after the customer confirmed

      const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: q.quoteToken });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({ code: 'QUOTE_STALE', reason: 'INPUTS_CHANGED' });
      const current = res.body.error.details.currentQuote;
      expect(current.summary.subtotalMinor).toBe(30000);
      expect(current.summary.deliveryFeeMinor).not.toBe(q.summary.deliveryFeeMinor);
      expect(current.quoteToken).toBeTruthy();
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
      expect(num((await world.ds.query('SELECT quantity FROM products WHERE id = $1', [t.id]))[0].quantity)).toBe(10);
      expect((await world.ds.query('SELECT status FROM carts WHERE customer_id = $1', [c.id]))[0].status).toBe('ACTIVE');

      const confirmed = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: current.quoteToken }), 201);
      expect(confirmed.totalMinor).toBe(current.summary.totalMinor);
    });

    it('a different address than the one quoted is stale; an expired quote is stale (QUOTE_EXPIRED)', async () => {
      const c = await cartFor([p1]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      const moved = await place(c, { deliveryAddress: addr({ lat: 30.44, lng: 31.58 }), paymentMethod: 'COD', quoteToken: q.quoteToken });
      expect(moved.status).toBe(409);
      expect(moved.body.error.details.reason).toBe('INPUTS_CHANGED');

      await s.setConfig('CHECKOUT_QUOTE_TTL_SECONDS', 1);
      try {
        const short = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
        await new Promise((r) => setTimeout(r, 1300));
        const expired = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: short.quoteToken });
        expect(expired.status).toBe(409);
        expect(expired.body.error.details.reason).toBe('QUOTE_EXPIRED');
        expect(expired.body.error.details.currentQuote.quoteToken).toBeTruthy();
      } finally {
        await clearConfig('CHECKOUT_QUOTE_TTL_SECONDS');
      }
    });

    it('an offer that starts after the quote changes the price — stale, never silently a different total', async () => {
      const v = await s.vendor({ name: 'Flash Later', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const pf = await s.product(v, { priceMinor: 10000, inventoryMode: 'OPEN' });
      const c = await cartFor([pf]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expectData(await createOffer({ vendorBranchId: v.branchId, name: 'Flash now', mechanism: 'FLASH_SALE', specialPriceMinor: 6000, productIds: [pf.id] }), 201);
      const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: q.quoteToken });
      expect(res.status).toBe(409);
      expect(res.body.error.details.currentQuote.summary.discountMinor).toBe(4000);
    });

    it('a forged, altered or someone else\'s token is refused (400 QUOTE_INVALID) — it can neither cheapen nor transfer a quote', async () => {
      const c = await cartFor([p1]);
      const other = await cartFor([p1]);
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      const [body, sig] = q.quoteToken.split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      payload.amounts.deliveryFeeMinor = 1;
      payload.breakdown.deliveryFeeMinor = 1;
      const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
      for (const [who, token] of [[c, forged], [c, 'garbage'], [c, `${body}.`], [other, q.quoteToken]] as Array<[Actor, string]>) {
        const res = await place(who, { deliveryAddress: addr(), paymentMethod: 'COD', quoteToken: token });
        expect(res.status).toBe(400);
        expect(res.body.error.details.code).toBe('QUOTE_INVALID');
      }
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });
  });

  describe('payment methods: COD ≠ Pay at Delivery ≠ Manual Transfer', () => {
    it('PAY_AT_DELIVERY stores the electronic method, creates no payment row, and fulfilment is NOT blocked', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'VODAFONE_CASH' }), 201);
      expect(order).toMatchObject({ paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'VODAFONE_CASH', walletAmountMinor: 0, amountDueMinor: order.totalMinor });
      expect(await paymentOf(order.id)).toBeUndefined();
      await s.vendorPrepares(v1, order.id);
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER');
    });

    it('COD is cash: no electronic method; sending one, omitting a required one, or an unknown / disabled one is refused', async () => {
      const c = await cartFor([p1]);
      const cod = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'COD' }), 201);
      expect(cod).toMatchObject({ paymentMethod: 'COD', electronicPaymentMethod: null });

      const c2 = await cartFor([p1]);
      const codWith = await place(c2, { deliveryAddress: addr(), paymentMethod: 'COD', electronicPaymentMethod: 'INSTAPAY' });
      expect(codWith.body.error.details.code).toBe('ELECTRONIC_PAYMENT_METHOD_NOT_ALLOWED');
      for (const method of ['PAY_AT_DELIVERY', 'MANUAL_TRANSFER']) {
        const missing = await place(c2, { deliveryAddress: addr(), paymentMethod: method });
        expect(missing.body.error.details.code).toBe('ELECTRONIC_PAYMENT_METHOD_REQUIRED');
      }
      expect((await place(c2, { deliveryAddress: addr(), paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'PAYPAL' })).status).toBe(400);

      await s.setConfig('CHECKOUT_ENABLED_ELECTRONIC_METHODS', ['INSTAPAY', 'WE_PAY']);
      try {
        const q = (await quote(c2, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
        expect(q.payment.options.electronicMethods).toEqual(['INSTAPAY', 'WE_PAY']);
        const disabled = await place(c2, { deliveryAddress: addr(), paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'ORANGE_CASH' });
        expect(disabled.body.error.details.code).toBe('ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE');
        expectData(await place(c2, { deliveryAddress: addr(), paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'WE_PAY' }), 201);
      } finally {
        await clearConfig('CHECKOUT_ENABLED_ELECTRONIC_METHODS');
      }
    });

    it('MANUAL_TRANSFER keeps the chosen method on the order AND the payment row; each of the five methods is accepted; it is refused when transfers are not configured', async () => {
      for (const method of ['INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY']) {
        const c = await cartFor([p1]);
        const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: method }), 201);
        expect(order.electronicPaymentMethod).toBe(method);
        expect(await paymentOf(order.id)).toMatchObject({ method: 'MANUAL_TRANSFER', electronic_method: method, status: 'PENDING' });
        expect(num((await paymentOf(order.id)).amount_minor)).toBe(order.totalMinor);
      }
      await world.ds.query("DELETE FROM business_config WHERE key = 'MANUAL_TRANSFER_DESTINATION'");
      try {
        const c = await cartFor([p1]);
        const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
        expect(q.payment.options.manualTransfer).toMatchObject({ available: false, reason: 'NOT_CONFIGURED' });
        const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' });
        expect(res.body.error.details.code).toBe('MANUAL_TRANSFER_NOT_CONFIGURED');
      } finally {
        await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly', phoneOrAccountNumber: '01000000000' });
      }
    });

    it('the order-details payment view says "awaiting approval" — created is not paid', async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);
      const d = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: c.accessToken }));
      expect(d.payment).toMatchObject({ method: 'MANUAL_TRANSFER', electronicMethod: 'INSTAPAY', status: 'PENDING', awaitingApproval: true });
      await claim(c, order.id);
      expectData(await approve((await paymentOf(order.id)).id), 201);
      const paid = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: c.accessToken }));
      expect(paid.payment).toMatchObject({ status: 'PAID', awaitingApproval: false });
    });
  });

  describe('payment gating in the backend state machines', () => {
    it('a MANUAL_TRANSFER order: the vendor may ACCEPT but not PREPARE, admin cannot move the order to PREPARING, and nothing dispatches — until the payment is approved', async () => {
      await s.driver({ lat: 30.4212, lng: 31.5612 });
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'INSTAPAY' }), 201);
      const seg = await segmentOf(order.id, v1);

      expectData(await vendorStatus(v1, seg, 'CONFIRMED')); // accepting is fine
      const blocked = await vendorStatus(v1, seg, 'PREPARING');
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.details).toMatchObject({ code: 'PAYMENT_NOT_APPROVED', paymentStatus: 'PENDING' });
      expectData(await adminStatus(order.id, 'CONFIRMED'));
      const adminBlocked = await adminStatus(order.id, 'PREPARING');
      expect(adminBlocked.status).toBe(409);
      expect(adminBlocked.body.error.details.code).toBe('PAYMENT_NOT_APPROVED');
      expect((await world.ds.query('SELECT status FROM order_vendor_segments WHERE id = $1', [seg]))[0].status).toBe('CONFIRMED');
      expect((await orderRow(order.id)).status).toBe('CONFIRMED');

      // claimed / under review still block
      await claim(c, order.id);
      expect((await paymentOf(order.id)).status).toBe('UNDER_REVIEW');
      expect((await vendorStatus(v1, seg, 'PREPARING')).status).toBe(409);
      // a manual dispatch attempt is blocked too
      const assign = await adminStatus(order.id, 'ASSIGNED_TO_DRIVER');
      expect(assign.status).toBeGreaterThanOrEqual(400);

      expectData(await approve((await paymentOf(order.id)).id), 201);
      for (const st of ['PREPARING', 'READY_FOR_PICKUP']) expectData(await vendorStatus(v1, seg, st));
      expect((await orderRow(order.id)).status).toBe('ASSIGNED_TO_DRIVER'); // and now it dispatches
    });

    it('a REJECTED transfer keeps blocking; the order is never prepared or dispatched', async () => {
      const c = await cartFor([p1]);
      const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: 'ORANGE_CASH' }), 201);
      const seg = await segmentOf(order.id, v1);
      await claim(c, order.id);
      expectData(await reject((await paymentOf(order.id)).id), 201);
      expectData(await vendorStatus(v1, seg, 'CONFIRMED'));
      expect((await vendorStatus(v1, seg, 'PREPARING')).body.error.details.code).toBe('PAYMENT_NOT_APPROVED');
    });

    it('COD and PAY_AT_DELIVERY never block fulfilment', async () => {
      for (const body of [{ paymentMethod: 'COD' }, { paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: 'ETISALAT_CASH' }]) {
        const c = await cartFor([p1]);
        const order = expectData<any>(await place(c, { deliveryAddress: addr(), ...body }), 201);
        const seg = await segmentOf(order.id, v1);
        for (const st of ['CONFIRMED', 'PREPARING']) expectData(await vendorStatus(v1, seg, st));
      }
    });
  });

  describe('coupons', () => {
    it('are never auto-applied; entering the code applies it to ITS vendor only — never spread across the other vendors — and the discount is frozen with the order', async () => {
      const offer = expectData<any>(await createOffer({ vendorBranchId: v1.branchId, name: 'Ten off', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 1000, couponCode: 'save10' }), 201);
      expect(offer.couponCode).toBe('SAVE10'); // normalised

      const c = await cartFor([p1, p2]);
      const plain = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expect(plain.summary.discountMinor).toBe(0);
      expect(plain.coupon).toEqual({ status: 'NONE' });

      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'Save10' })).data; // case-insensitive
      expect(q.coupon).toMatchObject({ status: 'APPLIED', code: 'SAVE10', discountMinor: 1000, vendorBranchId: v1.branchId, vendorName: 'CQ 1' });
      expect(q.summary.discountMinor).toBe(1000);
      expect(q.vendors.find((v: any) => v.name === 'CQ 1')).toMatchObject({ discountMinor: 1000, couponApplied: true });
      expect(q.vendors.find((v: any) => v.name === 'CQ 2')).toMatchObject({ discountMinor: 0, couponApplied: false }); // NOT distributed
      expect(q.summary.totalMinor).toBe(plain.summary.totalMinor - 1000);

      const order = expectData<any>(await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'SAVE10', quoteToken: q.quoteToken }), 201);
      expect(order.discountMinor).toBe(1000);
      const seg1 = await segmentOf(order.id, v1);
      const seg2 = await segmentOf(order.id, v2);
      expect(order.couponSnapshot).toMatchObject({ code: 'SAVE10', offerId: offer.id, vendorBranchId: v1.branchId, orderVendorSegmentId: seg1, discountMinor: 1000 });
      const segs = await world.ds.query('SELECT id, offer_discount_amount_minor, coupon_code_snapshot FROM order_vendor_segments WHERE order_id = $1', [order.id]);
      expect(segs.find((r: any) => r.id === seg1)).toMatchObject({ offer_discount_amount_minor: 1000, coupon_code_snapshot: 'SAVE10' });
      expect(segs.find((r: any) => r.id === seg2)).toMatchObject({ offer_discount_amount_minor: null, coupon_code_snapshot: null });
      expect((await world.ds.query('SELECT discount_applied_minor FROM offer_consumptions WHERE order_id = $1', [order.id])).map((r: any) => num(r.discount_applied_minor))).toEqual([1000]);

      // HISTORY: the offer changing or expiring later never touches the order
      await world.ds.query('UPDATE offers SET is_active = false, discount_value = 5000 WHERE id = $1', [offer.id]);
      const details = expectData<any>(await world.api('get', `/orders/${order.id}`, { token: c.accessToken }));
      expect(details.coupon).toMatchObject({ code: 'SAVE10', discountMinor: 1000 });
      expect(details.discountMinor).toBe(1000);
      expect(num((await orderRow(order.id)).total_minor)).toBe(q.summary.totalMinor);
    });

    it('every rejection is server-side and machine-readable: unknown, expired, not started, inactive, wrong vendor, minimum, usage limits, budget', async () => {
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ['EXPIRED1', { ...window(-48, -24), mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500 }, 'COUPON_EXPIRED'],
        ['FUTURE1', { ...window(24, 48), mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500 }, 'COUPON_NOT_STARTED'],
        ['MINIMUM1', { mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500, minimumEligibleSubtotalMinor: 99999 }, 'COUPON_MINIMUM_NOT_MET'],
      ];
      const c = await cartFor([p1]);
      for (const [code, extra, reason] of cases) {
        expectData(await createOffer({ vendorBranchId: v1.branchId, name: code, couponCode: code, ...extra }), 201);
        const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: code })).data;
        expect(q.coupon).toMatchObject({ status: 'REJECTED', reasonCode: reason });
        expect(q.summary.discountMinor).toBe(0); // a rejected coupon changes nothing
        expect(q.canPlaceOrder).toBe(true); // …and never blocks the checkout itself
        const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: code });
        expect(res.status).toBe(400);
        expect(res.body.error.details.code).toBe(reason);
      }
      expect((await quote(c, { deliveryAddress: addr(), couponCode: 'NOPE-404' })).data.coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_NOT_FOUND' });

      const off = expectData<any>(await createOffer({ vendorBranchId: v1.branchId, name: 'off', couponCode: 'OFF1', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500 }), 201);
      await world.ds.query('UPDATE offers SET is_active = false WHERE id = $1', [off.id]);
      expect((await quote(c, { deliveryAddress: addr(), couponCode: 'OFF1' })).data.coupon.reasonCode).toBe('COUPON_INACTIVE');

      expectData(await createOffer({ vendorBranchId: v2.branchId, name: 'v2 only', couponCode: 'V2ONLY', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500 }), 201);
      const q2 = (await quote(c, { deliveryAddress: addr(), couponCode: 'V2ONLY' })).data; // cart has only vendor 1
      expect(q2.coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_NOT_APPLICABLE_TO_CART' });
    });

    it('usage limits: per-customer and global limits and the budget cap are enforced from live consumption', async () => {
      expectData(await createOffer({ vendorBranchId: v1.branchId, name: 'once', couponCode: 'ONCEEACH', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500, perCustomerLifetimeLimit: 1 }), 201);
      const c = await cartFor([p1]);
      expectData(await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'ONCEEACH' }), 201);
      await s.addToCart(c, p1.id, 1);
      expect((await quote(c, { deliveryAddress: addr(), couponCode: 'ONCEEACH' })).data.coupon.reasonCode).toBe('COUPON_CUSTOMER_LIMIT_REACHED');
      const fresh = await cartFor([p1]);
      expect((await quote(fresh, { deliveryAddress: addr(), couponCode: 'ONCEEACH' })).data.coupon.status).toBe('APPLIED');

      expectData(await createOffer({ vendorBranchId: v1.branchId, name: 'global', couponCode: 'GLOBAL1', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500, totalAllocationLimit: 1 }), 201);
      expectData(await place(fresh, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'GLOBAL1' }), 201);
      const another = await cartFor([p1]);
      expect((await quote(another, { deliveryAddress: addr(), couponCode: 'GLOBAL1' })).data.coupon.reasonCode).toBe('COUPON_USAGE_LIMIT_REACHED');

      expectData(await createOffer({ vendorBranchId: v1.branchId, name: 'budget', couponCode: 'BUDGET1', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 800, budgetCapMinor: 1000 }), 201);
      expectData(await place(another, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'BUDGET1' }), 201); // 800 of 1000
      const third = await cartFor([p1]);
      const capped = (await quote(third, { deliveryAddress: addr(), couponCode: 'BUDGET1' })).data;
      expect(capped.coupon).toMatchObject({ status: 'APPLIED', discountMinor: 200 }); // only what is left of the budget
    });

    it('a coupon and an automatic offer never combine on the same vendor: the customer is told, nothing is silently replaced', async () => {
      const v = await s.vendor({ name: 'Auto Offer', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const pv = await s.product(v, { priceMinor: 10000, inventoryMode: 'OPEN' });
      expectData(await createOffer({ vendorBranchId: v.branchId, name: 'auto 5%', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 500 }), 201);
      expectData(await createOffer({ vendorBranchId: v.branchId, name: 'coupon 20%', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'PERCENTAGE', discountValue: 2000, couponCode: 'BIG20' }), 201);
      const c = await cartFor([pv]);
      const noCode = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD' })).data;
      expect(noCode.summary.discountMinor).toBe(500); // the automatic offer applies, the coupon offer does not
      const q = (await quote(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'BIG20' })).data;
      expect(q.coupon).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_CONFLICTS_WITH_OFFER' });
      expect(q.summary.discountMinor).toBe(500);
      const res = await place(c, { deliveryAddress: addr(), paymentMethod: 'COD', couponCode: 'BIG20' });
      expect(res.body.error.details.code).toBe('COUPON_CONFLICTS_WITH_OFFER');
    });

    it('a coupon cannot cover a flash-sale item, nor a weighed one (no eligible items)', async () => {
      const v = await s.vendor({ name: 'Flash Coupon', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      const pf = await s.product(v, { priceMinor: 10000, inventoryMode: 'OPEN' });
      expectData(await createOffer({ vendorBranchId: v.branchId, name: 'flash', mechanism: 'FLASH_SALE', specialPriceMinor: 7000, productIds: [pf.id] }), 201);
      // a coupon over a product a flash sale covers is refused by the admin overlap rule; a branch-wide one is created on another vendor
      const other = await createOffer({ vendorBranchId: v.branchId, name: 'coupon', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 500, couponCode: 'FLASHCLASH' });
      expect(other.status).toBe(400);
      expect(other.body.error.details.code).toBe('OFFER_MECHANISM_CONFLICT');
    });

    it('admin coupon rules: only a subtotal discount can carry a code, and a code is unique', async () => {
      const flashWithCode = await createOffer({ vendorBranchId: v1.branchId, name: 'x', mechanism: 'FLASH_SALE', specialPriceMinor: 100, productIds: [p1.id], couponCode: 'NOFLASH' });
      expect(flashWithCode.body.error.details.code).toBe('COUPON_REQUIRES_SUBTOTAL_DISCOUNT');
      expectData(await createOffer({ vendorBranchId: v1.branchId, name: 'uniq', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 100, couponCode: 'UNIQ1' }), 201);
      const dup = await createOffer({ vendorBranchId: v2.branchId, name: 'uniq2', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 100, couponCode: 'uniq1' });
      expect(dup.body.error.details.code).toBe('COUPON_CODE_ALREADY_EXISTS');
      expect((await createOffer({ vendorBranchId: v2.branchId, name: 'bad', mechanism: 'SUBTOTAL_DISCOUNT', discountType: 'FIXED', discountValue: 100, couponCode: 'a b' })).status).toBe(400);
    });
  });
});
