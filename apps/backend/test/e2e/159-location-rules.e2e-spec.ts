/**
 * Owner UAT 2026-11-27 (ML-01, ML-03): a store branch's location and every place a customer chooses for Hatly / Wasaly must be inside
 * the area Hatly serves, and the two ends of a route cannot be the same place. The app can check a point first and see the areas.
 */
import { bootWorld, World } from './support/world';
import { Scenario, expectData } from './support/actors';

describe('E2E — location rules (service area, same place)', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  const inside = { lat: 30.42, lng: 31.56 };
  const inside2 = { lat: 30.43, lng: 31.57 };
  const outside = { lat: 31.2, lng: 29.9 }; // Alexandria — far outside the 20 km area

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    area = await s.serviceArea({ radiusMeters: 20000 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('a branch cannot be created or moved outside its service area', async () => {
    const admin = await s.superAdmin();
    const vendor = expectData<any>(await world.api('post', '/admin/vendors', { token: admin.accessToken, body: { name: 'Geo Vendor' } }), 201);
    const create = (lat: number, lng: number) =>
      world.api('post', '/admin/vendor-branches', { token: admin.accessToken, body: { vendorId: vendor.id, name: 'Geo Branch', address: 'x', latitude: lat, longitude: lng, serviceAreaId: area.id } });
    const bad = await create(outside.lat, outside.lng);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('BRANCH_OUTSIDE_SERVICE_AREA');
    const branch = expectData<any>(await create(inside.lat, inside.lng), 201);
    const move = await world.api('patch', `/admin/vendor-branches/${branch.id}`, { token: admin.accessToken, body: { latitude: outside.lat, longitude: outside.lng } });
    expect(move.status).toBe(400);
    expect(JSON.stringify(move.body)).toContain('BRANCH_OUTSIDE_SERVICE_AREA');
    expect((await world.api('patch', `/admin/vendor-branches/${branch.id}`, { token: admin.accessToken, body: { latitude: inside2.lat, longitude: inside2.lng } })).status).toBe(200);
  });

  const request = (pickup: { lat: number; lng: number } | null, destination: { lat: number; lng: number } | null) => ({
    adHocPlaceName: 'Pharmacy',
    adHocServiceType: 'DELIVER_TO_PLACE',
    ...(pickup ? { pickupLatitude: pickup.lat, pickupLongitude: pickup.lng } : {}),
    ...(destination ? { destinationLatitude: destination.lat, destinationLongitude: destination.lng } : {}),
    freeTextDescription: 'A parcel',
    quantity: 1,
  });

  it('Hatly / Wasaly: a chosen place outside the service area is refused; the same place twice is refused', async () => {
    const c = await s.customer('Route Rules');
    const out = await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: request(outside, inside) });
    expect(out.status).toBe(400);
    expect(JSON.stringify(out.body)).toContain('ROUTE_POINT_OUTSIDE_SERVICE_AREA');
    const same = await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: request(inside, { lat: inside.lat + 0.0001, lng: inside.lng }) });
    expect(same.status).toBe(400);
    expect(JSON.stringify(same.body)).toContain('ROUTE_SAME_POINT');
    expectData(await world.api('post', '/cart/adhoc-items', { token: c.accessToken, body: request(inside, inside2) }), 201);
    const moveOut = await world.api('patch', '/cart/adhoc-route', { token: c.accessToken, body: { destination: { latitude: outside.lat, longitude: outside.lng, label: 'Far' } } });
    expect(moveOut.status).toBe(400);
    expect(JSON.stringify(moveOut.body)).toContain('ROUTE_POINT_OUTSIDE_SERVICE_AREA');
    const moveSame = await world.api('patch', '/cart/adhoc-route', { token: c.accessToken, body: { destination: { latitude: inside.lat, longitude: inside.lng, label: 'Same' } } });
    expect(moveSame.status).toBe(400);
    expect(JSON.stringify(moveSame.body)).toContain('ROUTE_SAME_POINT');
  });

  it('the app can check a point and read the served areas', async () => {
    const c = await s.customer('Geo Reader');
    expect(expectData<any>(await world.api('get', '/geo/serviceable', { token: c.accessToken, query: { latitude: inside.lat, longitude: inside.lng } }))).toMatchObject({ serviceable: true });
    expect(expectData<any>(await world.api('get', '/geo/serviceable', { token: c.accessToken, query: { latitude: outside.lat, longitude: outside.lng } }))).toMatchObject({ serviceable: false });
    const areas = expectData<any[]>(await world.api('get', '/geo/service-areas', { token: c.accessToken }));
    expect(areas.find((a) => a.id === area.id)).toMatchObject({ radiusMeters: 20000 });
  });
});
