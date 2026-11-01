/**
 * Customer addresses over real HTTP and real PostgreSQL: what a customer saves (typed text, or a GPS pin) is still there after signing in
 * again from another "device", with the same delivery zone, pin and default flag — and what cannot be saved is refused with a reason.
 *
 * Why this exists: a Closed-test report said a GPS location "worked for one checkout but did not stay in my saved addresses", and that
 * an address could not be saved by hand. The server was never at fault: an address is only ever stored by `POST /addresses`, which
 * REQUIRES an active delivery zone (PD-009). On Production there were no zones, so nothing could be saved at all. The first test pins
 * that cause; the rest pin that, once a zone exists, everything persists.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, expectData, DEFAULT_PASSWORD } from './support/actors';

describe('E2E — customer address persistence', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let zoneA: { id: string };
  let zoneB: { id: string };

  const zonePath = (id = '') => `/admin/delivery-zones${id ? `/${id}` : ''}`;
  const zoneBody = (over: Record<string, unknown>) => ({
    serviceAreaId: '',
    governorate: 'Sharqia',
    governorateAr: 'الشرقية',
    city: 'Belbeis',
    cityAr: 'بلبيس',
    name: 'Zone',
    nameAr: 'منطقة',
    deliveryFeeMinor: 1800,
    ...over,
  });
  /** Signs the same customer in again (a second device / a restarted app): a brand-new token, no memory of the first session. */
  const signInAgain = async (c: Actor): Promise<string> =>
    expectData<{ accessToken: string }>(await world.api('post', '/auth/customer/password/login', { body: { phone: c.phone, password: DEFAULT_PASSWORD } })).accessToken;
  const list = async (token: string) => expectData<any[]>(await world.api('get', '/addresses', { token }));
  const save = (token: string, body: Record<string, unknown>) => world.api('post', '/addresses', { token, body });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    superAdmin = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('PRODUCTION-LIKE STATE FIRST — with no delivery zone configured, the zone list is empty and NO address (typed or GPS) can be saved', async () => {
    const c = await s.customer();
    expect(expectData<any[]>(await world.api('get', '/delivery-zones', { token: c.accessToken }))).toEqual([]);
    const typed = await save(c.accessToken, { line1: 'شارع الجمهورية', deliveryZoneId: '00000000-0000-4000-8000-000000000000' });
    expect(typed.status).toBe(400);
    expect(typed.body.error.details.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
    const gps = await save(c.accessToken, { line1: 'مكاني الحالي', deliveryZoneId: '00000000-0000-4000-8000-000000000000', latitude: 30.4207, longitude: 31.5613 });
    expect(gps.status).toBe(400);
    expect(gps.body.error.details.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
    expect(await list(c.accessToken)).toEqual([]);
    // the zone is the ONLY thing missing: the operator creates it (admin) and the same customer can save immediately
    const area = await s.serviceArea({ radiusMeters: 50000 });
    zoneA = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ serviceAreaId: area.id, name: 'Abu Naseeb', nameAr: 'أبو نصيب' }) }), 201);
    zoneB = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ serviceAreaId: area.id, name: 'Second Area', nameAr: 'منطقة تانية', deliveryFeeMinor: 2600 }) }), 201);
    const zones = expectData<any[]>(await world.api('get', '/delivery-zones', { token: c.accessToken }));
    expect(zones.map((z) => z.id).sort()).toEqual([zoneA.id, zoneB.id].sort());
    expectData(await save(c.accessToken, { line1: 'شارع الجمهورية', deliveryZoneId: zoneA.id }), 201);
  });

  it('a typed address (no pin) persists across a fresh sign-in; governorate/city come from the zone, never from the client', async () => {
    const c = await s.customer();
    const created = expectData<any>(
      await save(c.accessToken, { line1: 'شارع أبو نصيب جنب جامع الكردي', deliveryZoneId: zoneA.id, floor: '3', landmark: 'جنب الجامع', instructions: 'الجرس مش شغال', governorate: 'FAKE', city: 'FAKE' }),
      201,
    );
    expect(created).toMatchObject({ latitude: null, longitude: null, governorate: 'الشرقية', city: 'بلبيس', zoneStatus: 'OK', deliveryZoneId: zoneA.id });

    const again = await list(await signInAgain(c));
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({
      id: created.id,
      line1: 'شارع أبو نصيب جنب جامع الكردي',
      floor: '3',
      landmark: 'جنب الجامع',
      instructions: 'الجرس مش شغال',
      latitude: null,
      longitude: null,
      governorate: 'الشرقية',
      city: 'بلبيس',
      zoneStatus: 'OK',
      deliveryZone: { id: zoneA.id, nameAr: 'أبو نصيب' },
    });
  });

  it('a GPS address persists with the EXACT pin, with no reverse-geocoded text needed (Maps deferred)', async () => {
    const c = await s.customer();
    const created = expectData<any>(await save(c.accessToken, { line1: 'قدام صيدلية النور', deliveryZoneId: zoneB.id, latitude: 30.4207, longitude: 31.5613 }), 201);
    expect(created).toMatchObject({ latitude: 30.4207, longitude: 31.5613 });
    const [restored] = await list(await signInAgain(c));
    expect(restored).toMatchObject({ id: created.id, latitude: 30.4207, longitude: 31.5613, deliveryZoneId: zoneB.id, zoneStatus: 'OK' });
  });

  it('default address: the first becomes the default; choosing another moves it (one default only), and that survives a fresh sign-in', async () => {
    const c = await s.customer();
    const first = expectData<any>(await save(c.accessToken, { line1: 'الأول', deliveryZoneId: zoneA.id }), 201);
    expect(first.isDefault).toBe(true);
    const second = expectData<any>(await save(c.accessToken, { line1: 'التاني', deliveryZoneId: zoneA.id }), 201);
    expect(second.isDefault).toBe(false);
    expectData(await world.api('patch', `/addresses/${second.id}`, { token: c.accessToken, body: { isDefault: true } }));

    const token = await signInAgain(c);
    const addresses = await list(token);
    expect(addresses.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);
    // a third address created WITH the default flag takes it over, again with exactly one default
    const third = expectData<any>(await save(token, { line1: 'التالت', deliveryZoneId: zoneB.id, isDefault: true }), 201);
    expect((await list(await signInAgain(c))).filter((a) => a.isDefault).map((a) => a.id)).toEqual([third.id]);
  });

  it('editing persists (zone, text, pin added then removed) and soft-deleting hides the address from every later session', async () => {
    const c = await s.customer();
    const a = expectData<any>(await save(c.accessToken, { line1: 'قبل التعديل', deliveryZoneId: zoneA.id }), 201);
    expectData(await world.api('patch', `/addresses/${a.id}`, { token: c.accessToken, body: { line1: 'بعد التعديل', deliveryZoneId: zoneB.id, latitude: 30.5, longitude: 31.6 } }));
    expect((await list(await signInAgain(c)))[0]).toMatchObject({ line1: 'بعد التعديل', deliveryZoneId: zoneB.id, latitude: 30.5, longitude: 31.6 });
    expectData(await world.api('patch', `/addresses/${a.id}`, { token: c.accessToken, body: { latitude: null, longitude: null } }));
    expect((await list(await signInAgain(c)))[0]).toMatchObject({ latitude: null, longitude: null });

    expectData(await world.api('delete', `/addresses/${a.id}`, { token: c.accessToken }));
    expect(await list(await signInAgain(c))).toEqual([]);
    // the row is deactivated, never destroyed (history keeps its snapshot)
    expect((await world.ds.query('SELECT is_active FROM addresses WHERE id = $1', [a.id]))[0].is_active).toBe(false);
  });

  it('addresses belong to their owner: another customer neither sees nor changes them', async () => {
    const owner = await s.customer();
    const other = await s.customer();
    const a = expectData<any>(await save(owner.accessToken, { line1: 'خاص', deliveryZoneId: zoneA.id }), 201);
    expect(await list(other.accessToken)).toEqual([]);
    expect((await world.api('patch', `/addresses/${a.id}`, { token: other.accessToken, body: { line1: 'مسروق' } })).status).toBe(404);
    expect((await world.api('delete', `/addresses/${a.id}`, { token: other.accessToken })).status).toBe(404);
    expect((await list(owner.accessToken))[0].line1).toBe('خاص');
  });

  it('what cannot be saved is refused with a reason, and nothing half-saved remains', async () => {
    const c = await s.customer();
    const before = (await list(c.accessToken)).length;
    expect((await save(c.accessToken, { deliveryZoneId: zoneA.id })).status).toBe(400); // text is required
    expect((await save(c.accessToken, { line1: '   ', deliveryZoneId: zoneA.id })).status).toBe(400); // not blank
    expect((await save(c.accessToken, { line1: 'x' })).status).toBe(400); // zone required
    const halfPin = await save(c.accessToken, { line1: 'x', deliveryZoneId: zoneA.id, latitude: 30.4 });
    expect(halfPin.status).toBe(400);
    expect(halfPin.body.error.details.code).toBe('INVALID_DELIVERY_ADDRESS');
    expect((await save(c.accessToken, { line1: 'x', deliveryZoneId: zoneA.id, latitude: 91, longitude: 31 })).status).toBe(400); // impossible latitude
    // a deactivated zone is no longer accepted, for new or edited addresses
    const hidden = expectData<any>(await world.api('post', zonePath(), { token: superAdmin.accessToken, body: zoneBody({ serviceAreaId: (await world.ds.query('SELECT service_area_id FROM delivery_zones LIMIT 1'))[0].service_area_id, name: 'Hidden', nameAr: 'مخفي' }) }), 201);
    expectData(await world.api('patch', `${zonePath(hidden.id)}/deactivate`, { token: superAdmin.accessToken }));
    const inactive = await save(c.accessToken, { line1: 'x', deliveryZoneId: hidden.id });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.details.code).toBe('DELIVERY_ZONE_UNAVAILABLE');
    expect((await list(c.accessToken)).length).toBe(before);
  });

  it('only customers have addresses: unauthenticated callers and staff are refused', async () => {
    expect((await world.api('get', '/addresses')).status).toBe(401);
    expect((await world.api('post', '/addresses', { body: { line1: 'x', deliveryZoneId: zoneA.id } })).status).toBe(401);
    expect((await world.api('get', '/addresses', { token: superAdmin.accessToken })).status).toBe(403);
  });
});
