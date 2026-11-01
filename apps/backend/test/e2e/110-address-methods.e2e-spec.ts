/**
 * The two ALTERNATIVE delivery-address methods over real HTTP and real PostgreSQL (real Google Maps provider against the fake-fetch boundary).
 *
 *  - MANUAL: a delivery area (zone) + the written address, no coordinates. Base fee = the zone's fixed fee.
 *  - GPS: the coordinates alone (no zone, no typed text). Coverage = the existing service-area check; base fee = the actual road
 *    distance priced with the Admin rate per 100 m and minimum fee. There is never a zone-fee fallback.
 *  - Ordinary delivery: final fee = base fee. Hatly AND Wasally: final fee = base fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER, applied
 *    once, after the base fee — whichever method found it.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken, DEFAULT_PASSWORD } from './support/actors';

describe('E2E — address methods (GPS / MANUAL) and their delivery pricing', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let zone: { id: string; feeMinor: number };
  let vendor: VendorFixture;
  let product: { id: string };

  const RATE = 1000; // 10.00 EGP per 100 m (Admin config, set below)
  const MINIMUM = 1500; // 15.00 EGP minimum
  const MULTIPLIER = 1.5;
  const ZONE_FEE = 2000; // 20.00 EGP
  const home = { latitude: 30.425, longitude: 31.565 };
  const farAway = { latitude: 29.0, longitude: 30.0 }; // inside Egypt, far outside the 50 km service area
  const PLACE = { latitude: 30.3, longitude: 31.45 };
  const START = { latitude: 30.35, longitude: 31.5 };

  const save = (c: Actor, body: Record<string, unknown>) => world.api('post', '/addresses', { token: c.accessToken, body });
  const list = async (c: Actor) => expectData<any[]>(await world.api('get', '/addresses', { token: c.accessToken }));
  const baseFee = (roundedMeters: number) => Math.max(MINIMUM, (roundedMeters / 100) * RATE);
  const quote = async (c: Actor, body: Record<string, unknown>) => expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body }), 201);
  const orderRow = async (id: string) => (await world.ds.query('SELECT * FROM orders WHERE id = $1', [id]))[0];
  const hatlyItem = { adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', pickupLatitude: PLACE.latitude, pickupLongitude: PLACE.longitude, destinationLatitude: START.latitude, destinationLongitude: START.longitude, freeTextDescription: 'Two boxes of tea', quantity: 1 };
  const wasallyItem = { adHocPlaceName: "Mom's house", adHocServiceType: 'DELIVER_TO_PLACE', pickupLatitude: START.latitude, pickupLongitude: START.longitude, destinationLatitude: PLACE.latitude, destinationLongitude: PLACE.longitude, freeTextDescription: 'A forgotten key', quantity: 1 };
  async function adHocCustomer(item: Record<string, unknown>): Promise<Actor> {
    const c = await s.customer();
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: item }), 201);
    return c;
  }
  const savedGps = async (c: Actor) => expectData<any>(await save(c, { mode: 'GPS', ...home }), 201);
  const savedManual = async (c: Actor) => expectData<any>(await save(c, { mode: 'MANUAL', line1: 'شارع المنشية جنب الجامع', deliveryZoneId: zone.id }), 201);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing({ per100mMinor: RATE, minimumMinor: MINIMUM, additionalVendorMinor: 500 });
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', MULTIPLIER);
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    area = await s.serviceArea({ radiusMeters: 50000 });
    zone = await s.deliveryZone({ serviceAreaId: area.id, feeMinor: ZONE_FEE });
    vendor = await s.vendor({ name: 'Methods Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('GPS method — saved from the coordinates alone', () => {
    it('needs no zone and no typed text; the server stores the method, the pin, an empty text and no zone', async () => {
      const c = await s.customer();
      const a = await savedGps(c);
      expect(a).toMatchObject({ mode: 'GPS', line1: '', latitude: home.latitude, longitude: home.longitude, deliveryZoneId: null, deliveryZone: null, zoneStatus: 'OK' });
      // and it is still there after signing in again (another device)
      const token = expectData<{ accessToken: string }>(await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: DEFAULT_PASSWORD } })).accessToken;
      const again = expectData<any[]>(await world.api('get', '/addresses', { token }));
      expect(again[0]).toMatchObject({ id: a.id, mode: 'GPS', latitude: home.latitude });
    });

    it('is rejected clearly OUTSIDE configured coverage (and nothing is saved); the zone is never consulted', async () => {
      const c = await s.customer();
      const res = await save(c, { mode: 'GPS', ...farAway });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('ADDRESS_OUT_OF_SERVICE_AREA');
      expect(await list(c)).toEqual([]);
    });

    it('is rejected for an incomplete or impossible point, and when a zone is sent (the methods are never mixed)', async () => {
      const c = await s.customer();
      expect((await save(c, { mode: 'GPS', latitude: home.latitude })).status).toBe(400);
      expect((await save(c, { mode: 'GPS', latitude: 48.8, longitude: 2.3 })).body.error.details.code).toBe('INVALID_DELIVERY_LOCATION');
      const withZone = await save(c, { mode: 'GPS', ...home, deliveryZoneId: zone.id });
      expect(withZone.status).toBe(400);
      expect(withZone.body.error.details).toMatchObject({ code: 'INVALID_DELIVERY_ADDRESS', field: 'deliveryZoneId' });
      expect(await list(c)).toEqual([]);
    });

    it('the database itself refuses a GPS address that carries a zone (or a MANUAL one that carries coordinates)', async () => {
      const c = await s.customer();
      const g = await savedGps(c);
      await expect(world.ds.query('UPDATE addresses SET delivery_zone_id = $1 WHERE id = $2', [zone.id, g.id])).rejects.toThrow(/chk_addresses_gps_shape/);
      const m = await savedManual(c);
      await expect(world.ds.query('UPDATE addresses SET latitude = 30.4, longitude = 31.5 WHERE id = $1', [m.id])).rejects.toThrow(/chk_addresses_manual_shape/);
    });
  });

  describe('MANUAL method — zone + written address, never coordinates', () => {
    it('saves with the area and the text; governorate and city follow the zone; no coordinates are stored', async () => {
      const c = await s.customer();
      const a = await savedManual(c);
      expect(a).toMatchObject({ mode: 'MANUAL', line1: 'شارع المنشية جنب الجامع', latitude: null, longitude: null, deliveryZoneId: zone.id, zoneStatus: 'OK' });
    });

    it('requires an active zone and the written address, and refuses coordinates', async () => {
      const c = await s.customer();
      expect((await save(c, { mode: 'MANUAL', line1: 'x' })).status).toBe(400); // zone required
      expect((await save(c, { mode: 'MANUAL', deliveryZoneId: zone.id })).status).toBe(400); // text required
      expect((await save(c, { mode: 'MANUAL', line1: '   ', deliveryZoneId: zone.id })).status).toBe(400);
      const withPin = await save(c, { mode: 'MANUAL', line1: 'x', deliveryZoneId: zone.id, ...home });
      expect(withPin.status).toBe(400);
      expect(withPin.body.error.details).toMatchObject({ code: 'INVALID_DELIVERY_ADDRESS', field: 'location' });
      expect(await list(c)).toEqual([]);
    });
  });

  describe('switching methods is explicit and clears what the other method does not use', () => {
    it('MANUAL → GPS drops the zone and the typed text; GPS → MANUAL drops the coordinates and needs a zone and text', async () => {
      const c = await s.customer();
      const m = await savedManual(c);
      const toGps = expectData<any>(await world.api('patch', `/addresses/${m.id}`, { token: c.accessToken, body: { mode: 'GPS', ...home } }));
      expect(toGps).toMatchObject({ mode: 'GPS', line1: '', deliveryZoneId: null, latitude: home.latitude });
      const bad = await world.api('patch', `/addresses/${m.id}`, { token: c.accessToken, body: { mode: 'MANUAL' } });
      expect(bad.status).toBe(400);
      const toManual = expectData<any>(await world.api('patch', `/addresses/${m.id}`, { token: c.accessToken, body: { mode: 'MANUAL', line1: 'شارع جديد', deliveryZoneId: zone.id } }));
      expect(toManual).toMatchObject({ mode: 'MANUAL', latitude: null, longitude: null, deliveryZoneId: zone.id, line1: 'شارع جديد' });
    });
  });

  describe('capabilities (what the app may offer)', () => {
    it('reports GPS available with Maps on and the Admin pricing set, and the manual method with an active zone', async () => {
      const c = await s.customer();
      expect(expectData<any>(await world.api('get', '/addresses/capabilities', { token: c.accessToken }))).toEqual({ manual: { available: true }, gps: { available: true, reason: null } });
      expect((await world.api('get', '/addresses/capabilities')).status).toBe(401);
    });
  });

  describe('ordinary delivery — final fee = base fee', () => {
    it('GPS: the base fee is the ROAD distance priced with the Admin rate and minimum (no zone fee anywhere)', async () => {
      const c = await s.customer();
      const a = await savedGps(c);
      await s.addToCart(c, product.id, 1);
      const q = await quote(c, { addressId: a.id, paymentMethod: 'COD' });
      expect(q.delivery).toMatchObject({ pricingSource: 'DISTANCE', deliveryZone: null });
      expect(q.delivery.distanceMeters).toBeGreaterThan(0);
      expect(q.delivery.feeMinor).toBe(baseFee(q.delivery.distanceMeters));
      expect(q.delivery.feeMinor).not.toBe(ZONE_FEE);
      expect(q.address.snapshot).toMatchObject({ mode: 'GPS', latitude: home.latitude });
    });

    it('MANUAL: the selected zone\'s fixed fee — no distance is measured', async () => {
      const c = await s.customer();
      const a = await savedManual(c);
      await s.addToCart(c, product.id, 1);
      const q = await quote(c, { addressId: a.id, paymentMethod: 'COD' });
      expect(q.delivery).toMatchObject({ pricingSource: 'DELIVERY_ZONE', feeMinor: ZONE_FEE, distanceMeters: null });
      expect(q.address.snapshot).toMatchObject({ mode: 'MANUAL', deliveryZoneId: zone.id });
    });

    it('an inline GPS address (no text, no zone) is accepted at checkout; outside coverage it is refused', async () => {
      const c = await s.customer();
      await s.addToCart(c, product.id, 1);
      const ok = await quote(c, { deliveryAddress: { mode: 'GPS', ...home }, paymentMethod: 'COD' });
      expect(ok.delivery.pricingSource).toBe('DISTANCE');
      const out = await quote(c, { deliveryAddress: { mode: 'GPS', ...farAway }, paymentMethod: 'COD' });
      expect(out.canPlaceOrder).toBe(false);
      expect(out.blockers.map((b: any) => b.code)).toContain('ADDRESS_OUT_OF_SERVICE_AREA');
    });

    it('a quote made for one method cannot place an order for the other (the method is part of the quote)', async () => {
      const c = await s.customer();
      const g = await savedGps(c);
      const m = await savedManual(c);
      await s.addToCart(c, product.id, 1);
      const body = await withQuoteToken(world, c.accessToken, { addressId: g.id, paymentMethod: 'COD' });
      const res = await world.api('post', '/orders', { token: c.accessToken, body: { ...body, addressId: m.id } });
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain('INPUTS_CHANGED');
    });
  });

  describe.each([
    ['Hatly (BUY_FROM_PLACE)', hatlyItem],
    ['Wasally (DELIVER_TO_PLACE)', wasallyItem],
  ])('%s — base fee by the customer\'s method, then × the multiplier, once', (_name, item) => {
    it('MANUAL: zone fee 20.00 × 1.5 = 30.00', async () => {
      const c = await adHocCustomer(item);
      const a = await savedManual(c);
      const q = await quote(c, { addressId: a.id, paymentMethod: 'COD' });
      expect(q.summary.deliveryFeeMinor).toBe(Math.round(ZONE_FEE * MULTIPLIER));
      expect(q.delivery).toMatchObject({ pricingSource: 'DELIVERY_ZONE', hatlyService: { baseFeeMinor: ZONE_FEE, multiplier: MULTIPLIER, pricingSource: 'DELIVERY_ZONE' } });
    });

    it('GPS: the road-distance base fee × 1.5 (the multiplier is NOT applied to the rate, and not omitted)', async () => {
      const c = await adHocCustomer(item);
      const a = await savedGps(c);
      const q = await quote(c, { addressId: a.id, paymentMethod: 'COD' });
      const hs = q.delivery.hatlyService;
      expect(hs).toMatchObject({ pricingSource: 'DISTANCE', multiplier: MULTIPLIER });
      expect(hs.distanceMeters).toBeGreaterThan(0);
      expect(hs.baseFeeMinor).toBe(baseFee(hs.distanceMeters)); // the ordinary GPS fee: max(minimum, distance ÷ 100 × rate)
      expect(q.summary.deliveryFeeMinor).toBe(Math.round(hs.baseFeeMinor * MULTIPLIER));
      expect(q.summary.deliveryFeeMinor).not.toBe(hs.baseFeeMinor);
      expect(q.canPlaceOrder).toBe(true);
    });

    it('the placed order freezes the method, base fee, multiplier, final fee, distance inputs and the address method', async () => {
      const c = await adHocCustomer(item);
      const a = await savedGps(c);
      const body = await withQuoteToken(world, c.accessToken, { addressId: a.id, paymentMethod: 'COD' });
      const placed = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body }), 201);
      const row = await orderRow(placed.id);
      const snap = row.delivery_fee_breakdown_snapshot;
      expect(snap).toMatchObject({ pricingSource: 'DISTANCE', addressMode: 'GPS', multiplierUsed: MULTIPLIER, pricePer100mMinorUsed: RATE, minimumDeliveryFeeMinorUsed: MINIMUM });
      expect(snap.baseFeeMinor).toBe(baseFee(snap.roundedDistanceMeters));
      expect(snap.chargeMinor).toBe(Math.round(snap.baseFeeMinor * MULTIPLIER));
      expect(Number(row.delivery_fee_minor)).toBe(snap.chargeMinor);
      expect(row.delivery_address_snapshot).toMatchObject({ mode: 'GPS', latitude: home.latitude, longitude: home.longitude });
      expect(row.delivery_address_snapshot.deliveryZoneId).toBeUndefined();
    });

    it('later changes to the rate, the minimum or the multiplier never change a placed order or its frozen breakdown', async () => {
      const c = await adHocCustomer(item);
      const a = await savedGps(c);
      const body = await withQuoteToken(world, c.accessToken, { addressId: a.id, paymentMethod: 'COD' });
      const placed = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body }), 201);
      const before = await orderRow(placed.id);
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 3);
      await s.configureDeliveryPricing({ per100mMinor: 5000, minimumMinor: 9000, additionalVendorMinor: 500 });
      try {
        const after = await orderRow(placed.id);
        expect(after.delivery_fee_breakdown_snapshot).toEqual(before.delivery_fee_breakdown_snapshot);
        expect(after.delivery_fee_minor).toEqual(before.delivery_fee_minor);
      } finally {
        await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', MULTIPLIER);
        await s.configureDeliveryPricing({ per100mMinor: RATE, minimumMinor: MINIMUM, additionalVendorMinor: 500 });
      }
    });
  });

  describe('GPS prices the ROUTE origin → destination (PD-012), never the customer\'s own address', () => {
    const distanceOf = async (item: Record<string, unknown>, address: Record<string, number>) => {
      const c = await adHocCustomer(item);
      const a = expectData<any>(await save(c, { mode: 'GPS', ...address }), 201);
      const q = await quote(c, { addressId: a.id, paymentMethod: 'COD' });
      return { distance: q.delivery.hatlyService.distanceMeters as number, route: q.delivery.route };
    };

    it('the same route gives the same distance whichever GPS address the customer has; a different route gives a different one', async () => {
      const here = await distanceOf(hatlyItem, home);
      const elsewhere = await distanceOf(hatlyItem, { latitude: 30.3, longitude: 31.4 }); // another GPS address in the service area
      expect(elsewhere.distance).toBe(here.distance);
      const longer = await distanceOf({ ...hatlyItem, destinationLatitude: 30.5, destinationLongitude: 31.7 }, home);
      expect(longer.distance).toBeGreaterThan(here.distance);
    });

    it('the quote shows the resolved route with direction preserved: Hatly place → chosen end; Wasally chosen start → place', async () => {
      const hatly = await distanceOf(hatlyItem, home);
      expect(hatly.route).toMatchObject({ origin: { latitude: PLACE.latitude, source: 'CUSTOMER' }, destination: { latitude: START.latitude, source: 'CUSTOMER' } });
      const wasally = await distanceOf(wasallyItem, home);
      expect(wasally.route).toMatchObject({ origin: { latitude: START.latitude, source: 'CUSTOMER' }, destination: { latitude: PLACE.latitude, source: 'CUSTOMER' } });
    });

    it('the frozen order records the exact route that was measured', async () => {
      const c = await adHocCustomer(hatlyItem);
      const a = await savedGps(c);
      const body = await withQuoteToken(world, c.accessToken, { addressId: a.id, paymentMethod: 'COD' });
      const placed = expectData<any>(await world.api('post', '/orders', { token: c.accessToken, body }), 201);
      const snap = (await orderRow(placed.id)).delivery_fee_breakdown_snapshot;
      expect(snap.routeOrigin).toEqual({ latitude: PLACE.latitude, longitude: PLACE.longitude });
      expect(snap.routeDestination).toEqual({ latitude: START.latitude, longitude: START.longitude });
      expect(snap.route.origin).toMatchObject({ latitude: PLACE.latitude, source: 'CUSTOMER' });
    });
  });

  describe('legacy addresses (no method) are untouched', () => {
    it('a legacy zone address still prices exactly as before: Hatly = zone fee × multiplier, with no method recorded', async () => {
      const c = await adHocCustomer(hatlyItem);
      const legacy = expectData<any>(await save(c, { line1: 'Legacy Street 1', deliveryZoneId: zone.id }), 201);
      expect(legacy.mode).toBeNull();
      const q = await quote(c, { addressId: legacy.id, paymentMethod: 'COD' });
      expect(q.summary.deliveryFeeMinor).toBe(Math.round(ZONE_FEE * MULTIPLIER));
      expect(q.address.snapshot.mode).toBeUndefined();
    });
  });
});
