/**
 * "لا تجد ما تبحث عنه؟" — customer custom requests (free text / photo, priced later by the vendor) are an admin setting PER SECTOR,
 * OFF by default, and the SERVER enforces it: hiding the button is not a control. The public branch details tell the app what the
 * server will accept (`allowsCustomRequests`).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';
import { Permission } from '../../src/modules/permissions/permission.enum';

describe('E2E — per-sector custom requests', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string };
  let superAdmin: Actor;

  const customRequest = (c: Actor, body: Record<string, unknown>) => world.api('post', '/cart/vendor-custom-items', { token: c.accessToken, body });
  const allowed = async (v: VendorFixture) => expectData<any>(await world.api('get', `/vendor-branches/${v.branchId}`)).allowsCustomRequests as boolean;
  const patchSector = (id: string, body: Record<string, unknown>, token = superAdmin.accessToken) => world.api('patch', `/admin/sectors/${id}`, { token, body });
  const newVendor = (name: string) => s.vendor({ name, serviceAreaId: area.id, lat: 30.421, lng: 31.561 });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    superAdmin = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('defaults', () => {
    it('a new sector has custom requests OFF unless the admin turns them on at creation', async () => {
      const off = expectData<any>(await world.api('post', '/admin/sectors', { token: superAdmin.accessToken, body: { name: 'Restaurants', slug: `rest-${Date.now()}` } }), 201);
      expect(off.customRequestsEnabled).toBe(false);
      const on = expectData<any>(await world.api('post', '/admin/sectors', { token: superAdmin.accessToken, body: { name: 'Pharmacy', slug: `pharm-${Date.now()}`, customRequestsEnabled: true } }), 201);
      expect(on.customRequestsEnabled).toBe(true);
    });

    it('a branch with NO sector, or whose sector is off, reports allowsCustomRequests=false', async () => {
      const unassigned = await newVendor('No Sector');
      expect(await allowed(unassigned)).toBe(false);
      const restaurant = await newVendor('A Restaurant');
      await s.assignSector(restaurant, (await s.sector('Restaurants')).id);
      expect(await allowed(restaurant)).toBe(false);
    });
  });

  describe('server enforcement (the API refuses, whatever the app shows)', () => {
    it('OFF: a custom request is refused 403 CUSTOM_REQUESTS_NOT_AVAILABLE — through a new group AND through an existing group — and nothing is added', async () => {
      const vendor = await newVendor('Restaurant Enforcement');
      const sector = await s.sector('Restaurants');
      await s.assignSector(vendor, sector.id);
      const product = await s.product(vendor, { priceMinor: 5000 });
      const c = await s.customer();

      const viaBranch = await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'Something off the menu' });
      expect(viaBranch.status).toBe(403);
      expect(viaBranch.body.error.details.code).toBe('CUSTOM_REQUESTS_NOT_AVAILABLE');

      const base = await s.addToCart(c, product.id, 1);
      const viaGroup = await customRequest(c, { cartVendorGroupId: base.groups[0].id, freeTextDescription: 'Something off the menu' });
      expect(viaGroup.status).toBe(403);
      expect(viaGroup.body.error.details.code).toBe('CUSTOM_REQUESTS_NOT_AVAILABLE');
      const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(cart.groups[0].items).toHaveLength(1); // only the real product
    });

    it('a vendor with no sector at all is refused too (suitability cannot be established)', async () => {
      const vendor = await newVendor('No Sector Enforcement');
      const c = await s.customer();
      const res = await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'x' });
      expect(res.status).toBe(403);
    });

    it('ON: the same request is accepted and is unpriced for the vendor to price later', async () => {
      const vendor = await newVendor('Pharmacy Enforcement');
      await s.allowCustomRequests(vendor);
      expect(await allowed(vendor)).toBe(true);
      const c = await s.customer();
      const view = expectData<any>(await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'Panadol Extra' }), 201);
      expect(view.groups[0].items[0]).toMatchObject({ freeTextDescription: 'Panadol Extra', unitPriceMinor: null });
    });

    it('an INACTIVE sector no longer grants it, and switching the setting takes effect immediately in both directions', async () => {
      const vendor = await newVendor('Toggle Vendor');
      const sector = await s.sector('Grocery', { customRequestsEnabled: true });
      await s.assignSector(vendor, sector.id);
      const c = await s.customer();
      expect(await allowed(vendor)).toBe(true);

      expectData(await patchSector(sector.id, { customRequestsEnabled: false }));
      expect(await allowed(vendor)).toBe(false);
      expect((await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'x' })).status).toBe(403);

      expectData(await patchSector(sector.id, { customRequestsEnabled: true }));
      expect(await allowed(vendor)).toBe(true);
      expectData(await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'x' }), 201);

      expectData(await world.api('patch', `/admin/sectors/${sector.id}/deactivate`, { token: superAdmin.accessToken }));
      expect(await allowed(vendor)).toBe(false);
      expect((await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'y' })).status).toBe(403);
    });

    it('the customer cannot grant it themselves: a custom flag in the request body is rejected, the sector decides', async () => {
      const vendor = await newVendor('Spoof Vendor');
      await s.assignSector(vendor, (await s.sector('Restaurants')).id);
      const c = await s.customer();
      const res = await customRequest(c, { vendorBranchId: vendor.branchId, freeTextDescription: 'x', customRequestsEnabled: true, allowsCustomRequests: true });
      expect([400, 403]).toContain(res.status);
      const cart = expectData<any>(await world.api('get', '/cart', { token: c.accessToken }));
      expect(cart.groups ?? []).toHaveLength(0);
    });
  });

  describe('who may change the setting', () => {
    it('only an admin with MANAGE_MARKETPLACE_SECTORS; vendors, customers, other admins and anonymous callers cannot', async () => {
      const sector = await s.sector('Authz Sector');
      const vendor = await newVendor('Authz Vendor');
      const customer = await s.customer();
      const noPermission = await s.admin([Permission.VIEW_ORDERS], 'No sector permission');
      const manager = await s.admin([Permission.MANAGE_MARKETPLACE_SECTORS], 'Sector Manager');

      for (const token of [vendor.manager.accessToken, customer.accessToken, noPermission.accessToken]) {
        expect((await patchSector(sector.id, { customRequestsEnabled: true }, token)).status).toBe(403);
      }
      expect((await world.api('patch', `/admin/sectors/${sector.id}`, { body: { customRequestsEnabled: true } })).status).toBe(401);
      expect(expectData<any>(await world.api('get', `/admin/sectors/${sector.id}`, { token: superAdmin.accessToken })).customRequestsEnabled).toBe(false);

      expect(expectData<any>(await patchSector(sector.id, { customRequestsEnabled: true }, manager.accessToken)).customRequestsEnabled).toBe(true);
      expect((await patchSector(sector.id, { customRequestsEnabled: 'yes' }, manager.accessToken)).status).toBe(400); // must be a boolean
    });
  });
});
