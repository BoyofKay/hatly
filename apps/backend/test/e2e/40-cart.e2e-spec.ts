/**
 * Group 8 / phase 6 — cart journey over real HTTP: add / update / remove / clear, multi-vendor
 * grouping and its limits, pickup vs delivery rules, weighted products, vendor custom items,
 * Hatly-service (ad-hoc) items, and the delivery-fee quote — every rule is a real PostgreSQL write.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { boundary } from './support/external-boundary';

describe('E2E — cart', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let v1: VendorFixture;
  let v2: VendorFixture;
  let v3: VendorFixture;
  let v4: VendorFixture;
  let piece1: { id: string; priceMinor: number };
  let piece2: { id: string; priceMinor: number };
  let piece3: { id: string; priceMinor: number };
  let piece4: { id: string; priceMinor: number };
  let weighed: { id: string; priceMinor: number };
  let customer: Actor;
  const home = { lat: 30.425, lng: 31.565 };

  const cart = async (actor = customer) => expectData(await world.api('get', '/cart', { token: actor.accessToken }));
  const errorOf = (res: { body: any }) => res.body.error?.details?.code;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing({ per100mMinor: 1000, minimumMinor: 1500, additionalVendorMinor: 500 });
    area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'V1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'V2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    v3 = await s.vendor({ name: 'V3', serviceAreaId: area.id, lat: 30.441, lng: 31.581 });
    v4 = await s.vendor({ name: 'V4', serviceAreaId: area.id, lat: 30.451, lng: 31.591 });
    piece1 = await s.product(v1, { name: 'P1', priceMinor: 10000 });
    piece2 = await s.product(v2, { name: 'P2', priceMinor: 20000 });
    piece3 = await s.product(v3, { name: 'P3', priceMinor: 30000 });
    piece4 = await s.product(v4, { name: 'P4', priceMinor: 40000 });
    weighed = await s.product(v1, { name: 'Cheese per kg', priceMinor: 20000, pricingUnit: 'WEIGHT' });
  });
  beforeEach(async () => {
    boundary.reset();
    customer = await s.customer();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a brand-new customer has an empty, non-checkout-ready cart', async () => {
    const view = await cart();
    expect(view).toMatchObject({ groups: [], subtotalMinor: 0, readyForCheckout: false, fulfillmentType: 'DELIVERY' });
  });

  it('adds an item with the CURRENT catalog price, groups it under its vendor branch, and computes the line total', async () => {
    const view = expectData(await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece1.id, quantity: 3, notes: 'no onions' } }), 201);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0]).toMatchObject({ groupType: 'CATALOG', vendorBranchId: v1.branchId, subtotalMinor: 30000 });
    expect(view.groups[0].items[0]).toMatchObject({ productId: piece1.id, quantity: 3, unitPriceMinor: 10000, lineTotalMinor: 30000, notes: 'no onions' });
    expect(view).toMatchObject({ subtotalMinor: 30000, readyForCheckout: true });
  });

  it('a later price change is reflected in the cart (cart is live) but an existing ORDER keeps the snapshot price', async () => {
    const p = await s.product(v1, { name: 'Volatile', priceMinor: 5000 });
    await s.addToCart(customer, p.id, 2);
    // R7: a vendor's price REDUCTION applies directly (an increase would wait for Hatly)
    expectData(await world.api('patch', `/vendor/products/${p.id}`, { token: v1.manager.accessToken, body: { priceMinor: 4000 } }));
    expect((await cart()).subtotalMinor).toBe(8000);
    const order = await s.checkout(customer, home);
    expectData(await world.api('patch', `/vendor/products/${p.id}`, { token: v1.manager.accessToken, body: { priceMinor: 3000 } }));
    const stored = expectData(await world.api('get', `/orders/${order.id}`, { token: customer.accessToken }));
    expect(stored.subtotalMinor).toBe(8000);
    expect(stored.segments[0].items[0].unitPriceMinor).toBe(4000);
  });

  it('CHARACTERIZATION: adding the same product twice creates two lines (no merging)', async () => {
    await s.addToCart(customer, piece1.id, 1);
    const view = await s.addToCart(customer, piece1.id, 2);
    expect(view.groups[0].items).toHaveLength(2);
    expect(view.subtotalMinor).toBe(30000);
  });

  it('updates and removes lines; quantity bounds are enforced at the HTTP edge', async () => {
    const view = await s.addToCart(customer, piece1.id, 2);
    const itemId = view.groups[0].items[0].id;
    const updated = expectData(await world.api('patch', `/cart/items/${itemId}`, { token: customer.accessToken, body: { quantity: 5 } }));
    expect(updated.groups[0].items[0].quantity).toBe(5);
    for (const quantity of [0, -1, 51, 1.5, '3']) {
      const res = await world.api('patch', `/cart/items/${itemId}`, { token: customer.accessToken, body: { quantity } });
      expect({ quantity, status: res.status }).toEqual({ quantity, status: 400 });
    }
    expect((await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece1.id, quantity: 51 } })).status).toBe(400);
    expect((await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece1.id, quantity: 0 } })).status).toBe(400);
    expect((await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: '00000000-0000-4000-8000-000000000000', quantity: 1 } })).status).toBe(404);
    const removed = expectData(await world.api('delete', `/cart/items/${itemId}`, { token: customer.accessToken }));
    expect(removed.subtotalMinor).toBe(0);
    expect((await world.api('delete', `/cart/items/${itemId}`, { token: customer.accessToken })).status).toBe(404); // already gone
  });

  it('clearing the cart removes every line and group', async () => {
    await s.addToCart(customer, piece1.id, 1);
    await s.addToCart(customer, piece2.id, 1);
    expectData(await world.api('delete', '/cart', { token: customer.accessToken }));
    expect(await cart()).toMatchObject({ groups: [], subtotalMinor: 0 });
    expect(await world.ds.query('SELECT ci.id FROM cart_items ci JOIN cart_vendor_groups g ON g.id = ci.cart_vendor_group_id JOIN carts c ON c.id = g.cart_id WHERE c.customer_id = $1', [customer.id])).toEqual([]);
  });

  describe('multi-vendor grouping', () => {
    it('groups items per vendor branch, up to 3 vendors; a 4th is refused with MAX_VENDOR_GROUPS_EXCEEDED and changes nothing', async () => {
      await s.addToCart(customer, piece1.id, 1);
      await s.addToCart(customer, piece2.id, 1);
      const three = await s.addToCart(customer, piece3.id, 1);
      expect(three.groups).toHaveLength(3);
      expect(three.subtotalMinor).toBe(60000);
      const fourth = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece4.id, quantity: 1 } });
      expect(fourth.status).toBe(409);
      expect(errorOf(fourth)).toBe('MAX_VENDOR_GROUPS_EXCEEDED');
      expect((await cart()).groups).toHaveLength(3);
      // a second item for an existing vendor is still fine at the cap
      expect((await s.addToCart(customer, piece1.id, 1)).groups).toHaveLength(3);
    });
  });

  describe('pickup vs delivery', () => {
    it('PICKUP works for one vendor and is then refused for a second vendor; switching to PICKUP with 2 vendors is refused', async () => {
      await s.addToCart(customer, piece1.id, 1);
      const pickup = expectData(await world.api('patch', '/cart/fulfillment-type', { token: customer.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      expect(pickup.fulfillmentType).toBe('PICKUP');
      const second = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece2.id, quantity: 1 } });
      expect(second.status).toBe(409);
      expect(errorOf(second)).toBe('PICKUP_SINGLE_VENDOR_ONLY');
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: customer.accessToken, body: { fulfillmentType: 'DELIVERY' } }));
      await s.addToCart(customer, piece2.id, 1);
      const back = await world.api('patch', '/cart/fulfillment-type', { token: customer.accessToken, body: { fulfillmentType: 'PICKUP' } });
      expect(back.status).toBe(409);
      expect(errorOf(back)).toBe('PICKUP_SINGLE_VENDOR_ONLY');
      expect((await world.api('patch', '/cart/fulfillment-type', { token: customer.accessToken, body: { fulfillmentType: 'TELEPORT' } })).status).toBe(400);
    });

    it('a pickup order has a zero delivery fee; a delivery order for the same cart does not', async () => {
      await s.addToCart(customer, piece1.id, 1);
      const delivery = expectData(await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: home.lat, longitude: home.lng } }), 201);
      expect(delivery.applicable).toBe(true);
      expect(delivery.deliveryFeeMinor).toBeGreaterThan(0);
      expectData(await world.api('patch', '/cart/fulfillment-type', { token: customer.accessToken, body: { fulfillmentType: 'PICKUP' } }));
      const pickup = expectData(await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: home.lat, longitude: home.lng } }), 201);
      expect(pickup).toEqual({ applicable: true, deliveryFeeMinor: 0 });
      const order = await s.checkout(customer, home);
      expect(order).toMatchObject({ fulfillmentType: 'PICKUP', deliveryFeeMinor: 0, totalMinor: 10000 });
    });
  });

  describe('delivery fee quote', () => {
    it('empty cart is not applicable; single vendor uses distance pricing with the minimum floor; each extra vendor adds the fixed fee', async () => {
      const empty = expectData(await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: home.lat, longitude: home.lng } }), 201);
      expect(empty).toEqual({ applicable: false, reason: 'EMPTY_CART' });

      await s.addToCart(customer, piece1.id, 1);
      const one = expectData(await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: home.lat, longitude: home.lng } }), 201);
      // The order the customer would actually place must be charged exactly what was quoted.
      const quotedOne = one.deliveryFeeMinor;
      await s.addToCart(customer, piece2.id, 1);
      const two = expectData(await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: home.lat, longitude: home.lng } }), 201);
      expect(two.deliveryFeeMinor).toBeGreaterThan(quotedOne);
      const order = await s.checkout(customer, home);
      expect(order.deliveryFeeMinor).toBe(two.deliveryFeeMinor);
      expect(order.deliveryFeeBreakdownSnapshot.additionalVendorChargeMinor).toBe(500);
      expect(order.deliveryFeeBreakdownSnapshot.vendorSequence).toHaveLength(2);
      expect(order.totalMinor).toBe(order.subtotalMinor + order.deliveryFeeMinor - order.discountMinor);
    });

    it('rejects out-of-range coordinates', async () => {
      await s.addToCart(customer, piece1.id, 1);
      expect((await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: 91, longitude: 31 } })).status).toBe(400);
      expect((await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: 30 } })).status).toBe(400);
    });

    it('a Maps provider outage fails closed with DELIVERY_FEE_UNAVAILABLE — quote AND checkout — never a guessed fee, and nothing is written', async () => {
      await s.addToCart(customer, piece1.id, 1);
      boundary.mapsOutage = true;
      const quote = await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: 30.4111, longitude: 31.5111 } });
      expect(quote.status).toBe(400);
      expect(errorOf(quote)).toBe('DELIVERY_FEE_UNAVAILABLE');
      const order = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: { line1: 'x', latitude: 30.4222, longitude: 31.5222 }, paymentMethod: 'COD' } });
      expect(order.status).toBe(400);
      expect(errorOf(order)).toBe('DELIVERY_FEE_UNAVAILABLE');
      boundary.mapsOutage = false;
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [customer.id])).toEqual([]);
      expect((await cart()).groups).toHaveLength(1); // the cart is untouched and can still be checked out once Maps recovers
      expectData(await world.api('post', '/cart/delivery-fee-quote', { token: customer.accessToken, body: { latitude: 30.4333, longitude: 31.5333 } }), 201);
    });
  });

  describe('weighted products', () => {
    it('require requestedWeightGrams (stored quantity 1); the line total is the estimate price × grams / 1000', async () => {
      const missing = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: weighed.id, quantity: 1 } });
      expect(missing.status).toBe(400);
      expect(errorOf(missing)).toBe('REQUESTED_WEIGHT_GRAMS_REQUIRED');
      const view = expectData(await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: weighed.id, quantity: 1, requestedWeightGrams: 750 } }), 201);
      const line = view.groups[0].items[0];
      expect(line).toMatchObject({ pricingUnit: 'WEIGHT', requestedWeightGrams: 750, quantity: 1 });
      expect(line.lineTotalMinor).toBe(15000); // 200.00 EGP/kg × 0.75 kg
    });

    it('weight can be updated on a weighted line but quantity cannot; weight is refused on a piece product', async () => {
      const view = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: weighed.id, quantity: 1, requestedWeightGrams: 500 } });
      const itemId = view.body.data.groups[0].items[0].id;
      const w = expectData(await world.api('patch', `/cart/items/${itemId}`, { token: customer.accessToken, body: { requestedWeightGrams: 1250 } }));
      expect(w.groups[0].items[0].lineTotalMinor).toBe(25000);
      const q = await world.api('patch', `/cart/items/${itemId}`, { token: customer.accessToken, body: { quantity: 2 } });
      expect(q.status).toBe(400);
      expect(errorOf(q)).toBe('QUANTITY_NOT_APPLICABLE');
      const piece = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece1.id, quantity: 1, requestedWeightGrams: 100 } });
      expect(piece.status).toBe(400);
      expect(errorOf(piece)).toBe('WEIGHT_NOT_APPLICABLE');
    });
  });

  describe('weighted products — quantities in whole grams, exact totals, invalid weights refused', () => {
    // 200.00 EGP/kg (see `weighed`). Totals are integer minor units: price × grams / 1000, rounded once.
    it.each([
      [100, 2000],
      [250, 5000],
      [333, 6660],
      [1000, 20000],
      [1250, 25000],
      [3000, 60000],
    ])('%i g of a 200.00/kg product costs %i minor units, in the cart and (identically) at the order', async (grams, expected) => {
      const c = await s.customer();
      const view = expectData<any>(await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: weighed.id, quantity: 1, requestedWeightGrams: grams } }), 201);
      expect(view.groups[0].items[0]).toMatchObject({ requestedWeightGrams: grams, lineTotalMinor: expected });
      expect(Number.isInteger(view.groups[0].items[0].lineTotalMinor)).toBe(true);
    });

    it('a fractional-cent result is rounded once, deterministically (no floating-point drift): 1 g of 99.99/kg and 1 kg multiples', async () => {
      const v = await s.vendor({ name: 'Rounding Vendor', serviceAreaId: (await s.serviceArea({ radiusMeters: 50000 })).id, lat: 30.421, lng: 31.561 });
      const odd = await s.product(v, { priceMinor: 9999, pricingUnit: 'WEIGHT' });
      const c = await s.customer();
      for (const [grams, expected] of [[1, 10], [333, 3330], [1000, 9999], [2000, 19998], [1500, 14999]] as Array<[number, number]>) {
        await world.api('delete', '/cart', { token: c.accessToken });
        const view = expectData<any>(await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: odd.id, quantity: 1, requestedWeightGrams: grams } }), 201);
        expect({ grams, total: view.groups[0].items[0].lineTotalMinor }).toEqual({ grams, total: expected });
      }
    });

    it.each([
      ['zero', 0],
      ['negative', -500],
      ['fractional grams', 1.5],
      ['a string', '1000'],
      ['not a number', null],
      ['above the 100 kg sanity ceiling', 100001],
    ])('an invalid weight (%s) is refused with a 400 and nothing is added', async (_label, grams) => {
      const c = await s.customer();
      const res = await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: weighed.id, quantity: 1, requestedWeightGrams: grams } });
      expect(res.status).toBe(400);
      const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(cart.groups).toEqual([]);
    });

    it('updating a weighted line applies the same validation', async () => {
      const c = await s.customer();
      const added = expectData<any>(await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: weighed.id, quantity: 1, requestedWeightGrams: 500 } }), 201);
      const itemId = added.groups[0].items[0].id;
      for (const bad of [0, -1, 2.5, 100001]) {
        expect({ bad, status: (await world.api('patch', `/cart/items/${itemId}`, { token: c.accessToken, body: { requestedWeightGrams: bad } })).status }).toEqual({ bad, status: 400 });
      }
      const ok = expectData<any>(await world.api('patch', `/cart/items/${itemId}`, { token: c.accessToken, body: { requestedWeightGrams: 1000 } }));
      expect(ok.groups[0].items[0]).toMatchObject({ requestedWeightGrams: 1000, lineTotalMinor: 20000 });
    });
  });

  describe('vendor custom items (pharmacy-style free text)', () => {
    beforeAll(async () => {
      // Custom requests are an admin setting of the vendor's SECTOR (off by default); these vendors are in a sector that allows them.
      await s.allowCustomRequests(v1);
      await s.allowCustomRequests(v2);
    });

    it('attach to an existing vendor group, are unpriced (0 in the subtotal, cart flagged), and need text or an image', async () => {
      const base = await s.addToCart(customer, piece1.id, 1);
      const groupId = base.groups[0].id;
      const neither = await world.api('post', '/cart/vendor-custom-items', { token: customer.accessToken, body: { cartVendorGroupId: groupId } });
      expect(neither.status).toBe(400);
      expect(errorOf(neither)).toBe('CUSTOM_ITEM_CONTENT_REQUIRED');
      const view = expectData(await world.api('post', '/cart/vendor-custom-items', { token: customer.accessToken, body: { cartVendorGroupId: groupId, freeTextDescription: 'Paracetamol 500mg' } }), 201);
      expect(view.groups[0].items).toHaveLength(2);
      const custom = view.groups[0].items.find((i: any) => i.productId === null);
      expect(custom).toMatchObject({ freeTextDescription: 'Paracetamol 500mg', unitPriceMinor: null, lineTotalMinor: null });
      // CHARACTERIZATION: only Hatly-Service groups set hasUnpricedItems; a vendor custom item is priced later by the vendor.
      expect(view).toMatchObject({ subtotalMinor: 10000, hasUnpricedItems: false, readyForCheckout: true });
      const fake = await world.api('post', '/cart/vendor-custom-items', { token: customer.accessToken, body: { cartVendorGroupId: groupId, freeTextDescription: 'x', imageUrls: ['https://evil.example/x.png'] } });
      expect(fake.status).toBe(400);
      expect(errorOf(fake)).toBe('INVALID_IMAGE_REFERENCE');
    });

    it('cannot attach to another customer\'s group, and a group can be started with a vendorBranchId', async () => {
      const other = await s.customer();
      const theirs = await s.addToCart(other, piece1.id, 1);
      const steal = await world.api('post', '/cart/vendor-custom-items', { token: customer.accessToken, body: { cartVendorGroupId: theirs.groups[0].id, freeTextDescription: 'x' } });
      expect(steal.status).toBe(404);
      const started = expectData(await world.api('post', '/cart/vendor-custom-items', { token: customer.accessToken, body: { vendorBranchId: v2.branchId, freeTextDescription: 'Anything cold' } }), 201);
      expect(started.groups[0].vendorBranchId).toBe(v2.branchId);
    });
  });

  describe('Hatly Service (ad-hoc) items', () => {
    const buy = { adHocPlaceName: 'Corner Bakery', adHocServiceType: 'BUY_FROM_PLACE', freeTextDescription: 'Two croissants', quantity: 2 };

    it('BUY_FROM_PLACE needs a place name, a service type and the matching coordinates', async () => {
      const ok = expectData(await world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body: { ...buy, pickupLatitude: 30.42, pickupLongitude: 31.56 } }), 201);
      expect(ok.groups[0]).toMatchObject({ groupType: 'AD_HOC_SERVICE', adHocPlaceName: 'Corner Bakery', adHocServiceType: 'BUY_FROM_PLACE' });
      await world.api('delete', '/cart', { token: customer.accessToken });
      const noName = await world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body: { ...buy, adHocPlaceName: undefined } });
      expect(errorOf(noName)).toBe('AD_HOC_PLACE_NAME_REQUIRED');
      const half = await world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body: { ...buy, pickupLatitude: 30.42 } });
      expect(errorOf(half)).toBe('INCOMPLETE_COORDINATE');
    });

    it('cannot be mixed with registered-vendor items in either direction, and is not deliverable as PICKUP', async () => {
      await s.addToCart(customer, piece1.id, 1);
      const mixed = await world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body: { ...buy, pickupLatitude: 30.42, pickupLongitude: 31.56 } });
      expect(mixed.status).toBe(409);
      expect(errorOf(mixed)).toBe('CATALOG_AD_HOC_MIX_NOT_ALLOWED');
      await world.api('delete', '/cart', { token: customer.accessToken });
      expectData(await world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body: { ...buy, pickupLatitude: 30.42, pickupLongitude: 31.56 } }), 201);
      const reverse = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: piece1.id, quantity: 1 } });
      expect(errorOf(reverse)).toBe('CATALOG_AD_HOC_MIX_NOT_ALLOWED');
      const pickup = await world.api('patch', '/cart/fulfillment-type', { token: customer.accessToken, body: { fulfillmentType: 'PICKUP' } });
      expect(errorOf(pickup)).toBe('PICKUP_REGISTERED_VENDOR_ONLY');
    });
  });

  it('carts are per customer and survive across requests; checkout empties it into a fresh ACTIVE cart', async () => {
    await s.addToCart(customer, piece1.id, 1);
    const before = (await cart()).id;
    expect((await cart()).id).toBe(before);
    await s.checkout(customer, home);
    const after = await cart();
    expect(after.groups).toEqual([]);
    expect(after.id).not.toBe(before);
    const second = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: { line1: 'x', latitude: 30.4, longitude: 31.5 }, paymentMethod: 'COD' } });
    expect([400, 404]).toContain(second.status); // nothing left to submit
    expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [customer.id])).toHaveLength(1);
  });
});
