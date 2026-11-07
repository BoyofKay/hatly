/**
 * Group 8 / phase 5 — catalog journey over real HTTP: admin sets up sector, vendor, branch,
 * categories and products; vendor staff manage their own catalog; customers browse, search and see
 * the changes immediately. Also proves what a customer must NOT see or be able to order.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

describe('E2E — catalog', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let sectorId: string;
  let vendor: VendorFixture;
  let customer: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 30000 });
    sectorId = (await s.sector('Restaurants')).id;
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

  it('a new vendor and branch start INACTIVE and are invisible to customers until an admin activates them', async () => {
    const superAdmin = await s.superAdmin();
    const hidden = await world.api('post', '/admin/vendors', { token: superAdmin.accessToken, body: { name: 'Hidden Vendor' } });
    expect(expectData(hidden, 201).isActive).toBe(false);
    const marketplace = await world.api('get', '/vendors', { query: { sectorId } });
    expect(expectData<any[]>(marketplace).map((v) => v.name)).toEqual(['Pizza House']);
  });

  it('public sector list shows only active sectors; the marketplace lists only active vendors/branches of the sector', async () => {
    const superAdmin = await s.superAdmin();
    const inactive = await s.sector('Dormant');
    expectData(await world.api('patch', `/admin/sectors/${inactive.id}/deactivate`, { token: superAdmin.accessToken }));
    const sectors = expectData<any[]>(await world.api('get', '/sectors'));
    expect(sectors.map((x) => x.id)).toContain(sectorId);
    expect(sectors.map((x) => x.id)).not.toContain(inactive.id);
    expect((await world.api('get', '/vendors', { query: { sectorId: inactive.id } })).status).toBe(404);
    expect((await world.api('get', '/vendors')).status).toBe(400); // sectorId is required
  });

  it('the marketplace filters by the customer\'s service area: inside → listed, outside every area → empty', async () => {
    const inside = await world.api('get', '/vendors', { query: { sectorId, latitude: 30.425, longitude: 31.565 } });
    expect(expectData<any[]>(inside)).toHaveLength(1);
    const outside = await world.api('get', '/vendors', { query: { sectorId, latitude: 25.0, longitude: 55.0 } });
    expect(outside.status).toBe(200);
    expect(outside.body.data).toEqual([]);
    expect(outside.body.meta.total).toBe(0);
  });

  describe('browsing a branch', () => {
    let categoryId: string;
    let burger: { id: string };
    let pasta: { id: string };

    beforeAll(async () => {
      categoryId = vendor.categoryId;
      burger = await s.product(vendor, { name: 'Burger', priceMinor: 9000 });
      pasta = await s.product(vendor, { name: 'Pasta', priceMinor: 12000, inventoryMode: 'TRACKED', quantity: 3 });
    });

    it('serves branch details, active categories, and products without authentication', async () => {
      const details = expectData(await world.api('get', `/vendor-branches/${vendor.branchId}`));
      expect(details).toMatchObject({ id: vendor.branchId, vendor: { id: vendor.vendorId, name: 'Pizza House' } });
      const categories = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/categories`));
      expect(categories.map((c) => c.id)).toEqual([categoryId]);
      const products = await world.api('get', `/vendor-branches/${vendor.branchId}/products`);
      expect(expectData<any[]>(products).map((p) => p.name).sort()).toEqual(['Burger', 'Pasta']);
      expect(products.body.meta).toMatchObject({ total: 2 });
      const one = expectData(await world.api('get', `/products/${pasta.id}`));
      expect(one).toMatchObject({ id: pasta.id, priceMinor: 12000, inventoryMode: 'TRACKED' });
    });

    it('sorts by price, filters by category and search, and paginates', async () => {
      const asc = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { sort: 'price_asc' } }));
      expect(asc.map((p) => p.priceMinor)).toEqual([9000, 12000]);
      const desc = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { sort: 'price_desc' } }));
      expect(desc.map((p) => p.priceMinor)).toEqual([12000, 9000]);
      const found = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { search: 'burg' } }));
      expect(found.map((p) => p.name)).toEqual(['Burger']);
      const page2 = await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { sort: 'price_asc', page: 2, limit: 1 } });
      expect(expectData<any[]>(page2).map((p) => p.name)).toEqual(['Pasta']);
      expect(page2.body.meta).toMatchObject({ page: 2, limit: 1, total: 2 });
      expect(expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { categoryId } }))).toHaveLength(2);
    });

    it('rejects an invalid sort, a category of another branch, and malformed ids with a clean 4xx (never a 500)', async () => {
      const other = await s.vendor({ name: 'Other', serviceAreaId: area.id, lat: 30.43, lng: 31.57 });
      expect((await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { sort: 'cheapest' } })).status).toBe(400);
      const mismatch = await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { categoryId: other.categoryId } });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.error.details).toEqual({ code: 'CATEGORY_BRANCH_MISMATCH' });
      for (const path of [`/vendor-branches/not-a-uuid`, `/vendor-branches/not-a-uuid/products`, `/vendor-branches/not-a-uuid/categories`, `/products/not-a-uuid`]) {
        const res = await world.api('get', path);
        expect({ path, status: res.status }).toEqual({ path, status: expect.any(Number) });
        expect(res.status).toBeLessThan(500);
      }
    });

    it('a deactivated product stops being orderable immediately (cart refuses it) and reappears when reactivated', async () => {
      const superAdmin = await s.superAdmin();
      expectData(await world.api('patch', `/admin/products/${burger.id}/deactivate`, { token: superAdmin.accessToken }));
      const refused = await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: burger.id, quantity: 1 } });
      expect(refused.status).toBe(400);
      expect(refused.body.error.details).toEqual({ code: 'PRODUCT_UNAVAILABLE' });
      expectData(await world.api('patch', `/admin/products/${burger.id}/activate`, { token: superAdmin.accessToken }));
      expectData(await world.api('post', '/cart/items', { token: customer.accessToken, body: { productId: burger.id, quantity: 1 } }), 201);
      expectData(await world.api('delete', '/cart', { token: customer.accessToken }));
    });

    it('a vendor manager manages ONLY their own catalog: a price reduction is immediately visible, an increase waits for Hatly (R7); stock-zero is reflected', async () => {
      const upd = await world.api('patch', `/vendor/products/${burger.id}`, { token: vendor.manager.accessToken, body: { priceMinor: 8500 } });
      expect(upd.status).toBe(200);
      expect(expectData(await world.api('get', `/products/${burger.id}`)).priceMinor).toBe(8500);
      const up = expectData<any>(await world.api('patch', `/vendor/products/${burger.id}`, { token: vendor.manager.accessToken, body: { priceMinor: 9900 } }));
      expect(up.pendingChange).toMatchObject({ kind: 'UPDATE', status: 'PENDING', payload: { priceMinor: 9900 } });
      expect(expectData(await world.api('get', `/products/${burger.id}`)).priceMinor).toBe(8500); // the approved price stays live
      expectData(await world.api('post', `/vendor/products/change-requests/${up.pendingChange.id}/withdraw`, { token: vendor.manager.accessToken }), 201);
      expectData(await world.api('patch', `/vendor/products/${pasta.id}/set-inventory-zero`, { token: vendor.manager.accessToken }));
      expect(expectData(await world.api('get', `/products/${pasta.id}`)).quantity).toBe(0);
      // restore for later tests
      await world.api('patch', `/admin/products/${burger.id}`, { token: (await s.superAdmin()).accessToken, body: { priceMinor: 9000 } });
      await world.api('patch', `/vendor/products/${pasta.id}`, { token: vendor.manager.accessToken, body: { quantity: 3 } });
    });

    it('product validation at the HTTP edge: bad price, missing name, tracked without quantity, foreign category', async () => {
      const superAdmin = await s.superAdmin();
      const base = { vendorBranchId: vendor.branchId, categoryId: vendor.categoryId, name: 'X', priceMinor: 100, pricingUnit: 'PIECE' };
      const post = (body: object) => world.api('post', '/admin/products', { token: superAdmin.accessToken, body });
      expect((await post({ ...base, priceMinor: 0 })).status).toBe(400);
      expect((await post({ ...base, priceMinor: 10.5 })).status).toBe(400);
      expect((await post({ ...base, name: undefined })).status).toBe(400);
      expect((await post({ ...base, pricingUnit: 'LITRE' })).status).toBe(400);
      const tracked = await post({ ...base, inventoryMode: 'TRACKED' });
      expect(tracked.status).toBe(400);
      const other = await s.vendor({ name: 'Third', serviceAreaId: area.id, lat: 30.44, lng: 31.58 });
      const foreign = await post({ ...base, categoryId: other.categoryId });
      expect(foreign.status).toBe(400);
    });
  });

  describe('search', () => {
    it('ranks exact > prefix > substring, excludes inactive vendors and unavailable products, honours the service area, and paginates', async () => {
      const superAdmin = await s.superAdmin();
      const farArea = await s.serviceArea({ name: 'Far Away', lat: 27.0, lng: 33.0, radiusMeters: 5000 });
      const mk = async (name: string, lat = 30.421, lng = 31.561, serviceAreaId = area.id) => s.vendor({ name, serviceAreaId, lat, lng });
      const partial = await mk('Best Shawarma Hut');
      const prefix = await mk('Shawarma King');
      const exact = await mk('Shawarma');
      const far = await mk('Shawarma Far', 27.0, 33.0, farArea.id);
      const retired = await mk('Shawarma Retired');
      expectData(await world.api('patch', `/admin/vendors/${retired.vendorId}/deactivate`, { token: superAdmin.accessToken }));
      const soldOut = await s.product(exact, { name: 'Shawarma Sandwich', priceMinor: 7000 });
      const listed = await s.product(prefix, { name: 'Shawarma Plate', priceMinor: 9000 });
      expectData(await world.api('patch', `/admin/products/${soldOut.id}/deactivate`, { token: superAdmin.accessToken }));

      const all = expectData<any>(await world.api('get', '/search', { query: { q: 'shawarma' } }));
      const ranked = all.vendors.data.map((v: any) => v.name);
      expect(ranked[0]).toBe('Shawarma'); // exact
      expect(ranked.slice(1, 3).sort()).toEqual(['Shawarma Far', 'Shawarma King']); // prefix (tie → stable id order)
      expect(ranked[3]).toBe('Best Shawarma Hut'); // substring
      expect(all.vendors.data.map((v: any) => v.name)).not.toContain('Shawarma Retired');
      expect(all.products.data.map((p: any) => p.name)).toEqual(['Shawarma Plate']); // unavailable product excluded
      expect(all.products.data[0].id).toBe(listed.id);

      const nearby = expectData<any>(await world.api('get', '/search', { query: { q: 'shawarma', latitude: 30.425, longitude: 31.565 } }));
      expect(nearby.vendors.data.map((v: any) => v.name)).toEqual(['Shawarma', 'Shawarma King', 'Best Shawarma Hut']);
      const farAway = expectData<any>(await world.api('get', '/search', { query: { q: 'shawarma', latitude: 27.0, longitude: 33.0 } }));
      expect(farAway.vendors.data.map((v: any) => v.name)).toEqual(['Shawarma Far']);

      const page = expectData<any>(await world.api('get', '/search', { query: { q: 'shawarma', vendorPage: 2, vendorLimit: 2 } }));
      expect(page.vendors.data).toHaveLength(2);
      expect(page.vendors.data[1].name).toBe('Best Shawarma Hut');
      expect(page.vendors.total).toBe(4);
      expect(partial.vendorId).toBeDefined();
    });

    it('a blank or too-short query is answered cleanly (no 500)', async () => {
      for (const q of ['', ' ', 'a']) {
        const res = await world.api('get', '/search', { query: { q } });
        expect({ q, status: res.status }).toEqual({ q, status: expect.any(Number) });
        expect(res.status).toBeLessThan(500);
      }
    });
  });

  describe('deactivating a vendor or branch', () => {
    it('hides it from the marketplace AND refuses new cart items and checkout for it (vendor-level deactivation is enforced, not just cosmetic)', async () => {
      const v = await s.vendor({ name: 'Closing Down', serviceAreaId: area.id, lat: 30.422, lng: 31.562 });
      await s.assignSector(v, sectorId);
      const p = await s.product(v, { name: 'Last Item', priceMinor: 5000 });
      const listed = () => world.api('get', '/vendors', { query: { sectorId } }).then((r) => (r.body.data as any[]).map((x) => x.name));
      expect(await listed()).toContain('Closing Down');

      const c = await s.customer('Shopper');
      await s.addToCart(c, p.id, 1); // in the cart BEFORE the vendor is deactivated
      const superAdmin = await s.superAdmin();
      expectData(await world.api('patch', `/admin/vendors/${v.vendorId}/deactivate`, { token: superAdmin.accessToken }));

      expect(await listed()).not.toContain('Closing Down');
      const other = await s.customer('Late Shopper');
      const add = await world.api('post', '/cart/items', { token: other.accessToken, body: { productId: p.id, quantity: 1 } });
      expect(add.status).toBe(400);
      expect(add.body.error.details).toEqual({ code: 'BRANCH_UNAVAILABLE' });
      const checkout = await world.api('post', '/orders', { token: c.accessToken, body: { deliveryAddress: { line1: 'x', latitude: 30.425, longitude: 31.565 }, paymentMethod: 'COD' } });
      expect(checkout.status).toBe(400);
      expect(checkout.body.error.details).toEqual({ code: 'BRANCH_UNAVAILABLE' });
      expect(await world.ds.query('SELECT id FROM orders WHERE customer_id = $1', [c.id])).toEqual([]);
    });

    it('deactivating only the branch has the same effect', async () => {
      const v = await s.vendor({ name: 'Branch Closed', serviceAreaId: area.id, lat: 30.423, lng: 31.563 });
      const p = await s.product(v, { priceMinor: 5000 });
      const superAdmin = await s.superAdmin();
      expectData(await world.api('patch', `/admin/vendor-branches/${v.branchId}/deactivate`, { token: superAdmin.accessToken }));
      const c = await s.customer();
      const add = await world.api('post', '/cart/items', { token: c.accessToken, body: { productId: p.id, quantity: 1 } });
      expect(add.body.error?.details).toEqual({ code: 'BRANCH_UNAVAILABLE' });
    });
  });
});
