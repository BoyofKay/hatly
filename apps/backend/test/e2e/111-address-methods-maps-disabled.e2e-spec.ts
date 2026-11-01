/**
 * The two address methods while Google Maps is DISABLED (`MAPS_PROVIDER=none`, the Production state until Maps is authorized):
 *
 *  - MANUAL keeps working and is priced by its zone's fixed fee — for ordinary delivery, Hatly and Wasally (× the multiplier).
 *  - GPS is reported UNAVAILABLE, clearly and everywhere — it can neither be saved nor priced, and it is NEVER silently priced by a
 *    zone fee (or by a straight-line distance) instead.
 *  - Legacy addresses (no method) keep the Maps-off behaviour approved in PD-009 G.
 */
import './support/maps-disabled-env';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { boundary } from './support/external-boundary';

describe('E2E — address methods with Maps disabled', () => {
  let world: World;
  let s: Scenario;
  let zone: { id: string; feeMinor: number };
  let vendor: VendorFixture;
  let product: { id: string };
  const home = { latitude: 30.425, longitude: 31.565 };
  const PLACE = { latitude: 30.3, longitude: 31.45 };
  const hatlyItem = { adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', pickupLatitude: PLACE.latitude, pickupLongitude: PLACE.longitude, destinationLatitude: 30.35, destinationLongitude: 31.5, freeTextDescription: 'Tea', quantity: 1 };
  const wasallyItem = { adHocPlaceName: "Mom's house", adHocServiceType: 'DELIVER_TO_PLACE', pickupLatitude: 30.35, pickupLongitude: 31.5, destinationLatitude: PLACE.latitude, destinationLongitude: PLACE.longitude, freeTextDescription: 'A key', quantity: 1 };

  const save = (c: Actor, body: Record<string, unknown>) => world.api('post', '/addresses', { token: c.accessToken, body });
  const quote = async (c: Actor, body: Record<string, unknown>) => expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body }), 201);
  async function adHocCustomer(item: Record<string, unknown>): Promise<Actor> {
    const c = await s.customer();
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: item }), 201);
    return c;
  }

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    await s.setConfig('MANUAL_TRANSFER_DESTINATION', { label: 'Hatly Wallet', phoneOrAccountNumber: '01000000000' });
    await s.setConfig('CUSTOMER_SERVICE_WHATSAPP_NUMBER', '+201000000000');
    const area = await s.serviceArea({ radiusMeters: 50000 });
    zone = await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 2000 });
    vendor = await s.vendor({ name: 'MD Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('capabilities: GPS is unavailable because Maps is disabled; the manual method is available', async () => {
    const c = await s.customer();
    expect(expectData<any>(await world.api('get', '/addresses/capabilities', { token: c.accessToken }))).toEqual({
      manual: { available: true },
      gps: { available: false, reason: 'MAPS_DISABLED' },
    });
  });

  it('a GPS address cannot be saved: a clear DISTANCE_PRICING_UNAVAILABLE, nothing stored, no zone substituted', async () => {
    const c = await s.customer();
    const res = await save(c, { mode: 'GPS', ...home });
    expect(res.status).toBe(400);
    expect(res.body.error.details.code).toBe('DISTANCE_PRICING_UNAVAILABLE');
    expect(expectData<any[]>(await world.api('get', '/addresses', { token: c.accessToken }))).toEqual([]);
  });

  it('a GPS address at checkout (inline) is reported unavailable — no fee, no zone fee, order refused', async () => {
    const c = await s.customer();
    await s.addToCart(c, product.id, 1);
    const q = await quote(c, { deliveryAddress: { mode: 'GPS', ...home }, paymentMethod: 'COD' });
    expect(q.canPlaceOrder).toBe(false);
    expect(q.blockers.map((b: any) => b.code)).toContain('DISTANCE_PRICING_UNAVAILABLE');
    expect(q.summary.deliveryFeeMinor).toBeNull();
    const order = await world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, { deliveryAddress: { mode: 'GPS', ...home }, paymentMethod: 'COD' }) });
    expect(order.status).toBe(400);
    expect(order.body.error.details.code).toBe('DISTANCE_PRICING_UNAVAILABLE');
  });

  it('Hatly and Wasally with a GPS address are unavailable too (never the zone fee, never a measured distance)', async () => {
    for (const item of [hatlyItem, wasallyItem]) {
      const c = await adHocCustomer(item);
      const q = await quote(c, { deliveryAddress: { mode: 'GPS', ...home }, paymentMethod: 'COD' });
      expect(q.canPlaceOrder).toBe(false);
      expect(q.blockers.map((b: any) => b.code)).toContain('DISTANCE_PRICING_UNAVAILABLE');
      expect(q.summary.deliveryFeeMinor).toBeNull();
    }
    expect(boundary.mapsCalls).toBe(0); // not one request reached Google
  });

  it('MANUAL keeps working: ordinary = the zone fee; Hatly and Wasally = zone fee × 1.5', async () => {
    const ordinary = await s.customer();
    const a = expectData<any>(await save(ordinary, { mode: 'MANUAL', line1: 'شارع المنشية', deliveryZoneId: zone.id }), 201);
    await s.addToCart(ordinary, product.id, 1);
    expect((await quote(ordinary, { addressId: a.id, paymentMethod: 'COD' })).summary.deliveryFeeMinor).toBe(2000);
    for (const item of [hatlyItem, wasallyItem]) {
      const c = await adHocCustomer(item);
      const m = expectData<any>(await save(c, { mode: 'MANUAL', line1: 'شارع المنشية', deliveryZoneId: zone.id }), 201);
      expect((await quote(c, { addressId: m.id, paymentMethod: 'COD' })).summary.deliveryFeeMinor).toBe(3000);
    }
  });

  it('a legacy pinned address keeps the Maps-off behaviour (zone-priced), unchanged by the new methods', async () => {
    const c = await s.customer();
    const legacy = expectData<any>(await save(c, { line1: 'Legacy', deliveryZoneId: zone.id, ...home }), 201);
    expect(legacy.mode).toBeNull();
    await s.addToCart(c, product.id, 1);
    expect((await quote(c, { addressId: legacy.id, paymentMethod: 'COD' })).delivery).toMatchObject({ pricingSource: 'DELIVERY_ZONE', feeMinor: 2000 });
  });
});
