/**
 * Hatly ("هاتلي من مكان") and Wasally ("وصّلي لمكان") ROUTE ENDPOINTS (PD-012), over real HTTP. Proves the real cart, real BusinessConfig and
 * real CheckoutPlannerService:
 *
 *  - every request has a route ORIGIN → DESTINATION; each end is the customer's choice, else the service's configured default (Admin
 *    Dashboard), else the request is refused with a clear code — the customer's home address is never silently substituted;
 *  - Hatly has its own origin + destination defaults, Wasally its own destination default and NO origin default (the customer always
 *    chooses where the pick-up happens); the two services never share a default;
 *  - the resolved route is shown in the quote, frozen on the order, and part of the quote fingerprint (a changed end makes a quote stale).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, withQuoteToken } from './support/actors';

describe('E2E — Hatly / Wasally route endpoints (PD-012)', () => {
  let world: World;
  let s: Scenario;
  let customer: Actor;
  // PD-009 (amended): Hatly / Wasally are priced and served by the address's ACTIVE zone (set in beforeAll); the pin only proves it plays
  // no part in a manual price.
  const address: Record<string, unknown> = { line1: 'Customer Home', latitude: 30.42, longitude: 31.56 };

  const HATLY_START = { latitude: 30.43, longitude: 31.57, label: 'Hatly demo start' };
  const HATLY_END = { latitude: 30.44, longitude: 31.58, label: 'Hatly demo destination' };
  const WASALLY_END = { latitude: 30.45, longitude: 31.59, label: 'Wasally demo destination' };

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    const area = await s.serviceArea({ radiusMeters: 50000 });
    address.deliveryZoneId = (await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1500 })).id;
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    customer = await s.customer('Hatly Service Route Customer');
  });
  afterAll(async () => {
    await world.close();
  });

  afterEach(async () => {
    // A cart may hold at most ONE AD_HOC_SERVICE group — clear whatever the previous test left behind.
    await world.api('delete', '/cart', { token: customer.accessToken });
  });

  // An unset default is cleared through the Admin DELETE (the settings store never holds null).
  const setDefaults = async (v: { start?: unknown; end?: unknown; wasally?: unknown }) => {
    const superAdmin = await s.superAdmin();
    const entries: Array<[string, unknown]> = [
      ['HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', v.start],
      ['HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION', v.end],
      ['WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION', v.wasally],
    ];
    for (const [key, value] of entries) {
      if (value === undefined) expectData(await world.api('delete', `/admin/business-config/${key}`, { token: superAdmin.accessToken }));
      else await s.setConfig(key, value);
    }
  };
  const addItem = (body: Record<string, unknown>) => world.api('post', '/cart/adhoc-items', { token: customer.accessToken, body });
  const hatly = (extra: Record<string, unknown> = {}) => ({ adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', freeTextDescription: 'Two boxes of tea', quantity: 1, ...extra });
  const wasally = (extra: Record<string, unknown> = {}) => ({ adHocPlaceName: "Mom's house", adHocServiceType: 'DELIVER_TO_PLACE', freeTextDescription: 'A forgotten key', quantity: 1, ...extra });
  const quote = () => world.api('post', '/checkout/quote', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } });
  const place = async () =>
    world.api('post', '/orders', { token: customer.accessToken, body: await withQuoteToken(world, customer.accessToken, { deliveryAddress: address, paymentMethod: 'COD' }) });

  describe('configured defaults (Admin Dashboard) and what the customer app can read', () => {
    it('nothing is invented: with no default configured, every default is null', async () => {
      await setDefaults({});
      const res = expectData<any>(await world.api('get', '/hatly-service/route-defaults', { token: customer.accessToken }));
      expect(res).toEqual({ hatly: { origin: null, destination: null }, wasally: { destination: null } });
    });

    it('configured defaults are returned per service — Hatly and Wasally are separate', async () => {
      await setDefaults({ start: HATLY_START, end: HATLY_END, wasally: WASALLY_END });
      const res = expectData<any>(await world.api('get', '/hatly-service/route-defaults', { token: customer.accessToken }));
      expect(res).toEqual({ hatly: { origin: HATLY_START, destination: HATLY_END }, wasally: { destination: WASALLY_END } });
    });

    it('is customer-only (no token → 401) and an Admin write is validated: a bad value is a 400, never stored', async () => {
      expect((await world.api('get', '/hatly-service/route-defaults')).status).toBe(401);
      const superAdmin = await s.superAdmin();
      for (const bad of [{ latitude: 30.4, longitude: 31.5 }, { latitude: 48.8, longitude: 2.3, label: 'Paris' }, 'Belbeis']) {
        const res = await world.api('put', '/admin/business-config/HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', { token: superAdmin.accessToken, body: { value: bad } });
        expect(res.status).toBe(400);
        expect(res.body.error.details.code).toBe('INVALID_BUSINESS_CONFIG_VALUE');
      }
      const nullValue = await world.api('put', '/admin/business-config/HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', { token: superAdmin.accessToken, body: { value: null } });
      expect(nullValue.status).toBe(400);
      await setDefaults({ start: HATLY_START });
      const res = expectData<any>(await world.api('get', '/hatly-service/route-defaults', { token: customer.accessToken }));
      expect(res.hatly.origin).toEqual(HATLY_START);
    });

    it('only a route default can be cleared (DELETE): clearing is idempotent and any other setting is refused', async () => {
      const superAdmin = await s.superAdmin();
      await setDefaults({ start: HATLY_START });
      const cleared = expectData<any>(await world.api('delete', '/admin/business-config/HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', { token: superAdmin.accessToken }));
      expect(cleared).toEqual({ key: 'HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', cleared: true });
      const again = expectData<any>(await world.api('delete', '/admin/business-config/HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', { token: superAdmin.accessToken }));
      expect(again.cleared).toBe(false);
      const refused = await world.api('delete', '/admin/business-config/HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', { token: superAdmin.accessToken });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details.code).toBe('BUSINESS_CONFIG_NOT_CLEARABLE');
      expect((await world.api('delete', '/admin/business-config/HATLY_SERVICE_DEFAULT_PICKUP_LOCATION', { token: customer.accessToken })).status).toBe(403);
    });
  });

  describe('Hatly (BUY_FROM_PLACE)', () => {
    beforeEach(async () => setDefaults({ start: HATLY_START, end: HATLY_END, wasally: WASALLY_END }));

    it('with no choice, the quote shows the configured Hatly defaults as the resolved route (origin → destination, labelled, source DEFAULT)', async () => {
      expectData(await addItem(hatly()), 201);
      const q = expectData<any>(await quote(), 201);
      expect(q.canPlaceOrder).toBe(true);
      expect(q.delivery.service).toBe('HATLY');
      expect(q.delivery.route).toEqual({
        origin: { ...HATLY_START, source: 'DEFAULT' },
        destination: { ...HATLY_END, source: 'DEFAULT' },
      });
      expect(q.summary.deliveryFeeMinor).toBe(2250); // zone fee 1500 × 1.5 — the route never changes a manual fee
    });

    it('the customer can change the origin and the destination independently', async () => {
      expectData(await addItem(hatly({ pickupLatitude: 30.3, pickupLongitude: 31.45, pickupLabel: 'My pharmacy' })), 201);
      let q = expectData<any>(await quote(), 201);
      expect(q.delivery.route).toEqual({
        origin: { latitude: 30.3, longitude: 31.45, label: 'My pharmacy', source: 'CUSTOMER' },
        destination: { ...HATLY_END, source: 'DEFAULT' },
      });

      expectData(await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { destination: { latitude: 30.2, longitude: 31.4, label: 'My shop' } } }));
      q = expectData<any>(await quote(), 201);
      expect(q.delivery.route).toEqual({
        origin: { latitude: 30.3, longitude: 31.45, label: 'My pharmacy', source: 'CUSTOMER' },
        destination: { latitude: 30.2, longitude: 31.4, label: 'My shop', source: 'CUSTOMER' },
      });

      // null clears an end back to the configured default; the other end is untouched.
      expectData(await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { origin: null } }));
      q = expectData<any>(await quote(), 201);
      expect(q.delivery.route.origin).toEqual({ ...HATLY_START, source: 'DEFAULT' });
      expect(q.delivery.route.destination).toMatchObject({ label: 'My shop', source: 'CUSTOMER' });
    });

    it('the customer\'s own address is NEVER silently used as an end — with no Hatly default it is a clear blocker, not a guess', async () => {
      await setDefaults({ start: HATLY_START }); // destination default missing
      expectData(await addItem(hatly()), 201);
      const q = expectData<any>(await quote(), 201);
      expect(q.canPlaceOrder).toBe(false);
      expect(q.blockers).toEqual([expect.objectContaining({ code: 'HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED' })]);
      expect(q.quoteToken).toBeNull();
      const placed = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } });
      expect(placed.status).toBe(400);
      expect(placed.body.error.details.code).toBe('HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED');

      await setDefaults({});
      const noOrigin = expectData<any>(await quote(), 201);
      expect(noOrigin.blockers).toEqual([expect.objectContaining({ code: 'HATLY_DEFAULT_PICKUP_NOT_CONFIGURED' })]);
    });

    it('placing it freezes the resolved route (coordinates, labels, sources) on the order; changing the default later never changes it', async () => {
      expectData(await addItem(hatly({ pickupLatitude: 30.3, pickupLongitude: 31.45, pickupLabel: 'My pharmacy' })), 201);
      const placed = expectData<any>(await place(), 201);
      await setDefaults({ start: { ...HATLY_START, latitude: 30.99 }, end: { ...HATLY_END, latitude: 30.98 } });
      const [row] = await world.ds.query('SELECT delivery_fee_breakdown_snapshot AS b FROM orders WHERE id = $1', [placed.id]);
      expect(row.b.service).toBe('HATLY');
      expect(row.b.route).toEqual({
        origin: { latitude: 30.3, longitude: 31.45, label: 'My pharmacy', source: 'CUSTOMER' },
        destination: { ...HATLY_END, source: 'DEFAULT' },
      });
      const [seg] = await world.ds.query('SELECT * FROM order_vendor_segments WHERE order_id = $1', [placed.id]);
      // The customer, the Admin Dashboard and (for the driver) the delivery view all read the SAME frozen route.
      const mine = expectData<any>(await world.api('get', `/orders/${placed.id}`, { token: customer.accessToken }));
      expect(mine.deliveryRoute).toEqual({ service: 'HATLY', origin: { latitude: 30.3, longitude: 31.45, label: 'My pharmacy', source: 'CUSTOMER' }, destination: { ...HATLY_END, source: 'DEFAULT' } });
      const superAdmin = await s.superAdmin();
      const adminView = expectData<any>(await world.api('get', `/admin/orders/${placed.id}`, { token: superAdmin.accessToken }));
      expect(adminView.segments[0].hatlyService.route).toEqual(mine.deliveryRoute);
      expect([Number(seg.ad_hoc_pickup_latitude_snapshot), Number(seg.ad_hoc_pickup_longitude_snapshot)]).toEqual([30.3, 31.45]);
      expect([Number(seg.ad_hoc_destination_latitude_snapshot), Number(seg.ad_hoc_destination_longitude_snapshot)]).toEqual([HATLY_END.latitude, HATLY_END.longitude]);
    });

    it('STALE QUOTE: changing an end — or the Admin default it fell back to — after quoting makes the old quote stale (409), nothing created', async () => {
      const countOrders = async () => (await world.ds.query('SELECT 1 FROM orders WHERE customer_id = $1', [customer.id])).length;
      const before = await countOrders();
      expectData(await addItem(hatly()), 201);
      const q = expectData<any>(await quote(), 201);
      expectData(await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { destination: { latitude: 30.2, longitude: 31.4, label: 'Elsewhere' } } }));
      const stale = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD', quoteToken: q.quoteToken } });
      expect(stale.status).toBe(409);
      expect(stale.body.error.details).toMatchObject({ code: 'QUOTE_STALE', reason: 'INPUTS_CHANGED' });

      // A fresh quote for the new route is honoured; then an Admin moving the default the OTHER end uses invalidates it again.
      const fresh = expectData<any>(await quote(), 201);
      await setDefaults({ start: { ...HATLY_START, latitude: 30.4 }, end: HATLY_END, wasally: WASALLY_END });
      const stale2 = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD', quoteToken: fresh.quoteToken } });
      expect(stale2.status).toBe(409);
      expect(stale2.body.error.details.code).toBe('QUOTE_STALE');
      expect(await countOrders()).toBe(before);
    });
  });

  describe('Wasally (DELIVER_TO_PLACE)', () => {
    beforeEach(async () => setDefaults({ start: HATLY_START, end: HATLY_END, wasally: WASALLY_END }));

    it('the ORIGIN is always the customer\'s — never defaulted, never assumed from home — even with every default configured', async () => {
      expectData(await addItem(wasally()), 201);
      const q = expectData<any>(await quote(), 201);
      expect(q.canPlaceOrder).toBe(false);
      expect(q.blockers).toEqual([expect.objectContaining({ code: 'DELIVER_TO_PLACE_ORIGIN_REQUIRED' })]);
      const placed = await world.api('post', '/orders', { token: customer.accessToken, body: { deliveryAddress: address, paymentMethod: 'COD' } });
      expect(placed.status).toBe(400);
      expect(placed.body.error.details.code).toBe('DELIVER_TO_PLACE_ORIGIN_REQUIRED');
    });

    it('a customer-chosen origin + no destination uses WASALLY\'s own default destination (not Hatly\'s); direction origin → destination', async () => {
      expectData(await addItem(wasally({ pickupLatitude: 30.35, pickupLongitude: 31.5, pickupLabel: 'Current location' })), 201);
      const q = expectData<any>(await quote(), 201);
      expect(q.canPlaceOrder).toBe(true);
      expect(q.delivery.service).toBe('WASALLY');
      expect(q.delivery.route).toEqual({
        origin: { latitude: 30.35, longitude: 31.5, label: 'Current location', source: 'CUSTOMER' },
        destination: { ...WASALLY_END, source: 'DEFAULT' },
      });
      expect(q.summary.deliveryFeeMinor).toBe(2250);
    });

    it('the customer can override the destination; origin and destination change independently', async () => {
      expectData(await addItem(wasally({ pickupLatitude: 30.35, pickupLongitude: 31.5, pickupLabel: 'Start' })), 201);
      expectData(await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { destination: { latitude: 30.55, longitude: 31.66, label: 'Mom\'s house' } } }));
      let q = expectData<any>(await quote(), 201);
      expect(q.delivery.route.destination).toEqual({ latitude: 30.55, longitude: 31.66, label: 'Mom\'s house', source: 'CUSTOMER' });
      expectData(await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { origin: { latitude: 30.36, longitude: 31.51, label: 'Another start' } } }));
      q = expectData<any>(await quote(), 201);
      expect(q.delivery.route).toEqual({
        origin: { latitude: 30.36, longitude: 31.51, label: 'Another start', source: 'CUSTOMER' },
        destination: { latitude: 30.55, longitude: 31.66, label: 'Mom\'s house', source: 'CUSTOMER' },
      });
    });

    it('with no Wasally default destination the request is refused — the Hatly default is NOT borrowed', async () => {
      await setDefaults({ start: HATLY_START, end: HATLY_END }); // Wasally default missing
      expectData(await addItem(wasally({ pickupLatitude: 30.35, pickupLongitude: 31.5 })), 201);
      const q = expectData<any>(await quote(), 201);
      expect(q.blockers).toEqual([expect.objectContaining({ code: 'WASALLY_DEFAULT_DESTINATION_NOT_CONFIGURED' })]);
    });

    it('placing it persists origin → destination in the segment slots and freezes the route; the order has no pending price', async () => {
      expectData(await addItem(wasally({ pickupLatitude: 30.35, pickupLongitude: 31.5, pickupLabel: 'Current location' })), 201);
      const placed = expectData<any>(await place(), 201);
      const [seg] = await world.ds.query('SELECT * FROM order_vendor_segments WHERE order_id = $1', [placed.id]);
      expect(seg.ad_hoc_service_type_snapshot).toBe('DELIVER_TO_PLACE');
      expect([Number(seg.ad_hoc_pickup_latitude_snapshot), Number(seg.ad_hoc_pickup_longitude_snapshot)]).toEqual([30.35, 31.5]);
      expect([Number(seg.ad_hoc_destination_latitude_snapshot), Number(seg.ad_hoc_destination_longitude_snapshot)]).toEqual([WASALLY_END.latitude, WASALLY_END.longitude]);
      const [row] = await world.ds.query('SELECT delivery_fee_breakdown_snapshot AS b, has_pending_ad_hoc_pricing AS p FROM orders WHERE id = $1', [placed.id]);
      expect(row.p).toBe(false);
      expect(row.b.service).toBe('WASALLY');
      expect(row.b.route.origin).toMatchObject({ label: 'Current location', source: 'CUSTOMER' });
      expect(row.b.route.destination).toMatchObject({ label: WASALLY_END.label, source: 'DEFAULT' });
    });
  });

  describe('route changes need a request in the cart', () => {
    it('PATCH /cart/adhoc-route with no Hatly / Wasally request is a 404; a bad coordinate is a 400', async () => {
      const none = await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { origin: null } });
      expect(none.status).toBe(404);
      expectData(await addItem(hatly({ pickupLatitude: 30.3, pickupLongitude: 31.45 })), 201);
      const bad = await world.api('patch', '/cart/adhoc-route', { token: customer.accessToken, body: { origin: { latitude: 123, longitude: 31.4 } } });
      expect(bad.status).toBe(400);
    });
  });
});
