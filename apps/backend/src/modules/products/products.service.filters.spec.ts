import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';

/**
 * Filters V1 — dedicated spec for the new Product List filters/sort
 * (`availableOnly`, `hasOffers`, `minPriceMinor`/`maxPriceMinor`,
 * `sort=offers`). Kept separate from the pre-existing
 * `products.service.spec.ts` harness, same discipline the Vendor List
 * filters spec already established.
 */
function buildHarness(seed: { products?: any[] }) {
  const products = seed.products ?? [];

  const categoriesRepository = {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
  };

  function makeQb() {
    const qb: any = {
      _vendorBranchId: undefined as string | undefined,
      _availableOnly: false,
      _hasOffers: false,
      _minPrice: undefined as number | undefined,
      _maxPrice: undefined as number | undefined,
      _orderSql: undefined as string | undefined,
      _orderDir: undefined as string | undefined,
      _skip: 0,
      _take: 1000,
      where: (_sql: string, params: any) => {
        qb._vendorBranchId = params.vendorBranchId;
        return qb;
      },
      andWhere: (sql: string, params?: any) => {
        if (sql.includes('is_available')) qb._availableOnly = true;
        if (sql.includes('EXISTS') && sql.includes('offers')) qb._hasOffers = true;
        if (sql.includes('price_minor >=')) qb._minPrice = params.minPriceMinor;
        if (sql.includes('price_minor <=')) qb._maxPrice = params.maxPriceMinor;
        return qb;
      },
      orderBy: (sql: string, dir?: string) => {
        qb._orderSql = sql;
        qb._orderDir = dir;
        return qb;
      },
      addOrderBy: () => qb,
      skip: (n: number) => {
        qb._skip = n;
        return qb;
      },
      take: (n: number) => {
        qb._take = n;
        return qb;
      },
      getManyAndCount: async () => {
        let filtered = products.filter((p: any) => p.vendorBranchId === qb._vendorBranchId);
        if (qb._availableOnly) filtered = filtered.filter((p: any) => p.isAvailable);
        if (qb._hasOffers) filtered = filtered.filter((p: any) => p.hasOffer);
        if (qb._minPrice != null) filtered = filtered.filter((p: any) => p.priceMinor >= qb._minPrice);
        if (qb._maxPrice != null) filtered = filtered.filter((p: any) => p.priceMinor <= qb._maxPrice);
        if (qb._orderSql?.includes('EXISTS') && qb._orderSql.includes('offers')) {
          filtered = [...filtered].sort((a: any, b: any) => (b.hasOffer ? 1 : 0) - (a.hasOffer ? 1 : 0));
        }
        const total = filtered.length;
        const page = filtered.slice(qb._skip, qb._skip + qb._take);
        return [page, total];
      },
    };
    return qb;
  }

  const productsRepository = { createQueryBuilder: jest.fn(() => makeQb()) };
  const branchesRepository = { findOne: jest.fn(async () => ({ id: 'branch-1' })) };

  const service = new ProductsService(categoriesRepository as any, productsRepository as any, branchesRepository as any);
  return { service };
}

function makeProduct(overrides: Partial<any> = {}) {
  return {
    id: 'p1',
    vendorBranchId: 'branch-1',
    categoryId: 'cat-1',
    name: 'Burger',
    priceMinor: 5000,
    isAvailable: true,
    hasOffer: false,
    ...overrides,
  };
}

describe('ProductsService.getProducts — Filters V1', () => {
  describe('availableOnly filter', () => {
    it('with availableOnly=true, returns only real-available products', async () => {
      const { service } = buildHarness({
        products: [makeProduct({ id: 'avail', isAvailable: true }), makeProduct({ id: 'unavail', isAvailable: false })],
      });
      const result = await service.getProducts('branch-1', { availableOnly: true });
      expect(result.data.map((p: any) => p.id)).toEqual(['avail']);
    });

    it('omitted, returns every product regardless of availability — unchanged pre-Filters-V1 behavior', async () => {
      const { service } = buildHarness({
        products: [makeProduct({ id: 'avail', isAvailable: true }), makeProduct({ id: 'unavail', isAvailable: false })],
      });
      const result = await service.getProducts('branch-1');
      expect(result.data.map((p: any) => p.id).sort()).toEqual(['avail', 'unavail']);
    });
  });

  describe('hasOffers filter', () => {
    it('with hasOffers=true, returns only products with a real active offer', async () => {
      const { service } = buildHarness({
        products: [makeProduct({ id: 'p1', hasOffer: true }), makeProduct({ id: 'p2', hasOffer: false })],
      });
      const result = await service.getProducts('branch-1', { hasOffers: true });
      expect(result.data.map((p: any) => p.id)).toEqual(['p1']);
    });

    it('with hasOffers=true and no product qualifies, returns an empty (not error) result', async () => {
      const { service } = buildHarness({ products: [makeProduct({ id: 'p1', hasOffer: false })] });
      const result = await service.getProducts('branch-1', { hasOffers: true });
      expect(result.data).toEqual([]);
    });
  });

  describe('price range filter', () => {
    it('minPriceMinor/maxPriceMinor together filter inclusively', async () => {
      const { service } = buildHarness({
        products: [
          makeProduct({ id: 'cheap', priceMinor: 1000 }),
          makeProduct({ id: 'mid', priceMinor: 5000 }),
          makeProduct({ id: 'expensive', priceMinor: 9000 }),
        ],
      });
      const result = await service.getProducts('branch-1', { minPriceMinor: 2000, maxPriceMinor: 6000 });
      expect(result.data.map((p: any) => p.id)).toEqual(['mid']);
    });

    it('a boundary value (exactly minPriceMinor or maxPriceMinor) is included — inclusive bounds', async () => {
      const { service } = buildHarness({
        products: [makeProduct({ id: 'at-min', priceMinor: 2000 }), makeProduct({ id: 'at-max', priceMinor: 6000 })],
      });
      const result = await service.getProducts('branch-1', { minPriceMinor: 2000, maxPriceMinor: 6000 });
      expect(result.data.map((p: any) => p.id).sort()).toEqual(['at-max', 'at-min']);
    });

    it('minPriceMinor alone (no max) filters only the lower bound', async () => {
      const { service } = buildHarness({
        products: [makeProduct({ id: 'cheap', priceMinor: 1000 }), makeProduct({ id: 'mid', priceMinor: 5000 })],
      });
      const result = await service.getProducts('branch-1', { minPriceMinor: 2000 });
      expect(result.data.map((p: any) => p.id)).toEqual(['mid']);
    });

    it('rejects minPriceMinor greater than maxPriceMinor — no query is even attempted', async () => {
      const { service } = buildHarness({ products: [makeProduct()] });
      await expect(service.getProducts('branch-1', { minPriceMinor: 100, maxPriceMinor: 50 })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('no products in range returns an empty (not error) result', async () => {
      const { service } = buildHarness({ products: [makeProduct({ id: 'p1', priceMinor: 1000 })] });
      const result = await service.getProducts('branch-1', { minPriceMinor: 5000, maxPriceMinor: 6000 });
      expect(result.data).toEqual([]);
    });
  });

  describe('sort=offers', () => {
    it('orders products with a real active offer first', async () => {
      const { service } = buildHarness({
        products: [makeProduct({ id: 'no-offer', hasOffer: false }), makeProduct({ id: 'has-offer', hasOffer: true })],
      });
      const result = await service.getProducts('branch-1', { sort: 'offers' as any });
      expect(result.data.map((p: any) => p.id)).toEqual(['has-offer', 'no-offer']);
    });
  });

  describe('deterministic combinations', () => {
    it('availableOnly + hasOffers + price range combine as a real, correct AND', async () => {
      const { service } = buildHarness({
        products: [
          makeProduct({ id: 'matches-all', isAvailable: true, hasOffer: true, priceMinor: 3000 }),
          makeProduct({ id: 'unavailable', isAvailable: false, hasOffer: true, priceMinor: 3000 }),
          makeProduct({ id: 'no-offer', isAvailable: true, hasOffer: false, priceMinor: 3000 }),
          makeProduct({ id: 'too-expensive', isAvailable: true, hasOffer: true, priceMinor: 9000 }),
        ],
      });
      const result = await service.getProducts('branch-1', {
        availableOnly: true,
        hasOffers: true,
        minPriceMinor: 1000,
        maxPriceMinor: 5000,
      });
      expect(result.data.map((p: any) => p.id)).toEqual(['matches-all']);
    });
  });
});
