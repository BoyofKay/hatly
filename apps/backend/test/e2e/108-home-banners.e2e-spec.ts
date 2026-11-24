/**
 * Admin-managed Home banners over real HTTP and real PostgreSQL: who may manage them, the draft → image → publish path, what a customer's
 * phone may receive (only banners eligible RIGHT NOW, in the admin's order, with nothing administrative in the payload), scheduling, dead
 * destinations, and the database-level guards behind the service rules.
 */
import * as request from 'supertest';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';
import { PNG_1X1_BASE64, pngOf } from '../../src/modules/uploads/image-test-fixtures';

describe('E2E — Home banners', () => {
  let world: World;
  let s: Scenario;
  let superAdmin: Actor;
  let bannerAdmin: Actor;
  let otherAdmin: Actor;
  let customer: Actor;
  let vendor: VendorFixture;
  let product: { id: string };
  let sector: { id: string };

  // Square promotion artwork (1080×1080 recommended); the 1×1 pixel is kept for the shape-refusal test.
  const png = pngOf(1080, 1080);
  const tinyPng = Buffer.from(PNG_1X1_BASE64, 'base64');
  const admin = (token = superAdmin.accessToken) => ({ token });
  const create = async (body: Record<string, unknown>, token = superAdmin.accessToken) => expectData<any>(await world.api('post', '/admin/home-banners', { token, body }), 201);
  const upload = (id: string, token = superAdmin.accessToken) =>
    request(world.baseUrl).post(`/api/v1/admin/home-banners/${id}/image`).set('Authorization', `Bearer ${token}`);
  const withImage = async (id: string) => expectData<any>(await upload(id).attach('image', png, { filename: 'b.png', contentType: 'image/png' }), 201);
  const publish = async (body: Record<string, unknown>) => {
    const b = await create(body);
    await withImage(b.id);
    return expectData<any>(await world.api('patch', `/admin/home-banners/${b.id}/activate`, admin()));
  };
  const publicList = async () => expectData<any[]>(await world.api('get', '/home-banners'));
  const clean = async () => world.ds.query('DELETE FROM home_banners');

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    superAdmin = await s.superAdmin();
    bannerAdmin = await s.admin([Permission.MANAGE_HOME_BANNERS], 'Banner Admin');
    otherAdmin = await s.admin([Permission.VIEW_ORDERS], 'Other Admin');
    customer = await s.customer();
    const area = await s.serviceArea({ radiusMeters: 50000 });
    vendor = await s.vendor({ name: 'Banner Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    product = await s.product(vendor, { priceMinor: 10000, inventoryMode: 'OPEN' });
    sector = expectData<any>(await world.api('post', '/admin/sectors', { token: superAdmin.accessToken, body: { name: 'Banner Sector', slug: 'banner-sector' } }), 201);
  });
  afterEach(clean);
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('who may manage banners', () => {
    it('only MANAGE_HOME_BANNERS (or SUPER_ADMIN): customers, vendors and other admins are refused on EVERY admin route; anonymous is 401', async () => {
      const b = await create({ title: 'Guarded' });
      const routes: Array<[Parameters<World['api']>[0], string, Record<string, unknown>?]> = [
        ['get', '/admin/home-banners'],
        ['get', `/admin/home-banners/${b.id}`],
        ['post', '/admin/home-banners', { title: 'x' }],
        ['patch', `/admin/home-banners/${b.id}`, { title: 'y' }],
        ['patch', `/admin/home-banners/${b.id}/activate`],
        ['patch', `/admin/home-banners/${b.id}/deactivate`],
        ['delete', `/admin/home-banners/${b.id}`],
      ];
      for (const [method, path, body] of routes) {
        expect((await world.api(method, path, { body })).status).toBe(401);
        for (const refused of [customer, vendor.manager, otherAdmin]) {
          expect({ path, who: refused.role, status: (await world.api(method, path, { token: refused.accessToken, body })).status }).toEqual({ path, who: refused.role, status: 403 });
        }
      }
      for (const refused of [customer, vendor.manager, otherAdmin]) {
        expect((await upload(b.id, refused.accessToken).attach('image', png, { filename: 'b.png', contentType: 'image/png' })).status).toBe(403);
      }
      expect((await world.api('get', '/admin/home-banners', { token: bannerAdmin.accessToken })).status).toBe(200);
      expect((await world.api('patch', `/admin/home-banners/${b.id}`, { token: bannerAdmin.accessToken, body: { title: 'Renamed' } })).status).toBe(200);
      // nothing was changed by the refused calls
      expect((await world.ds.query('SELECT title FROM home_banners WHERE id = $1', [b.id]))[0].title).toBe('Renamed');
    });

    it('the customer list is public (no account needed)', async () => {
      expect((await world.api('get', '/home-banners')).status).toBe(200);
    });
  });

  describe('draft → image → publish', () => {
    it('a new banner is a DRAFT: inactive, no image, never shown to customers', async () => {
      const b = await create({ title: 'Ramadan offers', titleAr: 'عروض رمضان', sortOrder: 2 });
      expect(b).toMatchObject({ title: 'Ramadan offers', titleAr: 'عروض رمضان', isActive: false, imageUrl: null, actionType: 'NONE', actionTargetId: null, displayStatus: 'DRAFT' });
      expect(await publicList()).toEqual([]);
    });

    it('cannot be published without an image (service rule AND database CHECK)', async () => {
      const b = await create({ title: 'No image yet' });
      const res = await world.api('patch', `/admin/home-banners/${b.id}/activate`, admin());
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('BANNER_IMAGE_REQUIRED');
      await expect(world.ds.query('UPDATE home_banners SET is_active = true WHERE id = $1', [b.id])).rejects.toThrow(/chk_home_banners_active_has_image/);
    });

    it('image quality floor is enforced, square and legacy wide uploads are accepted', async () => {
      const b = await create({ title: 'Shape' });
      const small = await upload(b.id).attach('image', tinyPng, { filename: 'x.png', contentType: 'image/png' });
      expect(small.status).toBe(400);
      expect(small.body.error.details.code).toBe('BANNER_IMAGE_TOO_SMALL');
      expect(expectData<any>(await world.api('get', `/admin/home-banners/${b.id}`, { token: superAdmin.accessToken })).imageUrl).toBeNull();
      for (const [w, h] of [[1080, 1080], [1254, 1254], [1200, 600]]) {
        const accepted = await upload(b.id).attach('image', pngOf(w, h), { filename: 'x.png', contentType: 'image/png' });
        expect(accepted.status).toBe(201);
        expect(accepted.body.data.imageUrl).toBeTruthy();
      }
    });

    it('image upload: JPEG/PNG/WebP only, 5 MB max, real image bytes, a file is required; the stored reference is the stable upload path', async () => {
      const b = await create({ title: 'Images' });
      const text = await upload(b.id).attach('image', Buffer.from('not an image'), { filename: 'x.png', contentType: 'text/plain' });
      expect(text.status).toBe(400);
      expect(text.body.error.details.code).toBe('UNSUPPORTED_IMAGE_TYPE');
      const lying = await upload(b.id).attach('image', Buffer.from('<html>pretending</html>'), { filename: 'x.png', contentType: 'image/png' });
      expect(lying.status).toBe(400); // the declared type is not trusted: the bytes are checked by the upload boundary
      const huge = await upload(b.id).attach('image', Buffer.alloc(5 * 1024 * 1024 + 1024, 1), { filename: 'x.png', contentType: 'image/png' });
      expect(huge.status).toBeGreaterThanOrEqual(400);
      expect(huge.status).toBeLessThan(500);
      expect((await upload(b.id)).status).toBe(400); // no file part
      expect((await world.ds.query('SELECT image_url FROM home_banners WHERE id = $1', [b.id]))[0].image_url).toBeNull(); // nothing half-saved

      const ok = await withImage(b.id);
      expect(ok.imageUrl).toMatch(/^\/uploads\/files\/[0-9a-f-]+\.png$/);
      expect(ok.imageUrl).not.toMatch(/https?:|X-Amz|Signature|token/i); // a stable reference, never a signed or external URL
      expect((await world.api('post', '/admin/home-banners/00000000-0000-4000-8000-000000000000/image', admin())).status).toBeGreaterThanOrEqual(400);
    });

    it('a published banner reaches customers with ONLY public fields; deactivating and deleting remove it again', async () => {
      const live = await publish({ title: 'Live one', titleAr: 'واحد', sortOrder: 1 });
      expect(live).toMatchObject({ isActive: true, displayStatus: 'LIVE' });
      const list = await publicList();
      expect(list).toHaveLength(1);
      expect(Object.keys(list[0]).sort()).toEqual(['actionTargetId', 'actionType', 'id', 'imageUrl', 'title', 'titleAr']);
      expect(list[0]).toMatchObject({ id: live.id, title: 'Live one', titleAr: 'واحد', imageUrl: live.imageUrl, actionType: 'NONE', actionTargetId: null });

      expectData(await world.api('patch', `/admin/home-banners/${live.id}/deactivate`, admin()));
      expect(await publicList()).toEqual([]);
      expectData(await world.api('patch', `/admin/home-banners/${live.id}/activate`, admin()));
      expect(await publicList()).toHaveLength(1);

      expectData(await world.api('delete', `/admin/home-banners/${live.id}`, admin()));
      expect(await publicList()).toEqual([]);
      expect(expectData<any[]>(await world.api('get', '/admin/home-banners', admin()))).toEqual([]);
      expect((await world.api('get', `/admin/home-banners/${live.id}`, admin())).status).toBe(404);
      const row = (await world.ds.query('SELECT is_active, deleted_at FROM home_banners WHERE id = $1', [live.id]))[0];
      expect(row.is_active).toBe(false);
      expect(row.deleted_at).not.toBeNull(); // soft delete: the row is kept
    });
  });

  describe('order and schedule', () => {
    it('customers get banners in the admin\'s sort order (ties: newest first), capped at 10', async () => {
      const third = await publish({ title: 'C', sortOrder: 5 });
      const first = await publish({ title: 'A', sortOrder: 1 });
      const second = await publish({ title: 'B', sortOrder: 3 });
      expect((await publicList()).map((b) => b.id)).toEqual([first.id, second.id, third.id]);
      expectData(await world.api('patch', `/admin/home-banners/${third.id}`, { token: superAdmin.accessToken, body: { sortOrder: 0 } }));
      expect((await publicList()).map((b) => b.id)).toEqual([third.id, first.id, second.id]);

      for (let i = 0; i < 12; i++) await publish({ title: `Extra ${i}`, sortOrder: 10 + i });
      expect(await publicList()).toHaveLength(10);
    });

    it('a future banner is SCHEDULED and an ended one EXPIRED — both hidden; inside the window it is shown', async () => {
      const day = 24 * 3600 * 1000;
      const future = await publish({ title: 'Soon', startsAt: new Date(Date.now() + day).toISOString() });
      const past = await publish({ title: 'Gone', startsAt: new Date(Date.now() - 3 * day).toISOString(), endsAt: new Date(Date.now() - day).toISOString() });
      const now = await publish({ title: 'Now', startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + day).toISOString() });
      expect((await publicList()).map((b) => b.id)).toEqual([now.id]);
      const byId = Object.fromEntries(expectData<any[]>(await world.api('get', '/admin/home-banners', admin())).map((b) => [b.id, b.displayStatus]));
      expect(byId).toEqual({ [future.id]: 'SCHEDULED', [past.id]: 'EXPIRED', [now.id]: 'LIVE' });
    });

    it('an end time at or before the start time is refused (service and CHECK), and schedule dates can be cleared with null', async () => {
      const t = new Date(Date.now() + 3600 * 1000).toISOString();
      const bad = await world.api('post', '/admin/home-banners', { token: superAdmin.accessToken, body: { title: 'Backwards', startsAt: t, endsAt: t } });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details.code).toBe('BANNER_SCHEDULE_INVALID');
      const b = await create({ title: 'Window', startsAt: t });
      expect((await world.api('patch', `/admin/home-banners/${b.id}`, { token: superAdmin.accessToken, body: { endsAt: new Date(Date.now() - 1000).toISOString() } })).status).toBe(400);
      const cleared = expectData<any>(await world.api('patch', `/admin/home-banners/${b.id}`, { token: superAdmin.accessToken, body: { startsAt: null } }));
      expect(cleared.startsAt).toBeNull();
    });
  });

  describe('destinations', () => {
    it('product, vendor-branch and sector destinations are accepted when they exist and handed to the app as typed targets', async () => {
      const p = await publish({ title: 'P', actionType: 'PRODUCT', actionTargetId: product.id, sortOrder: 1 });
      const v = await publish({ title: 'V', actionType: 'VENDOR', actionTargetId: vendor.branchId, sortOrder: 2 });
      const sc = await publish({ title: 'S', actionType: 'SECTOR', actionTargetId: sector.id, sortOrder: 3 });
      const list = await publicList();
      expect(list.map((b) => [b.id, b.actionType, b.actionTargetId])).toEqual([
        [p.id, 'PRODUCT', product.id],
        [v.id, 'VENDOR', vendor.branchId],
        [sc.id, 'SECTOR', sector.id],
      ]);
    });

    it('bad destinations are refused with a reason: target missing, target on a no-action banner, unknown id, non-UUID, unknown action', async () => {
      const code = async (body: Record<string, unknown>) => {
        const res = await world.api('post', '/admin/home-banners', { token: superAdmin.accessToken, body: { title: 'T', ...body } });
        return { status: res.status, code: res.body?.error?.details?.code };
      };
      expect(await code({ actionType: 'PRODUCT' })).toEqual({ status: 400, code: 'BANNER_ACTION_TARGET_REQUIRED' });
      expect(await code({ actionType: 'NONE', actionTargetId: product.id })).toEqual({ status: 400, code: 'BANNER_ACTION_TARGET_UNEXPECTED' });
      expect(await code({ actionTargetId: product.id })).toEqual({ status: 400, code: 'BANNER_ACTION_TARGET_UNEXPECTED' });
      expect(await code({ actionType: 'VENDOR', actionTargetId: '00000000-0000-4000-8000-000000000000' })).toEqual({ status: 400, code: 'BANNER_ACTION_TARGET_NOT_FOUND' });
      expect((await code({ actionType: 'SECTOR', actionTargetId: 'not-a-uuid' })).status).toBe(400);
      expect((await code({ actionType: 'URL', actionTargetId: product.id })).status).toBe(400); // no free-form external links
      expect((await code({ title: '   ' })).status).toBe(400);
      expect((await code({ unknownField: 1 })).status).toBe(400);
      expect(expectData<any[]>(await world.api('get', '/admin/home-banners', admin()))).toEqual([]); // nothing half-created
    });

    it('a banner whose destination has gone away is NOT shown (no dead pages): unavailable product, deactivated branch or sector', async () => {
      const p = await publish({ title: 'P', actionType: 'PRODUCT', actionTargetId: product.id, sortOrder: 1 });
      const v = await publish({ title: 'V', actionType: 'VENDOR', actionTargetId: vendor.branchId, sortOrder: 2 });
      const sc = await publish({ title: 'S', actionType: 'SECTOR', actionTargetId: sector.id, sortOrder: 3 });
      const plain = await publish({ title: 'Plain', sortOrder: 4 });
      await world.ds.query('UPDATE products SET is_available = false WHERE id = $1', [product.id]);
      expect((await publicList()).map((b) => b.id)).toEqual([v.id, sc.id, plain.id]);
      await world.ds.query('UPDATE vendor_branches SET is_active = false WHERE id = $1', [vendor.branchId]);
      expect((await publicList()).map((b) => b.id)).toEqual([sc.id, plain.id]);
      await world.ds.query('UPDATE marketplace_sectors SET is_active = false WHERE id = $1', [sector.id]);
      expect((await publicList()).map((b) => b.id)).toEqual([plain.id]);
      // restored → they come back (the banner rows were never touched)
      await world.ds.query('UPDATE products SET is_available = true WHERE id = $1', [product.id]);
      await world.ds.query('UPDATE vendor_branches SET is_active = true WHERE id = $1', [vendor.branchId]);
      await world.ds.query('UPDATE marketplace_sectors SET is_active = true WHERE id = $1', [sector.id]);
      expect((await publicList()).map((b) => b.id)).toEqual([p.id, v.id, sc.id, plain.id]);
    });

    it('switching an existing banner to "no action" drops its target; the database refuses an inconsistent pair outright', async () => {
      const b = await create({ title: 'Switch', actionType: 'PRODUCT', actionTargetId: product.id });
      const switched = expectData<any>(await world.api('patch', `/admin/home-banners/${b.id}`, { token: superAdmin.accessToken, body: { actionType: 'NONE' } }));
      expect(switched).toMatchObject({ actionType: 'NONE', actionTargetId: null });
      await expect(world.ds.query(`UPDATE home_banners SET action_type = 'PRODUCT' WHERE id = $1`, [b.id])).rejects.toThrow(/chk_home_banners_action_target/);
    });
  });

  it('the stored image reference can be read back from the API host (public image access)', async () => {
    const live = await publish({ title: 'Readable' });
    const res = await request(world.baseUrl).get(live.imageUrl);
    // Local-disk storage serves the file itself; private object storage answers with a 302 to a short-lived signed URL. Both are "readable".
    expect([200, 302]).toContain(res.status);
  });
});
