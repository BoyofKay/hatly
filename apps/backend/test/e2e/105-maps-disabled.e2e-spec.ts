/**
 * PD-009 G — Maps deferred (`MAPS_PROVIDER=none`, no Google key), over real HTTP against real PostgreSQL: the app boots, every
 * delivery address is priced and bounded by its ACTIVE Delivery Zone (pin or not), quote = order fee incl. the additional-vendor
 * fee and the frozen breakdown, automatic dispatch ranks by straight-line distance, address search answers "nothing", and not one
 * request ever reaches Google.
 */
import './support/maps-disabled-env';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { boundary } from './support/external-boundary';
import { Logger } from '@nestjs/common';
import { MAP_PROVIDER } from '../../src/modules/location/map-provider.interface';
import { UnavailableMapProvider } from '../../src/modules/location/providers/unavailable-map.provider';

describe('E2E — Maps disabled (PD-009 G)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  let zone: { id: string; feeMinor: number };
  const pin = { latitude: 30.425, longitude: 31.565 }; // a real GPS-style pin near the vendors

  const quote = async (c: Actor, body: Record<string, unknown>) => world.api('post', '/checkout/quote', { token: c.accessToken, body });
  const place = async (c: Actor, body: Record<string, unknown>) =>
    world.api('post', '/orders', { token: c.accessToken, body: await withQuoteToken(world, c.accessToken, body) });
  const cartFor = async (products: Array<{ id: string }>) => {
    const c = await s.customer();
    for (const p of products) await s.addToCart(c, p.id, 1);
    return c;
  };
  const CODE = (r: { body: any }) => r.body?.error?.details?.code ?? r.body?.error?.code;

  // The provider factory runs while the module compiles — before bootWorld attaches its capturing logger — so the startup warning is
  // observed at the Logger itself.
  const warnSpy = jest.spyOn(Logger.prototype, 'warn');
  const orderFee = async (orderId: string) =>
    (await world.ds.query('SELECT delivery_fee_minor AS fee, delivery_fee_breakdown_snapshot AS b, delivery_address_snapshot AS a FROM orders WHERE id = $1', [orderId]))[0];

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing(); // additional vendor fee 5 EGP
    area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'MD 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'MD 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    zone = await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 1800, name: 'Abu Naseeb', nameAr: 'أبو نصيب' });
  });
  beforeEach(() => boundary.reset());
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('boots without a Google key: the Maps-disabled provider is the one in use, and startup says so', () => {
    expect(process.env.GOOGLE_MAPS_API_KEY || undefined).toBeUndefined(); // unset or empty = no key
    expect(world.app.get(MAP_PROVIDER)).toBeInstanceOf(UnavailableMapProvider);
    expect(warnSpy.mock.calls.some(([m]) => /Maps DISABLED \(MAPS_PROVIDER=none\)/.test(String(m)))).toBe(true);
  });

  it('a PINNED saved address is priced by its zone; quote fee = frozen order fee; breakdown frozen as DELIVERY_ZONE; no Maps call', async () => {
    const c = await cartFor([p1]);
    const addr = await s.address(c, { lat: pin.latitude, lng: pin.longitude, zoneId: zone.id });
    const q = expectData<any>(await quote(c, { addressId: addr.id, paymentMethod: 'COD' }), 201);
    expect(q.canPlaceOrder).toBe(true);
    expect(q.delivery).toMatchObject({ pricingSource: 'DELIVERY_ZONE', feeMinor: 1800, baseFeeMinor: 1800, additionalVendorChargeMinor: 0, distanceMeters: null });
    expect(q.delivery.deliveryZone).toMatchObject({ id: zone.id });
    expect(q.summary.deliveryFeeMinor).toBe(q.delivery.feeMinor);
    const order = expectData<any>(await place(c, { addressId: addr.id, paymentMethod: 'COD' }), 201);
    const row = await orderFee(order.id);
    expect(Number(row.fee)).toBe(q.delivery.feeMinor);
    expect(row.b).toMatchObject({ pricingSource: 'DELIVERY_ZONE', deliveryZoneId: zone.id, zoneDeliveryFeeMinorUsed: 1800, deliveryFeeMinor: 1800, rawTotalDistanceMeters: null });
    expect(row.a).toMatchObject({ latitude: pin.latitude, longitude: pin.longitude, deliveryZoneId: zone.id }); // the pin stays for the driver
    expect(boundary.mapsCalls).toBe(0);
  });

  it('two vendors: zone fee + the additional-vendor fee, identical in quote and frozen order', async () => {
    const c = await cartFor([p1, p2]);
    const addr = await s.address(c, { lat: pin.latitude, lng: pin.longitude, zoneId: zone.id });
    const q = expectData<any>(await quote(c, { addressId: addr.id, paymentMethod: 'COD' }), 201);
    expect(q.delivery).toMatchObject({ pricingSource: 'DELIVERY_ZONE', baseFeeMinor: 1800, additionalVendorFeeMinor: 500, additionalVendorChargeMinor: 500, feeMinor: 2300, vendorCount: 2 });
    const order = expectData<any>(await place(c, { addressId: addr.id, paymentMethod: 'COD' }), 201);
    const row = await orderFee(order.id);
    expect(Number(row.fee)).toBe(q.delivery.feeMinor);
    expect(row.b).toMatchObject({ pricingSource: 'DELIVERY_ZONE', additionalVendorChargeMinor: 500, deliveryFeeMinor: 2300 });
    expect(boundary.mapsCalls).toBe(0);
  });

  it('a pinned address WITHOUT a zone is refused (ADDRESS_ZONE_REQUIRED) — never priced by a distance that was not measured', async () => {
    const c = await cartFor([p1]);
    const r = await world.api('post', '/orders', {
      token: c.accessToken,
      body: { deliveryAddress: { line1: 'Pinned, no zone', ...pin }, paymentMethod: 'COD', quoteToken: 'x' },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    const q = expectData<any>(await quote(c, { deliveryAddress: { line1: 'Pinned, no zone', ...pin }, paymentMethod: 'COD' }), 201);
    expect(JSON.stringify(q.blockers ?? q)).toMatch(/ADDRESS_ZONE_REQUIRED/);
    expect(boundary.mapsCalls).toBe(0);
  });

  it('an inactive zone blocks checkout (DELIVERY_ZONE_UNAVAILABLE)', async () => {
    const closed = await s.deliveryZone({ serviceAreaId: area.id, feeMinor: 2200 });
    const c = await cartFor([p1]);
    const addr = await s.address(c, { lat: pin.latitude, lng: pin.longitude, zoneId: closed.id });
    const superAdmin = await s.superAdmin();
    expectData(await world.api('patch', `/admin/delivery-zones/${closed.id}/deactivate`, { token: superAdmin.accessToken }));
    const q = expectData<any>(await quote(c, { addressId: addr.id, paymentMethod: 'COD' }), 201);
    expect(JSON.stringify(q.blockers ?? q)).toMatch(/DELIVERY_ZONE_UNAVAILABLE/);
  });

  it('automatic dispatch assigns the NEAREST driver by straight-line distance — without any Maps call', async () => {
    await world.ds.query('UPDATE drivers SET is_online = false, is_available = false');
    const far = await s.driver({ lat: 30.4212, lng: 31.6112 });
    const near = await s.driver({ lat: 30.4212, lng: 31.5612 });
    const c = await cartFor([p1]);
    const addr = await s.address(c, { zoneId: zone.id }); // pin-less: dispatch ranks from the pickup point, not the customer
    const order = expectData<any>(await place(c, { addressId: addr.id, paymentMethod: 'COD' }), 201);
    boundary.reset();
    await s.vendorPrepares(v1, order.id);
    const [d] = await world.ds.query('SELECT driver_id FROM deliveries WHERE order_id = $1', [order.id]);
    expect(d?.driver_id).toBe(near.driverId);
    expect(d?.driver_id).not.toBe(far.driverId);
    expect(boundary.mapsCalls).toBe(0);
    expect(world.logs.some((l) => /dispatch ranking basis=STRAIGHT_LINE/.test(l.message))).toBe(true);
  });

  it('address search / reverse suggestions answer "nothing" (no 5xx, no Google request)', async () => {
    const c = await s.customer();
    const search = await world.api('get', '/geo/search', { token: c.accessToken, query: { q: 'بلبيس' } });
    const reverse = await world.api('get', '/geo/reverse', { token: c.accessToken, query: { latitude: pin.latitude, longitude: pin.longitude } });
    expect([search.status, search.body.data]).toEqual([200, null]);
    expect([reverse.status, reverse.body.data]).toEqual([200, { formattedAddress: null }]);
    expect(boundary.mapsCalls).toBe(0);
  });
});
