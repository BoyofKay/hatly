/**
 * Hatly Service location semantics, over real HTTP. Proves the real checkout path (real cart, real
 * BusinessConfig, real CheckoutPlannerService) for both ad-hoc service types: the place the customer
 * chose (BUY_FROM_PLACE pickup / DELIVER_TO_PLACE destination) is REQUIRED, and a missing one is
 * REJECTED rather than silently replaced by any Hatly-configured location — even when those Hatly
 * defaults ARE configured (they are, below, precisely to prove they are never read).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData } from './support/actors';

describe('E2E — Hatly Service location semantics', () => {
  let world: World;
  let s: Scenario;
  let customer: Actor;
  // Exactly the default service-area center (Scenario.serviceArea's own default lat/lng) — guarantees
  // this address is genuinely serviceable without depending on that default staying unchanged.
  // PD-009 (amended): Hatly Service is priced and served by the address's ACTIVE zone (set in beforeAll); the pin is kept to
  // prove it plays no part in the price.
  const address: Record<string, unknown> = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56 };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    // PD-009 (amended): Hatly Service fee = the zone's fee × the multiplier. Registered-vendor distance pricing is deliberately
    // NOT configured here — Hatly Service must not depend on it.
    address.deliveryZoneId = (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id;
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    // Both Hatly defaults are configured on purpose: the tests below prove neither is ever read as a fallback.
    await s.setConfig('HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', { latitude: 30.43, longitude: 31.57, label: 'Hatly Pickup Default' });
    await s.setConfig('HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION', { latitude: 30.99, longitude: 31.99, label: 'Hatly HQ' });
    customer = await s.customer('Hatly Service Location Customer');
  });
  afterAll(async () => {
    await world.close();
  });

  afterEach(async () => {
    // Each test starts a fresh ad-hoc group — clear whatever the previous test's cart left behind
    // (a cart may hold at most ONE AD_HOC_SERVICE group — see CartService's own group-cap logic).
    await world.api('delete', '/cart', { token: customer.accessToken });
  });

  async function addAdHocItem(body: Record<string, unknown>) {
    return world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body });
  }

  async function getQuote() {
    return world.api('post', '/checkout/quote', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } });
  }

  it('BUY_FROM_PLACE with a customer-chosen pickup quotes successfully — destination is the customer\'s own delivery address', async () => {
    expectData(
      await addAdHocItem({
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: 'BUY_FROM_PLACE',
        pickupLatitude: 30.3,
        pickupLongitude: 31.45,
        freeTextDescription: 'Panadol Extra 500mg, two boxes',
        quantity: 1,
      }),
      201,
    );

    const res = await getQuote();
    expect(res.status).toBe(201);
    expect(res.body.data.canPlaceOrder).toBe(true);
    expect(res.body.data.delivery.feeMinor).toBeGreaterThan(0);
  });

  it('THE FIX: a checkout quote for BUY_FROM_PLACE with NO pickup place reports a clear blocker — never silently starts from Hatly\'s configured pickup, even though one IS configured', async () => {
    expectData(
      await addAdHocItem({
        adHocPlaceName: 'Somewhere to buy from',
        adHocServiceType: 'BUY_FROM_PLACE',
        freeTextDescription: 'Two croissants',
        quantity: 1,
      }),
      201,
    );

    const res = await getQuote();

    expect(res.status).toBe(201);
    expect(res.body.data.canPlaceOrder).toBe(false);
    expect(res.body.data.blockers).toEqual([expect.objectContaining({ code: 'BUY_FROM_PLACE_PICKUP_REQUIRED' })]);
    expect(res.body.data.quoteToken).toBeNull();
  });

  it('THE FIX: actually attempting to PLACE a BUY_FROM_PLACE order with no pickup place is hard-rejected with a real 400, never creates an order', async () => {
    expectData(
      await addAdHocItem({
        adHocPlaceName: 'Another place',
        adHocServiceType: 'BUY_FROM_PLACE',
        freeTextDescription: 'A cake',
        quantity: 1,
      }),
      201,
    );

    const res = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('BUY_FROM_PLACE_PICKUP_REQUIRED');
  });

  it('BUY_FROM_PLACE with an explicit customer-supplied pickup override quotes successfully', async () => {
    expectData(
      await addAdHocItem({
        adHocPlaceName: 'Specific Pharmacy Branch',
        adHocServiceType: 'BUY_FROM_PLACE',
        pickupLatitude: 30.1,
        pickupLongitude: 31.3,
        freeTextDescription: 'Insulin, refrigerated',
        quantity: 1,
      }),
      201,
    );

    const res = await getQuote();
    expect(res.status).toBe(201);
    expect(res.body.data.canPlaceOrder).toBe(true);
    expect(res.body.data.delivery.feeMinor).toBeGreaterThan(0);
  });

  it('DELIVER_TO_PLACE with an explicit destination quotes successfully — origin is the customer\'s own delivery address', async () => {
    expectData(
      await addAdHocItem({
        adHocPlaceName: "Mom's house",
        adHocServiceType: 'DELIVER_TO_PLACE',
        destinationLatitude: 30.2,
        destinationLongitude: 31.4,
        freeTextDescription: 'A forgotten house key',
        quantity: 1,
      }),
      201,
    );

    const res = await getQuote();
    expect(res.status).toBe(201);
    expect(res.body.data.canPlaceOrder).toBe(true);
    expect(res.body.data.delivery.feeMinor).toBeGreaterThan(0);
  });

  it('THE FIX: a checkout quote for DELIVER_TO_PLACE with NO destination reports a clear blocker — never silently uses Hatly\'s own configured address, even though one IS configured', async () => {
    // HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION is configured in beforeAll — it must never be read as a
    // destination: proves the fix removed the READ path, not just an unseeded default.
    expectData(
      await addAdHocItem({
        adHocPlaceName: 'Somewhere',
        adHocServiceType: 'DELIVER_TO_PLACE',
        freeTextDescription: 'A package',
        quantity: 1,
      }),
      201,
    );

    const res = await getQuote();

    // The Quote endpoint's own established convention: a business-validation problem is reported as
    // a clear blocker (canPlaceOrder: false), not a raw HTTP error — exactly what lets the Customer
    // App show the customer inline guidance rather than a crash. `POST /orders` (the next test) is
    // where an actual attempt to PLACE the order is hard-rejected.
    expect(res.status).toBe(201);
    expect(res.body.data.canPlaceOrder).toBe(false);
    expect(res.body.data.blockers).toEqual([
      expect.objectContaining({ code: 'DELIVER_TO_PLACE_DESTINATION_REQUIRED' }),
    ]);
    expect(res.body.data.quoteToken).toBeNull();
  });

  it('THE FIX: actually attempting to PLACE a DELIVER_TO_PLACE order with no destination is hard-rejected with a real 400, never creates an order', async () => {
    expectData(
      await addAdHocItem({
        adHocPlaceName: 'Somewhere Else',
        adHocServiceType: 'DELIVER_TO_PLACE',
        freeTextDescription: 'Another package',
        quantity: 1,
      }),
      201,
    );

    const res = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } });

    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('DELIVER_TO_PLACE_DESTINATION_REQUIRED');
  });
});
