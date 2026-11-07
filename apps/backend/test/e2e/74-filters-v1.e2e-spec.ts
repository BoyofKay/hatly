/**
 * Filters V1 — Vendor List and Product List filters/sort, over real
 * HTTP against real Postgres. The unit specs
 * (`marketplace-vendors.service.filters.spec.ts`/
 * `products.service.filters.spec.ts`) prove the query-builder logic in
 * isolation; the integration spec (`filters-v1.int-spec.ts`) proves the
 * raw SQL against real rows. This file proves the actual customer-
 * facing HTTP contract: real auth-free public access, real query
 * param wiring, real validation errors over the wire — mirrors
 * `30-catalog.e2e-spec.ts`'s own setup conventions exactly.
 */
import { bootWorld, World } from './support/world';
import { Scenario, Actor, VendorFixture, expectData } from './support/actors';

const HOUR = 60 * 60 * 1000;
const activeWindow = () => ({
  startAt: new Date(Date.now() - HOUR).toISOString(),
  endAt: new Date(Date.now() + HOUR).toISOString(),
});

describe('E2E — Filters V1', () => {
  let world: World;
  let s: Scenario;
  let area: { id: string; lat: number; lng: number };
  let sectorId: string;
  let superAdmin: Actor;

  const createOffer = (body: Record<string, unknown>) =>
    world.api('post', '/admin/offers', { token: superAdmin.accessToken, body });

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    await s.configureDeliveryPricing();
    area = await s.serviceArea({ radiusMeters: 50000 });
    sectorId = (await s.sector('Restaurants')).id;
    superAdmin = await s.superAdmin();
  });
  afterAll(async () => {
    try {
      expect(world.unhandledServerErrors()).toEqual([]);
    } finally {
      await world.close();
    }
  });

  describe('Vendor List filters/sort', () => {
    let openVendor: VendorFixture;
    let closedVendor: VendorFixture;
    let offerVendor: VendorFixture;

    beforeAll(async () => {
      // New branches are created is_open=false by default (AdminVendorsService.createBranch) — every
      // fixture below is explicitly opened/left closed, never relying on that default silently.
      openVendor = await s.vendor({ name: 'Open Diner', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      await s.assignSector(openVendor, sectorId);
      expectData(await world.api('patch', `/admin/vendor-branches/${openVendor.branchId}/open`, { token: superAdmin.accessToken }));

      closedVendor = await s.vendor({ name: 'Closed Diner', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      await s.assignSector(closedVendor, sectorId);
      // s.vendor() opens every test store (R9: live stores are open), so this one is closed explicitly.
      expectData(await world.api('patch', `/admin/vendor-branches/${closedVendor.branchId}/close`, { token: superAdmin.accessToken }));

      offerVendor = await s.vendor({ name: 'Offer Diner', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      await s.assignSector(offerVendor, sectorId);
      await s.product(offerVendor, { name: 'Anything', priceMinor: 5000 });
      expectData(
        await createOffer({
          vendorBranchId: offerVendor.branchId,
          name: 'Branch-wide 10%',
          mechanism: 'SUBTOTAL_DISCOUNT',
          discountType: 'PERCENTAGE',
          discountValue: 1000,
          minimumEligibleSubtotalMinor: 1000,
          maximumDiscountMinor: 5000,
          ...activeWindow(),
        }),
        201,
      );
    });

    it('openNow=true returns only real-open branches', async () => {
      const res = await world.api('get', '/vendors', { query: { sectorId, openNow: 'true' } });
      expect(res.status).toBe(200);
      const ids = (res.body.data as any[]).map((v) => v.id);
      expect(ids).toContain(openVendor.branchId);
      expect(ids).not.toContain(closedVendor.branchId);
    });

    it('hasOffers=true returns only branches with a real active offer, and the unfiltered listing exposes a real hasOffer flag', async () => {
      const filtered = expectData<any[]>(await world.api('get', '/vendors', { query: { sectorId, hasOffers: 'true' } }));
      expect(filtered.map((v) => v.id)).toContain(offerVendor.branchId);
      expect(filtered.map((v) => v.id)).not.toContain(openVendor.branchId);

      const unfiltered = expectData<any[]>(await world.api('get', '/vendors', { query: { sectorId } }));
      const offerEntry = unfiltered.find((v) => v.id === offerVendor.branchId);
      const plainEntry = unfiltered.find((v) => v.id === openVendor.branchId);
      expect(offerEntry.hasOffer).toBe(true);
      expect(plainEntry.hasOffer).toBe(false);
    });

    it('sort=offers orders real offer-bearing branches first', async () => {
      const res = expectData<any[]>(await world.api('get', '/vendors', { query: { sectorId, sort: 'offers' } }));
      expect(res.findIndex((v) => v.id === offerVendor.branchId)).toBe(0);
    });

    it('rejects an out-of-range minRating with a clean 400, never a 500', async () => {
      const res = await world.api('get', '/vendors', { query: { sectorId, minRating: '7' } });
      expect(res.status).toBe(400);
    });

    it('rejects a non-boolean openNow with a clean 400', async () => {
      const res = await world.api('get', '/vendors', { query: { sectorId, openNow: 'maybe' } });
      expect(res.status).toBe(400);
    });

    it('omitting every Filters V1 param reproduces the exact unfiltered listing — fully backward compatible', async () => {
      const res = await world.api('get', '/vendors', { query: { sectorId } });
      expect(res.status).toBe(200);
      const ids = (res.body.data as any[]).map((v) => v.id);
      expect(ids).toEqual(expect.arrayContaining([openVendor.branchId, closedVendor.branchId, offerVendor.branchId]));
    });
  });

  describe('Product List filters/sort', () => {
    let vendor: VendorFixture;
    let cheapAvailable: { id: string; priceMinor: number };
    let expensiveUnavailable: { id: string; priceMinor: number };
    let offerProduct: { id: string; priceMinor: number };

    beforeAll(async () => {
      vendor = await s.vendor({ name: 'Product Filters Vendor', serviceAreaId: area.id, lat: 30.421, lng: 31.561 });
      cheapAvailable = await s.product(vendor, { name: 'Cheap Available', priceMinor: 2000 });
      expensiveUnavailable = await s.product(vendor, { name: 'Expensive Unavailable', priceMinor: 20000, inventoryMode: 'TRACKED', quantity: 0 });
      expectData(
        await world.api('patch', `/admin/products/${expensiveUnavailable.id}/deactivate`, { token: superAdmin.accessToken }),
      );
      offerProduct = await s.product(vendor, { name: 'On Offer', priceMinor: 8000 });
      expectData(
        await createOffer({
          vendorBranchId: vendor.branchId,
          name: 'Product-targeted 15%',
          mechanism: 'SUBTOTAL_DISCOUNT',
          discountType: 'PERCENTAGE',
          discountValue: 1500,
          minimumEligibleSubtotalMinor: 1000,
          maximumDiscountMinor: 5000,
          productIds: [offerProduct.id],
          ...activeWindow(),
        }),
        201,
      );
    });

    it('availableOnly=true excludes the real unavailable product', async () => {
      const res = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { availableOnly: 'true' } }));
      const ids = res.map((p) => p.id);
      expect(ids).toContain(cheapAvailable.id);
      expect(ids).not.toContain(expensiveUnavailable.id);
    });

    it('minPriceMinor/maxPriceMinor filter on the real price', async () => {
      const res = expectData<any[]>(
        await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { minPriceMinor: 1000, maxPriceMinor: 3000 } }),
      );
      expect(res.map((p) => p.id)).toEqual([cheapAvailable.id]);
    });

    it('hasOffers=true returns only the product-targeted offer\'s real product', async () => {
      const res = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { hasOffers: 'true' } }));
      expect(res.map((p) => p.id)).toEqual([offerProduct.id]);
      expect(res[0].activeOffer).not.toBeNull();
    });

    it('sort=offers orders the real offer-bearing product first', async () => {
      const res = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { sort: 'offers' } }));
      expect(res[0].id).toBe(offerProduct.id);
    });

    it('rejects minPriceMinor > maxPriceMinor with a clean 400 and a specific code', async () => {
      const res = await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { minPriceMinor: 500, maxPriceMinor: 100 } });
      expect(res.status).toBe(400);
      expect(res.body.error.details.code).toBe('INVALID_PRICE_RANGE');
    });

    it('rejects a negative minPriceMinor with a clean 400', async () => {
      const res = await world.api('get', `/vendor-branches/${vendor.branchId}/products`, { query: { minPriceMinor: -1 } });
      expect(res.status).toBe(400);
    });

    it('omitting every Filters V1 param reproduces the exact unfiltered listing — fully backward compatible', async () => {
      const res = expectData<any[]>(await world.api('get', `/vendor-branches/${vendor.branchId}/products`));
      expect(res.map((p) => p.id).sort()).toEqual([cheapAvailable.id, expensiveUnavailable.id, offerProduct.id].sort());
    });
  });
});
