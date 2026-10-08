/**
 * Consolidated customer-commerce milestone (Part E — Sector
 * Subcategories), over real HTTP. Proves: the public
 * `GET /sectors/:sectorId/subcategories` surface a customer's
 * subcategory chip row is built from; that selecting a subcategory
 * FILTERS the existing `GET /vendors?sectorId=` listing rather than
 * ever turning browsing into "subcategory -> products" directly; that
 * a branch can belong to multiple subcategories at once; and Admin-only
 * gating on every management endpoint (mirrors `30-catalog.e2e-spec.ts`'s
 * own sector/vendor setup conventions).
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — Sector Subcategories', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let sectorId: string;
  let otherSectorId: string;
  let vendor: VendorFixture;
  let customer: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 30000 });
    sectorId = (await s.sector('Restaurants')).id;
    otherSectorId = (await s.sector('Supermarket')).id;
    vendor = await s.vendor({ name: 'Pizza House', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
    await s.assignSector(vendor, sectorId);
    customer = await s.customer();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('admin management — authorization', () => {
    it('unauthenticated cannot create a subcategory', async () => {
      const res = await world.api('post', '/admin/subcategories', { body: { sectorId, name: 'Burgers' } });
      expect(res.status).toBe(401);
    });

    it('a CUSTOMER cannot create a subcategory', async () => {
      const res = await world.api('post', '/admin/subcategories', {
        token: customer.accessToken,
        body: { sectorId, name: 'Burgers' },
      });
      expect(res.status).toBe(403);
    });

    it('SUPER_ADMIN can create, update, activate, and deactivate a subcategory', async () => {
      const superAdmin = await s.superAdmin();
      const created = expectData<any>(
        await world.api('post', '/admin/subcategories', { token: superAdmin.accessToken, body: { sectorId, name: 'Draft' } }),
        201,
      );
      expect(created.isActive).toBe(true);
      expect(created.sortOrder).toBe(0);

      const updated = expectData<any>(
        await world.api('patch', `/admin/subcategories/${created.id}`, { token: superAdmin.accessToken, body: { name: 'Renamed', sortOrder: 9 } }),
      );
      expect(updated.name).toBe('Renamed');
      expect(updated.sortOrder).toBe(9);

      const deactivated = expectData<any>(
        await world.api('patch', `/admin/subcategories/${created.id}/deactivate`, { token: superAdmin.accessToken }),
      );
      expect(deactivated.isActive).toBe(false);

      const reactivated = expectData<any>(
        await world.api('patch', `/admin/subcategories/${created.id}/activate`, { token: superAdmin.accessToken }),
      );
      expect(reactivated.isActive).toBe(true);
    });

    it('rejects creating a subcategory under a nonexistent sector', async () => {
      const superAdmin = await s.superAdmin();
      const res = await world.api('post', '/admin/subcategories', {
        token: superAdmin.accessToken,
        body: { sectorId: '00000000-0000-0000-0000-000000000000', name: 'X' },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('public browsing — GET /sectors/:sectorId/subcategories', () => {
    let burgers: { id: string };
    let pizza: { id: string };
    let dormant: { id: string };

    beforeAll(async () => {
      const superAdmin = await s.superAdmin();
      burgers = expectData<any>(
        await world.api('post', '/admin/subcategories', { token: superAdmin.accessToken, body: { sectorId, name: 'Burgers', sortOrder: 1 } }),
        201,
      );
      pizza = expectData<any>(
        await world.api('post', '/admin/subcategories', { token: superAdmin.accessToken, body: { sectorId, name: 'Pizza', sortOrder: 0 } }),
        201,
      );
      dormant = expectData<any>(
        await world.api('post', '/admin/subcategories', { token: superAdmin.accessToken, body: { sectorId, name: 'Dormant', isActive: false } }),
        201,
      );
    });

    it('is public (no auth required) and returns only active subcategories, ordered by sortOrder', async () => {
      const res = await world.api('get', `/sectors/${sectorId}/subcategories`, {});
      expect(res.status).toBe(200);
      const ids = (res.body.data as any[]).map((x) => x.id);
      expect(ids).toContain(burgers.id);
      expect(ids).toContain(pizza.id);
      expect(ids).not.toContain(dormant.id);
      expect(ids.indexOf(pizza.id)).toBeLessThan(ids.indexOf(burgers.id)); // sortOrder 0 before 1
    });

    it('a different sector\'s own subcategory listing does not include this sector\'s subcategories', async () => {
      const res = await world.api('get', `/sectors/${otherSectorId}/subcategories`, {});
      expect(res.status).toBe(200);
      expect((res.body.data as any[]).map((x) => x.id)).not.toContain(burgers.id);
    });

    it('a nonexistent sector returns 404, not an empty list', async () => {
      const res = await world.api('get', `/sectors/00000000-0000-0000-0000-000000000000/subcategories`, {});
      expect(res.status).toBe(404);
    });
  });

  describe('filtering GET /vendors by subcategoryId — the vendor-first navigation is preserved', () => {
    let burgers: { id: string };
    let pizza: { id: string };

    beforeAll(async () => {
      burgers = await s.subcategory(sectorId, 'Burgers Filter Test');
      pizza = await s.subcategory(sectorId, 'Pizza Filter Test');
      await s.assignSubcategories(vendor, [burgers.id, pizza.id]);
    });

    it('with no subcategoryId, every branch in the sector is returned — unchanged pre-existing behavior', async () => {
      const res = expectData<any[]>(await world.api('get', '/vendors', { query: { sectorId } }));
      expect(res.map((v) => v.id)).toContain(vendor.branchId);
    });

    it('filters to branches assigned to the given subcategory (still the SAME vendor-listing shape, never a product list)', async () => {
      const res = await world.api('get', '/vendors', { query: { sectorId, subcategoryId: burgers.id } });
      expect(res.status).toBe(200);
      const data = res.body.data as any[];
      expect(data.map((v) => v.id)).toContain(vendor.branchId);
      // Same response shape as the unfiltered listing — a branch/vendor entry, not a product.
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).not.toHaveProperty('priceMinor');
    });

    it('a branch assigned to MULTIPLE subcategories appears under each one', async () => {
      const underBurgers = expectData<any[]>(await world.api('get', '/vendors', { query: { sectorId, subcategoryId: burgers.id } }));
      const underPizza = expectData<any[]>(await world.api('get', '/vendors', { query: { sectorId, subcategoryId: pizza.id } }));
      expect(underBurgers.map((v) => v.id)).toContain(vendor.branchId);
      expect(underPizza.map((v) => v.id)).toContain(vendor.branchId);
    });

    it('rejects a subcategoryId belonging to a different sector than the one being browsed', async () => {
      const otherSubcategory = await s.subcategory(otherSectorId, 'Other Sector Subcategory');
      const res = await world.api('get', '/vendors', { query: { sectorId, subcategoryId: otherSubcategory.id } });
      expect(res.status).toBe(404);
    });

    it('rejects a nonexistent subcategoryId', async () => {
      const res = await world.api('get', '/vendors', { query: { sectorId, subcategoryId: '00000000-0000-0000-0000-000000000000' } });
      expect(res.status).toBe(404);
    });
  });

  describe('admin branch-subcategory assignment', () => {
    it('rejects assigning a subcategory from a different sector than the branch\'s own', async () => {
      const superAdmin = await s.superAdmin();
      const otherSubcategory = await s.subcategory(otherSectorId, 'Mismatch Test');
      const res = await world.api('patch', `/admin/vendor-branches/${vendor.branchId}/subcategories`, {
        token: superAdmin.accessToken,
        body: { subcategoryIds: [otherSubcategory.id] },
      });
      expect(res.status).toBe(400);
    });

    it('a CUSTOMER cannot assign subcategories to a branch', async () => {
      const res = await world.api('patch', `/admin/vendor-branches/${vendor.branchId}/subcategories`, {
        token: customer.accessToken,
        body: { subcategoryIds: [] },
      });
      expect(res.status).toBe(403);
    });
  });
});
