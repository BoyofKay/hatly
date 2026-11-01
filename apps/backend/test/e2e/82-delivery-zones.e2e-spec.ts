/**
 * PD-009 — Delivery Zones, over real HTTP against real PostgreSQL: admin management and its permissions, pin-less saved
 * addresses, zone-based serviceability and pricing inside the EXISTING delivery formula, re-quoting when the zone (or its fee)
 * changes, frozen order snapshots, and Hatly Service = normal delivery fee × multiplier.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData, withQuoteToken } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — Delivery Zones (PD-009)', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let area: { id: string; lat: number; lng: number };
  let v1: VendorFixture;
  let v2: VendorFixture;
  let p1: { id: string };
  let p2: { id: string };
  let abuNaseeb: { id: string };
  let second: { id: string };

  const NON_GEOCODABLE = 'شارع أبو نصيب جنب جامع الكردي، منزل 15';
  const zonePath = (id = '') => `/admin/delivery-zones${id ? `/${id}` : ''}`;
  const zoneBody = (over: Record<string, unknown> = {}) => ({
    serviceAreaId: area.id,
    governorate: 'Sharqia',
    governorateAr: 'الشرقية',
    city: 'Belbeis',
    cityAr: 'بلبيس',
    name: `Z ${Math.random().toString(36).slice(2, 8)}`,
    nameAr: `م ${Math.random().toString(36).slice(2, 8)}`,
    deliveryFeeMinor: 1800,
    ...over,
  });
  const quote = async (c: Actor, body: Record<string, unknown>) => expectData<any>(await world.api('post', '/checkout/quote', { token: c.accessToken, body }), 201);
  const place = async (c: Actor, body: Record<string, unknown>) =>
    world.api('post', '/orders', { token: c.accessToken, body: 'quoteToken' in body ? body : await withQuoteToken(world, c.accessToken, body) });
  const details = async (c: Actor, id: string) => expectData<any>(await world.api('get', `/orders/${id}`, { token: c.accessToken }));
  const setFee = (id: string, deliveryFeeMinor: number) =>
    world.api('patch', `${zonePath(id)}/delivery-fee`, { token: superAdmin.accessToken, body: { deliveryFeeMinor } });
  const cartFor = async (products: Array<{ id: string }>) => {
    const c = await s.customer();
    for (const p of products) await s.addToCart(c, p.id, 1);
    return c;
  };
  const zoneAddress = async (c: Actor, zoneId: string) =>
    expectData<any>(await world.api('post', '/addresses', { token: c.accessToken, body: { line1: NON_GEOCODABLE, deliveryZoneId: zoneId, landmark: 'جنب جامع الكردي', floor: '2' } }), 201);

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing(); // 10 EGP / 100 m, 15 EGP minimum, 5 EGP additional vendor
    superAdmin = await s.superAdmin();
    area = await s.serviceArea({ radiusMeters: 50000 });
    v1 = await s.vendor({ name: 'DZ 1', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    v2 = await s.vendor({ name: 'DZ 2', serviceAreaId: area.id, lat: 30.431, lng: 31.571 });
    p1 = await s.product(v1, { priceMinor: 10000, inventoryMode: 'OPEN' });
    p2 = await s.product(v2, { priceMinor: 20000, inventoryMode: 'OPEN' });
    abuNaseeb = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ name: 'Abu Naseeb', nameAr: 'أبو نصيب', deliveryFeeMinor: 1800 }) }), 201);
    second = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ deliveryFeeMinor: 2600 }) }), 201);
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('admin management and authorization', () => {
    it('a customer, and an admin without MANAGE_SERVICE_AREAS, can neither list nor mutate zones', async () => {
      const c = await s.customer();
      const outsider = await s.admin([Permission.VIEW_ORDERS]);
      for (const actor of [c, outsider]) {
        expect((await world.api('get', zonePath(), { token: actor.accessToken })).status).toBe(403);
        expect((await world.api('post', zonePath(), { token: actor.accessToken, body: zoneBody() })).status).toBe(403);
        expect((await world.api('patch', zonePath(abuNaseeb.id), { token: actor.accessToken, body: { displayOrder: 9 } })).status).toBe(403);
        expect((await world.api('patch', `${zonePath(abuNaseeb.id)}/deactivate`, { token: actor.accessToken })).status).toBe(403);
        expect((await world.api('patch', `${zonePath(abuNaseeb.id)}/delivery-fee`, { token: actor.accessToken, body: { deliveryFeeMinor: 1 } })).status).toBe(403);
      }
    });

    it('MANAGE_SERVICE_AREAS alone manages structure but can NOT set a price; with MANAGE_DELIVERY_FEE_MULTIPLIER it can', async () => {
      const structure = await s.admin([Permission.MANAGE_SERVICE_AREAS]);
      expect((await world.api('get', zonePath(), { token: structure.accessToken })).status).toBe(200);
      const created = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody() }), 201);
      expectData(await world.api('patch', zonePath(created.id), { token: structure.accessToken, body: { displayOrder: 4, representativeLatitude: 30.41, representativeLongitude: 31.55 } }));
      expect((await world.api('patch', `${zonePath(created.id)}/delivery-fee`, { token: structure.accessToken, body: { deliveryFeeMinor: 999 } })).status).toBe(403);
      expect((await world.api('post', zonePath(), { token: structure.accessToken, body: zoneBody() })).status).toBe(403);

      const pricer = await s.admin([Permission.MANAGE_SERVICE_AREAS, Permission.MANAGE_DELIVERY_FEE_MULTIPLIER]);
      expect(expectData<any>(await world.api('patch', `${zonePath(created.id)}/delivery-fee`, { token: pricer.accessToken, body: { deliveryFeeMinor: 999 } })).deliveryFeeMinor).toBe(999);
      const removed = expectData<any>(await world.api('patch', zonePath(created.id), { token: structure.accessToken, body: { representativeLatitude: null, representativeLongitude: null } }));
      expect(removed).toMatchObject({ displayOrder: 4, representativeLatitude: null, representativeLongitude: null });
    });

    it('validation: unknown fields, a negative / fractional fee, half a point, a duplicate name, an unknown area are all refused (never a 500)', async () => {
      const bad = [
        zoneBody({ deliveryFeeMinor: -1 }),
        zoneBody({ deliveryFeeMinor: 12.5 }),
        zoneBody({ nameAr: '   ' }),
        zoneBody({ representativeLatitude: 30.4 }),
        zoneBody({ isActive: false }), // activation has its own endpoints
        zoneBody({ serviceAreaId: '00000000-0000-4000-8000-000000000000' }),
      ];
      for (const body of bad) expect((await world.api('post', zonePath(), { token: superAdmin.accessToken, body })).status).toBe(400);
      expect((await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ name: 'Abu Naseeb x', nameAr: 'أبو نصيب' }) })).status).toBe(409);
      expect((await world.api('patch', zonePath(abuNaseeb.id), { token: superAdmin.accessToken, body: { deliveryFeeMinor: 1 } })).status).toBe(400); // fee only via its endpoint
    });

    it('customers see only ACTIVE zones (names + base fee, no admin metadata)', async () => {
      const hidden = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody() }), 201);
      expectData(await world.api('patch', `${zonePath(hidden.id)}/deactivate`, { token: superAdmin.accessToken }));
      const c = await s.customer();
      const list = expectData<any[]>(await world.api('get', '/delivery-zones', { token: c.accessToken }));
      expect(list.map((z) => z.id)).toContain(abuNaseeb.id);
      expect(list.map((z) => z.id)).not.toContain(hidden.id);
      expect(Object.keys(list.find((z) => z.id === abuNaseeb.id)).sort()).toEqual(['city', 'cityAr', 'deliveryFeeMinor', 'governorate', 'governorateAr', 'id', 'name', 'nameAr']);
    });
  });

  describe('a pin-less, non-geocodable address is serviceable through its zone', () => {
    it('saves without coordinates; governorate/city follow the zone; an inactive or missing zone is refused', async () => {
      const c = await s.customer();
      const saved = await zoneAddress(c, abuNaseeb.id);
      expect(saved).toMatchObject({ line1: NON_GEOCODABLE, latitude: null, longitude: null, governorate: 'الشرقية', city: 'بلبيس', zoneStatus: 'OK', deliveryZone: { nameAr: 'أبو نصيب', cityAr: 'بلبيس' } });
      expect((await world.api('post', '/addresses', { token: c.accessToken, body: { line1: 'x' } })).status).toBe(400); // zone required
      expect((await world.api('post', '/addresses', { token: c.accessToken, body: { line1: 'x', deliveryZoneId: abuNaseeb.id, latitude: 30.4 } })).status).toBe(400); // half a pin
    });

    it('quote: priced by the ZONE fee (no distance), multi-vendor adds the unchanged additional-vendor fee, and the order freezes the zone', async () => {
      const c = await cartFor([p1, p2]);
      const saved = await zoneAddress(c, abuNaseeb.id);
      const q = await quote(c, { addressId: saved.id, paymentMethod: 'COD' });
      expect(q.canPlaceOrder).toBe(true);
      expect(q.delivery).toMatchObject({ pricingSource: 'DELIVERY_ZONE', baseFeeMinor: 1800, additionalVendorChargeMinor: 500, feeMinor: 2300, distanceMeters: null });
      expect(q.delivery.deliveryZone).toMatchObject({ id: abuNaseeb.id, nameAr: 'أبو نصيب', cityAr: 'بلبيس' });

      const order = expectData<any>(await place(c, { addressId: saved.id, paymentMethod: 'COD', quoteToken: q.quoteToken }), 201);
      expect(order.deliveryFeeMinor).toBe(2300);
      const row = (await world.ds.query('SELECT delivery_address_snapshot AS a, delivery_fee_breakdown_snapshot AS b FROM orders WHERE id = $1', [order.id]))[0];
      expect(row.a).toMatchObject({ line1: NON_GEOCODABLE, deliveryZoneId: abuNaseeb.id, deliveryZone: { nameAr: 'أبو نصيب', name: 'Abu Naseeb', cityAr: 'بلبيس', governorateAr: 'الشرقية' }, city: 'بلبيس', floor: '2' });
      expect(row.a.latitude).toBeUndefined();
      expect(row.b).toMatchObject({ pricingSource: 'DELIVERY_ZONE', deliveryZoneId: abuNaseeb.id, zoneDeliveryFeeMinorUsed: 1800, deliveryFeeMinor: 2300 });
      const d = await details(c, order.id);
      expect(d.deliveryBreakdown).toMatchObject({ pricingSource: 'DELIVERY_ZONE', distanceMeters: null, baseFeeMinor: 1800 });
    });

    it('changing the zone re-quotes with the new zone fee, and a quote for the OLD zone can no longer place an order', async () => {
      const c = await cartFor([p1]);
      const saved = await zoneAddress(c, abuNaseeb.id);
      const first = await quote(c, { addressId: saved.id, paymentMethod: 'COD' });
      expect(first.delivery.feeMinor).toBe(1800);
      expectData(await world.api('patch', `/addresses/${saved.id}`, { token: c.accessToken, body: { deliveryZoneId: second.id } }));
      const again = await quote(c, { addressId: saved.id, paymentMethod: 'COD' });
      expect(again.delivery.feeMinor).toBe(2600);
      const stale = await place(c, { addressId: saved.id, paymentMethod: 'COD', quoteToken: first.quoteToken });
      expect(stale.status).toBe(409);
      expect(stale.body.error.details.code).toBe('QUOTE_STALE');
    });

    it('an inactive zone is not serviceable (blocker, no fee, order refused); re-activating restores it', async () => {
      const zone = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ deliveryFeeMinor: 1700 }) }), 201);
      const c = await cartFor([p1]);
      const saved = await zoneAddress(c, zone.id);
      expectData(await world.api('patch', `${zonePath(zone.id)}/deactivate`, { token: superAdmin.accessToken }));
      const q = await quote(c, { addressId: saved.id, paymentMethod: 'COD' });
      expect(q.canPlaceOrder).toBe(false);
      expect(q.blockers.map((b: any) => b.code)).toContain('DELIVERY_ZONE_UNAVAILABLE');
      expect(q.delivery.feeMinor).toBeNull();
      const refused = await place(c, { addressId: saved.id, paymentMethod: 'COD' });
      expect(refused.status).toBe(400);
      const list = expectData<any[]>(await world.api('get', '/addresses', { token: c.accessToken }));
      expect(list.find((a) => a.id === saved.id)).toMatchObject({ zoneStatus: 'UNAVAILABLE', deliveryZoneId: zone.id });
      expectData(await world.api('patch', `${zonePath(zone.id)}/activate`, { token: superAdmin.accessToken }));
      expect((await quote(c, { addressId: saved.id, paymentMethod: 'COD' })).delivery.feeMinor).toBe(1700);
    });

    it('a legacy address with neither pin nor zone is never guessed into a zone: ADDRESS_ZONE_REQUIRED', async () => {
      const c = await cartFor([p1]);
      const q = await quote(c, { deliveryAddress: { line1: 'Legacy text only' }, paymentMethod: 'COD' });
      expect(q.blockers.map((b: any) => b.code)).toContain('ADDRESS_ZONE_REQUIRED');
    });

    it('a pin keeps the existing radius + distance pricing even when the address also has a zone', async () => {
      const c = await cartFor([p1]);
      const q = await quote(c, { deliveryAddress: { line1: 'Pinned', latitude: 30.425, longitude: 31.565, deliveryZoneId: abuNaseeb.id }, paymentMethod: 'COD' });
      expect(q.delivery.pricingSource).toBe('DISTANCE');
      expect(q.delivery.distanceMeters).toBeGreaterThan(0);
    });
  });

  describe('history is frozen', () => {
    it('renaming, re-pricing and deactivating the zone never changes an existing order; a new quote uses the new fee', async () => {
      const zone = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ name: 'History', nameAr: 'تاريخ', deliveryFeeMinor: 2000 }) }), 201);
      const c = await cartFor([p1]);
      const saved = await zoneAddress(c, zone.id);
      const order = expectData<any>(await place(c, { addressId: saved.id, paymentMethod: 'COD' }), 201);
      const before = await details(c, order.id);

      expectData(await setFee(zone.id, 3100));
      expectData(await world.api('patch', zonePath(zone.id), { token: superAdmin.accessToken, body: { nameAr: 'تاريخ جديد', name: 'History New' } }));
      const after = await details(c, order.id);
      expect(after.deliveryAddressSnapshot).toEqual(before.deliveryAddressSnapshot);
      expect(after.deliveryAddressSnapshot.deliveryZone.nameAr).toBe('تاريخ');
      expect(after).toMatchObject({ deliveryFeeMinor: 2000, totalMinor: before.totalMinor });

      const c2 = await cartFor([p1]);
      const saved2 = await zoneAddress(c2, zone.id);
      expect((await quote(c2, { addressId: saved2.id, paymentMethod: 'COD' })).delivery).toMatchObject({ feeMinor: 3100, deliveryZone: { nameAr: 'تاريخ جديد' } });

      expectData(await world.api('patch', `${zonePath(zone.id)}/deactivate`, { token: superAdmin.accessToken }));
      expect(await details(c, order.id)).toMatchObject({ deliveryFeeMinor: 2000, deliveryAddressSnapshot: before.deliveryAddressSnapshot });
    });
  });

  describe('Hatly Service — zone fee × multiplier (PD-009 amended)', () => {
    const buyItem = { adHocPlaceName: 'Corner Pharmacy', adHocServiceType: 'BUY_FROM_PLACE', pickupLatitude: 30.3, pickupLongitude: 31.45, destinationLatitude: 30.31, destinationLongitude: 31.46, freeTextDescription: 'Panadol', quantity: 1 };

    it('a pin-less zone address is NOT rejected for a missing pin: fee = zone fee × multiplier; a later multiplier change only affects new quotes', async () => {
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
      const c = await s.customer();
      expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: buyItem }), 201);
      const saved = await zoneAddress(c, abuNaseeb.id);
      const q = await quote(c, { addressId: saved.id, paymentMethod: 'COD' });
      expect(q.blockers).toEqual([]);
      expect(q.canPlaceOrder).toBe(true);
      expect(q.delivery).toMatchObject({ feeMinor: 2700, pricingSource: 'DELIVERY_ZONE', hatlyService: { zoneDeliveryFeeMinor: 1800, multiplier: 1.5 } });
      const order = expectData<any>(await place(c, { addressId: saved.id, paymentMethod: 'COD', quoteToken: q.quoteToken }), 201);
      expect(order.deliveryFeeMinor).toBe(2700);
      const b = (await world.ds.query('SELECT delivery_fee_breakdown_snapshot AS b FROM orders WHERE id = $1', [order.id]))[0].b;
      // The frozen breakdown also records the BASE fee (before the multiplier), the address method (null: a legacy address), the service and
      // the resolved route (PD-012).
      expect(b).toEqual({
        pricingSource: 'DELIVERY_ZONE', baseFeeMinor: 1800, addressMode: null, zoneDeliveryFeeMinorUsed: 1800, multiplierUsed: 1.5, chargeMinor: 2700, deliveryZoneId: abuNaseeb.id,
        service: 'HATLY',
        route: { origin: { latitude: 30.3, longitude: 31.45, label: null, source: 'CUSTOMER' }, destination: { latitude: 30.31, longitude: 31.46, label: null, source: 'CUSTOMER' } },
      });

      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 2);
      expect((await details(c, order.id)).deliveryFeeMinor).toBe(2700); // frozen
      const c2 = await s.customer();
      expectData(await world.api('post', '/cart/adhoc-items', { token: c2.accessToken, body: buyItem }), 201);
      const saved2 = await zoneAddress(c2, abuNaseeb.id);
      expect((await quote(c2, { addressId: saved2.id, paymentMethod: 'COD' })).delivery.feeMinor).toBe(3600);
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
    });

    const hatlyCart = async () => {
      const c = await s.customer();
      expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: buyItem }), 201);
      return c;
    };

    it('WITH a pin the fee is the SAME zone fee × multiplier as without one — distance never prices Hatly Service', async () => {
      const pinned = await quote(await hatlyCart(), { deliveryAddress: { line1: 'Pinned', latitude: 30.425, longitude: 31.565, deliveryZoneId: abuNaseeb.id }, paymentMethod: 'COD' });
      const pinless = await quote(await hatlyCart(), { deliveryAddress: { line1: 'No pin', deliveryZoneId: abuNaseeb.id }, paymentMethod: 'COD' });
      expect(pinned.delivery).toMatchObject({ feeMinor: 2700, pricingSource: 'DELIVERY_ZONE', distanceMeters: null, hatlyService: { zoneDeliveryFeeMinor: 1800, multiplier: 1.5 } });
      expect(pinned.delivery.feeMinor).toBe(pinless.delivery.feeMinor);
      // a pin far outside every service area changes nothing for Hatly Service (the zone is the boundary)
      const remotePin = await quote(await hatlyCart(), { deliveryAddress: { line1: 'Remote pin', latitude: 29.0, longitude: 30.0, deliveryZoneId: abuNaseeb.id }, paymentMethod: 'COD' });
      expect(remotePin.delivery.feeMinor).toBe(2700);
    });

    it('zone fee 25.00 × 1.5 = 37.50 (second zone)', async () => {
      const q = await quote(await hatlyCart(), { deliveryAddress: { line1: 'x', deliveryZoneId: second.id }, paymentMethod: 'COD' });
      expect(q.delivery).toMatchObject({ feeMinor: 3900, hatlyService: { zoneDeliveryFeeMinor: 2600, multiplier: 1.5 } });
      const z25 = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ deliveryFeeMinor: 2500 }) }), 201);
      const q25 = await quote(await hatlyCart(), { deliveryAddress: { line1: 'x', deliveryZoneId: z25.id }, paymentMethod: 'COD' });
      expect(q25.delivery.feeMinor).toBe(3750);
    });

    it('a pinned address WITHOUT a zone, an inactive zone, and no address at all are all refused — nothing is charged', async () => {
      const noZone = await quote(await hatlyCart(), { deliveryAddress: { line1: 'Pinned, no zone', latitude: 30.42, longitude: 31.56 }, paymentMethod: 'COD' });
      expect(noZone.canPlaceOrder).toBe(false);
      expect(noZone.blockers.map((x: any) => x.code)).toContain('ADDRESS_ZONE_REQUIRED');
      expect(noZone.delivery.feeMinor).toBeNull();

      const off = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody() }), 201);
      expectData(await world.api('patch', `${zonePath(off.id)}/deactivate`, { token: superAdmin.accessToken }));
      const c = await hatlyCart();
      const inactive = await quote(c, { deliveryAddress: { line1: 'x', deliveryZoneId: off.id }, paymentMethod: 'COD' });
      expect(inactive.blockers.map((x: any) => x.code)).toContain('DELIVERY_ZONE_UNAVAILABLE');
      const refused = await place(c, { deliveryAddress: { line1: 'x', deliveryZoneId: off.id }, paymentMethod: 'COD' });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
    });

    it('a quote becomes stale when the multiplier or the zone fee changes — the old quote cannot place the order', async () => {
      const z = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ deliveryFeeMinor: 1500 }) }), 201);
      const body = { deliveryAddress: { line1: 'x', deliveryZoneId: z.id }, paymentMethod: 'COD' };
      const c1 = await hatlyCart();
      const q1 = await quote(c1, body);
      expect(q1.delivery.feeMinor).toBe(2250);
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 2);
      const stale1 = await place(c1, { ...body, quoteToken: q1.quoteToken });
      expect(stale1.status).toBe(409);
      expect(stale1.body.error.details).toMatchObject({ code: 'QUOTE_STALE', reason: 'AMOUNTS_CHANGED' });
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);

      const c2 = await hatlyCart();
      const q2 = await quote(c2, body);
      expectData(await setFee(z.id, 2500));
      const stale2 = await place(c2, { ...body, quoteToken: q2.quoteToken });
      expect(stale2.status).toBe(409);
      expect(stale2.body.error.details).toMatchObject({ code: 'QUOTE_STALE', reason: 'INPUTS_CHANGED' });
      expect((await quote(c2, body)).delivery.feeMinor).toBe(3750);
    });

    it('a placed Hatly Service order is frozen: zone fee change, rename, deactivation and multiplier change never alter it', async () => {
      const z = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ name: 'Frozen HS', nameAr: 'خدمة مجمدة', deliveryFeeMinor: 1500 }) }), 201);
      const c = await hatlyCart();
      const order = expectData<any>(await place(c, { deliveryAddress: { line1: 'x', deliveryZoneId: z.id }, paymentMethod: 'COD' }), 201);
      expect(order.deliveryFeeMinor).toBe(2250);
      const before = await details(c, order.id);
      expectData(await setFee(z.id, 4000));
      expectData(await world.api('patch', zonePath(z.id), { token: superAdmin.accessToken, body: { nameAr: 'اسم جديد' } }));
      expectData(await world.api('patch', `${zonePath(z.id)}/deactivate`, { token: superAdmin.accessToken }));
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 3);
      const after = await details(c, order.id);
      await s.setConfig('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', 1.5);
      expect(after.deliveryFeeMinor).toBe(2250);
      expect(after.deliveryAddressSnapshot).toEqual(before.deliveryAddressSnapshot);
      expect(after.deliveryAddressSnapshot.deliveryZone.nameAr).toBe('خدمة مجمدة');
      const b = (await world.ds.query('SELECT delivery_fee_breakdown_snapshot AS b FROM orders WHERE id = $1', [order.id]))[0].b;
      expect(b).toMatchObject({ zoneDeliveryFeeMinorUsed: 1500, multiplierUsed: 1.5, chargeMinor: 2250 });
    });

    it('an invalid multiplier is refused by Business Config (400), so pricing never runs on it', async () => {
      for (const value of [0, -1, 'abc', 11]) {
        const res = await world.api('put', '/admin/business-config/HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', { token: superAdmin.accessToken, body: { value } });
        expect(res.status).toBe(400);
      }
    });
  });

  it('admin order detail exposes the frozen zone for operations', async () => {
    const c = await cartFor([p1]);
    const saved = await zoneAddress(c, abuNaseeb.id);
    const order = expectData<any>(await place(c, { addressId: saved.id, paymentMethod: 'COD' }), 201);
    const admin = expectData<any>(await world.api('get', `/admin/orders/${order.id}`, { token: superAdmin.accessToken }));
    expect(admin.deliveryAddress).toMatchObject({ line1: NON_GEOCODABLE, deliveryZone: { nameAr: 'أبو نصيب', cityAr: 'بلبيس' } });
  });
});
