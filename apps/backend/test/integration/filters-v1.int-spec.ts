import { randomUUID } from 'crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { createIntegrationApp } from './support/app';
import { TestData } from './support/test-data';
import { MarketplaceSector } from '../../src/modules/sectors/entities/marketplace-sector.entity';
import { Vendor } from '../../src/modules/vendors/entities/vendor.entity';
import { VendorBranch } from '../../src/modules/vendors/entities/vendor-branch.entity';
import { ProductCategory } from '../../src/modules/products/entities/product-category.entity';
import { Product } from '../../src/modules/products/entities/product.entity';
import { Offer } from '../../src/modules/offers/entities/offer.entity';
import { OfferProduct } from '../../src/modules/offers/entities/offer-product.entity';
import { OfferCategory } from '../../src/modules/offers/entities/offer-category.entity';
import { OfferMechanism } from '../../src/modules/offers/offer-mechanism.enum';
import { DiscountType } from '../../src/modules/offers/discount-type.enum';
import { MarketplaceVendorsService } from '../../src/modules/sectors/marketplace-vendors.service';
import { ProductsService } from '../../src/modules/products/products.service';

/**
 * Filters V1 — real PostgreSQL proof of the new hand-written raw SQL
 * (`hasActiveOfferSql`/`hasActiveOfferForProductSql` in
 * `marketplace-vendors.service.ts`/`products.service.ts`). The unit
 * specs (`marketplace-vendors.service.filters.spec.ts`/
 * `products.service.filters.spec.ts`) mock the query builder and can
 * never catch a real SQL syntax/column-name error or a real
 * Postgres time-window (`now()`) evaluation mistake — this file calls
 * the REAL services against REAL rows for exactly that reason.
 */
describe('Real PostgreSQL — Filters V1', () => {
  let app: NestExpressApplication;
  let ds: DataSource;
  let data: TestData;
  let vendorsService: MarketplaceVendorsService;
  let productsService: ProductsService;

  beforeAll(async () => {
    app = await createIntegrationApp();
    ds = app.get(DataSource);
    data = new TestData(ds);
    vendorsService = app.get(MarketplaceVendorsService);
    productsService = app.get(ProductsService);
  });
  afterEach(async () => {
    await data.dispose();
  });
  afterAll(async () => {
    await app?.close();
  });

  async function makeSector(): Promise<MarketplaceSector> {
    return data.save<MarketplaceSector>(MarketplaceSector, {
      name: 'Filters V1 Sector',
      slug: `filters-v1-${randomUUID()}`,
      sortOrder: 0,
      isActive: true,
    });
  }

  async function makeBranch(sectorId: string, overrides: Partial<VendorBranch> = {}): Promise<VendorBranch> {
    const vendor = await data.save<Vendor>(Vendor, { name: `Filters V1 Vendor ${randomUUID()}`, category: 'RESTAURANT', isActive: true });
    return data.save<VendorBranch>(VendorBranch, {
      vendorId: vendor.id,
      name: 'Main Branch',
      address: '1 Test St',
      latitude: 30.4,
      longitude: 31.5,
      marketplaceSectorId: sectorId,
      isActive: true,
      isOpen: true,
      ratingCount: 0,
      ratingSumStars: 0,
      ...overrides,
    });
  }

  async function makeOffer(vendorBranchId: string, overrides: Partial<Offer> = {}): Promise<Offer> {
    const now = new Date();
    return data.save<Offer>(Offer, {
      vendorBranchId,
      name: 'Test Offer',
      mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
      discountType: DiscountType.PERCENTAGE,
      discountValue: 1000,
      minimumEligibleSubtotalMinor: 5000,
      maximumDiscountMinor: 10000,
      startAt: new Date(now.getTime() - 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 60 * 60 * 1000),
      isActive: true,
      ...overrides,
    });
  }

  async function makeCategory(vendorBranchId: string): Promise<ProductCategory> {
    return data.save<ProductCategory>(ProductCategory, { vendorBranchId, name: 'Category', sortOrder: 0, isActive: true });
  }

  async function makeProduct(vendorBranchId: string, categoryId: string, overrides: Partial<Product> = {}): Promise<Product> {
    return data.save<Product>(Product, {
      vendorBranchId,
      categoryId,
      name: `Product ${randomUUID()}`,
      priceMinor: 5000,
      isAvailable: true,
      ...overrides,
    });
  }

  describe('MarketplaceVendorsService.listBySector', () => {
    it('openNow filters on the real isOpen column', async () => {
      const sector = await makeSector();
      const open = await makeBranch(sector.id, { isOpen: true });
      await makeBranch(sector.id, { isOpen: false });

      const result = await vendorsService.listBySector(sector.id, { openNow: true });
      expect(result.data.map((v) => v.id)).toEqual([open.id]);
    });

    it('a currently-active, in-window real Offer row makes hasOffer=true and satisfies hasOffers=true', async () => {
      const sector = await makeSector();
      const withOffer = await makeBranch(sector.id);
      const without = await makeBranch(sector.id);
      await makeOffer(withOffer.id);

      const unfiltered = await vendorsService.listBySector(sector.id);
      expect(unfiltered.data.find((v) => v.id === withOffer.id)?.hasOffer).toBe(true);
      expect(unfiltered.data.find((v) => v.id === without.id)?.hasOffer).toBe(false);

      const filtered = await vendorsService.listBySector(sector.id, { hasOffers: true });
      expect(filtered.data.map((v) => v.id)).toEqual([withOffer.id]);
    });

    it('an EXPIRED offer (endAt in the past) does not count as active', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      const now = new Date();
      await makeOffer(branch.id, { startAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), endAt: new Date(now.getTime() - 60 * 60 * 1000) });

      const result = await vendorsService.listBySector(sector.id, { hasOffers: true });
      expect(result.data).toEqual([]);
    });

    it('a NOT-YET-STARTED offer (startAt in the future) does not count as active', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      const now = new Date();
      await makeOffer(branch.id, { startAt: new Date(now.getTime() + 60 * 60 * 1000), endAt: new Date(now.getTime() + 2 * 60 * 60 * 1000) });

      const result = await vendorsService.listBySector(sector.id, { hasOffers: true });
      expect(result.data).toEqual([]);
    });

    it('an inactive (isActive=false) offer does not count', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      await makeOffer(branch.id, { isActive: false });

      const result = await vendorsService.listBySector(sector.id, { hasOffers: true });
      expect(result.data).toEqual([]);
    });

    it('minRating filters on the real rating_count/rating_sum_stars average', async () => {
      const sector = await makeSector();
      const highRated = await makeBranch(sector.id, { ratingCount: 10, ratingSumStars: 45 }); // 4.5
      await makeBranch(sector.id, { ratingCount: 10, ratingSumStars: 20 }); // 2.0
      await makeBranch(sector.id, { ratingCount: 0, ratingSumStars: 0 }); // unrated

      const result = await vendorsService.listBySector(sector.id, { minRating: 4 });
      expect(result.data.map((v) => v.id)).toEqual([highRated.id]);
    });

    it('sort=offers orders real offer-bearing branches first', async () => {
      const sector = await makeSector();
      const withoutOffer = await makeBranch(sector.id);
      const withOffer = await makeBranch(sector.id);
      await makeOffer(withOffer.id);

      const result = await vendorsService.listBySector(sector.id, { sort: 'offers' as any });
      expect(result.data.map((v) => v.id)).toEqual([withOffer.id, withoutOffer.id]);
    });
  });

  describe('ProductsService.getProducts', () => {
    it('availableOnly and price range filter on the real columns', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      const category = await makeCategory(branch.id);
      const match = await makeProduct(branch.id, category.id, { priceMinor: 3000, isAvailable: true });
      await makeProduct(branch.id, category.id, { priceMinor: 3000, isAvailable: false });
      await makeProduct(branch.id, category.id, { priceMinor: 9000, isAvailable: true });

      const result = await productsService.getProducts(branch.id, { availableOnly: true, minPriceMinor: 1000, maxPriceMinor: 5000 });
      expect(result.data.map((p) => p.id)).toEqual([match.id]);
    });

    it('a branch-wide offer (no product/category targeting rows at all) applies hasOffers to EVERY product in the branch', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      const category = await makeCategory(branch.id);
      const p1 = await makeProduct(branch.id, category.id);
      const p2 = await makeProduct(branch.id, category.id);
      await makeOffer(branch.id); // no OfferProduct/OfferCategory rows -> branch-wide

      const result = await productsService.getProducts(branch.id, { hasOffers: true });
      expect(result.data.map((p) => p.id).sort()).toEqual([p1.id, p2.id].sort());
    });

    it('a category-targeted offer applies ONLY to products in that category', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      const targetCategory = await makeCategory(branch.id);
      const otherCategory = await makeCategory(branch.id);
      const inTargetCategory = await makeProduct(branch.id, targetCategory.id);
      await makeProduct(branch.id, otherCategory.id);
      const offer = await makeOffer(branch.id);
      await data.save<OfferCategory>(OfferCategory, { offerId: offer.id, productCategoryId: targetCategory.id });

      const result = await productsService.getProducts(branch.id, { hasOffers: true });
      expect(result.data.map((p) => p.id)).toEqual([inTargetCategory.id]);
    });

    it('a product-targeted offer applies ONLY to that specific product, never its whole category', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      const category = await makeCategory(branch.id);
      const targetedProduct = await makeProduct(branch.id, category.id);
      await makeProduct(branch.id, category.id); // same category, NOT targeted
      const offer = await makeOffer(branch.id);
      await data.save<OfferProduct>(OfferProduct, { offerId: offer.id, productId: targetedProduct.id });

      const result = await productsService.getProducts(branch.id, { hasOffers: true });
      expect(result.data.map((p) => p.id)).toEqual([targetedProduct.id]);
    });

    it('rejects minPriceMinor > maxPriceMinor with a real BadRequestException, no query attempted', async () => {
      const sector = await makeSector();
      const branch = await makeBranch(sector.id);
      await expect(productsService.getProducts(branch.id, { minPriceMinor: 500, maxPriceMinor: 100 })).rejects.toMatchObject({
        response: { details: { code: 'INVALID_PRICE_RANGE' } },
      });
    });
  });
});
