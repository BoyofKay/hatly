/**
 * Vendor logo upload (`POST /admin/vendors/:id/logo`) over real HTTP and real PostgreSQL: only MANAGE_VENDORS may use it, the file goes
 * through the same boundary as every other image (JPEG/PNG/WebP, 5 MB, real image bytes), the vendor's `logoUrl` becomes the stable
 * `/uploads/files/...` reference, and a refused file leaves the previous logo untouched.
 */
import * as request from 'supertest';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { PNG_1X1_BASE64 } from '../../src/modules/uploads/image-test-fixtures';

describe('E2E — Vendor logo upload', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let vendorAdmin: Actor;
  let otherAdmin: Actor;
  let customer: Actor;
  let vendor: VendorFixture;

  const png = Buffer.from(PNG_1X1_BASE64, 'base64');
  const upload = (id: string, token = superAdmin.accessToken) =>
    request(world.baseUrl).post(`/api/v1/admin/vendors/${id}/logo`).set('Authorization', `Bearer ${token}`);
  const logoInDb = async () => (await world.ds.query('SELECT logo_url FROM vendors WHERE id = $1', [vendor.vendorId]))[0].logo_url;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    superAdmin = await s.superAdmin();
    vendorAdmin = await s.admin([Permission.MANAGE_VENDORS], 'Vendor Admin');
    otherAdmin = await s.admin([Permission.VIEW_ORDERS], 'Other Admin');
    customer = await s.customer();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Logo Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  it('only MANAGE_VENDORS (or SUPER_ADMIN) may upload a logo: other admins, vendor staff and customers are refused, anonymous is 401', async () => {
    for (const refused of [otherAdmin, vendor.manager, customer]) {
      expect((await upload(vendor.vendorId, refused.accessToken).attach('image', png, { filename: 'l.png', contentType: 'image/png' })).status).toBe(403);
    }
    expect((await request(world.baseUrl).post(`/api/v1/admin/vendors/${vendor.vendorId}/logo`).attach('image', png, { filename: 'l.png', contentType: 'image/png' })).status).toBe(401);
    expect(await logoInDb()).toBeNull();
  });

  it('a valid image becomes the vendor logo: stable upload reference, returned by the vendor API, served by the API host', async () => {
    const res = expectData<any>(await upload(vendor.vendorId, vendorAdmin.accessToken).attach('image', png, { filename: 'whatever-the-client-calls-it.exe', contentType: 'image/png' }), 201);
    expect(res.id).toBe(vendor.vendorId);
    expect(res.logoUrl).toMatch(/^\/uploads\/files\/[0-9a-f-]+\.png$/);
    expect(res.logoUrl).not.toMatch(/https?:|X-Amz|Signature|token/i);
    expect(await logoInDb()).toBe(res.logoUrl);
    const fetched = expectData<any>(await world.api('get', `/admin/vendors/${vendor.vendorId}`, { token: superAdmin.accessToken }));
    expect(fetched.logoUrl).toBe(res.logoUrl);
    const served = await request(world.baseUrl).get(res.logoUrl);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/image\/png/);
  });

  it('a refused file changes nothing: wrong type, fake image bytes, oversize, no file, unknown vendor', async () => {
    const before = await logoInDb();
    expect(before).not.toBeNull();
    expect((await upload(vendor.vendorId).attach('image', Buffer.from('not an image'), { filename: 'x.png', contentType: 'text/plain' })).status).toBe(400);
    expect((await upload(vendor.vendorId).attach('image', Buffer.from('<html>pretending</html>'), { filename: 'x.png', contentType: 'image/png' })).status).toBe(400);
    expect((await upload(vendor.vendorId).attach('image', Buffer.alloc(5 * 1024 * 1024 + 1024, 1), { filename: 'x.png', contentType: 'image/png' })).status).toBeGreaterThanOrEqual(400);
    expect((await upload(vendor.vendorId)).status).toBe(400);
    expect((await upload('00000000-0000-4000-8000-000000000000').attach('image', png, { filename: 'l.png', contentType: 'image/png' })).status).toBe(404);
    expect((await upload('not-a-uuid').attach('image', png, { filename: 'l.png', contentType: 'image/png' })).status).toBe(400);
    expect(await logoInDb()).toBe(before);
  });

  it('uploading again replaces the logo; the vendor is otherwise unchanged (same name)', async () => {
    const first = await logoInDb();
    const res = expectData<any>(await upload(vendor.vendorId).attach('image', png, { filename: 'l.png', contentType: 'image/png' }), 201);
    expect(res.logoUrl).not.toBe(first);
    expect(res).toMatchObject({ name: 'Logo Vendor' });
  });
});
