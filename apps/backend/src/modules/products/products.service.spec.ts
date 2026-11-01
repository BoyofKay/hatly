import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { PricingUnit } from './pricing-unit.enum';

function buildHarness(seed: { products?: any[]; categories?: any[] }) {
  const products = seed.products ?? [];
  const categories = new Map((seed.categories ?? []).map((c) => [c.id, c]));

  const categoriesRepository = {
    find: jest.fn(async () => [...categories.values()]),
    findOne: jest.fn(async (opts: any) => {
      const c = categories.get(opts.where.id);
      if (!c || c.vendorBranchId !== opts.where.vendorBranchId) return null;
      return c;
    }),
  };

  function makeQb() {
    const qb: any = {
      _vendorBranchId: undefined as string | undefined,
      _categoryId: undefined as string | undefined,
      _search: undefined as string | undefined,
      _sort: 'newest' as string,
      _minRatings: undefined as number | undefined,
      _skip: 0,
      _take: 1000,
      where: (_sql: string, params: any) => {
        qb._vendorBranchId = params.vendorBranchId;
        return qb;
      },
      andWhere: (sql: string, params?: any) => {
        if (sql.includes('category_id')) qb._categoryId = params.categoryId;
        if (sql.includes('ILIKE')) qb._search = (params.term as string).replace(/%/g, '').toLowerCase();
        if (sql.includes('rating_count >=')) qb._minRatings = params.minRatings;
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
        if (qb._categoryId) filtered = filtered.filter((p: any) => p.categoryId === qb._categoryId);
        if (qb._search) filtered = filtered.filter((p: any) => (p.name as string).toLowerCase().includes(qb._search));
        if (qb._minRatings != null) {
          filtered = filtered.filter((p: any) => p.ratingCount >= qb._minRatings);
          filtered = [...filtered].sort(
            (a, b) => b.ratingSumStars / b.ratingCount - a.ratingSumStars / a.ratingCount,
          );
        } else if (qb._orderSql?.includes('price_minor')) {
          filtered = [...filtered].sort((a, b) => a.priceMinor - b.priceMinor);
          if (qb._orderDir === 'DESC') filtered.reverse();
        } else if (qb._orderSql?.includes('CASE WHEN')) {
          filtered = [...filtered].sort((a, b) => {
            const av = a.pricingUnit === PricingUnit.WEIGHT ? a.deliveredWeightGramsCount : a.deliveredQuantityCount;
            const bv = b.pricingUnit === PricingUnit.WEIGHT ? b.deliveredWeightGramsCount : b.deliveredQuantityCount;
            return bv - av;
          });
        }
        const total = filtered.length;
        const page = filtered.slice(qb._skip, qb._skip + qb._take);
        return [page, total];
      },
    };
    return qb;
  }

  const productsRepository = { createQueryBuilder: jest.fn(() => makeQb()) };
  // `manager.query` answers the branch-closure lookup: no branch is under a closure in these tests.
  const branchesRepository = {
    manager: { query: jest.fn(async () => []) }, findOne: jest.fn(async () => ({ id: 'branch-1' })) };

  const service = new ProductsService(categoriesRepository as any, productsRepository as any, branchesRepository as any);
  return { service };
}

function makeProduct(overrides: Partial<any> = {}) {
  return {
    id: 'p1',
    vendorBranchId: 'branch-1',
    categoryId: 'cat-1',
    name: 'Burger',
    priceMinor: 1000,
    pricingUnit: PricingUnit.PIECE,
    ratingCount: 0,
    ratingSumStars: 0,
    deliveredQuantityCount: 0,
    deliveredWeightGramsCount: 0,
    ...overrides,
  };
}

describe('ProductsService.getProducts — category isolation', () => {
  it('rejects a categoryId that does not belong to the requested vendorBranchId', async () => {
    const { service } = buildHarness({
      categories: [{ id: 'cat-1', vendorBranchId: 'branch-OTHER' }],
    });
    await expect(service.getProducts('branch-1', { categoryId: 'cat-1' })).rejects.toThrow(BadRequestException);
  });

  it('rejects a nonexistent categoryId', async () => {
    const { service } = buildHarness({ categories: [] });
    await expect(service.getProducts('branch-1', { categoryId: 'missing' })).rejects.toThrow(BadRequestException);
  });

  it('accepts a categoryId that genuinely belongs to the requested branch', async () => {
    const { service } = buildHarness({
      categories: [{ id: 'cat-1', vendorBranchId: 'branch-1' }],
      products: [makeProduct({ id: 'p1', categoryId: 'cat-1' }), makeProduct({ id: 'p2', categoryId: 'cat-2' })],
    });
    const result = await service.getProducts('branch-1', { categoryId: 'cat-1' });
    expect(result.data.map((p: any) => p.id)).toEqual(['p1']);
  });
});

describe('ProductsService.getProducts — sort=highestRated', () => {
  it('excludes products below the 5-rating threshold', async () => {
    const { service } = buildHarness({
      products: [
        makeProduct({ id: 'eligible', ratingCount: 5, ratingSumStars: 20 }),
        makeProduct({ id: 'not-eligible', ratingCount: 4, ratingSumStars: 20 }),
      ],
    });
    const result = await service.getProducts('branch-1', { sort: 'highestRated' });
    expect(result.data.map((p: any) => p.id)).toEqual(['eligible']);
  });

  it('orders by average descending, never mixing Product ratings with VendorBranch ratings', async () => {
    const { service } = buildHarness({
      products: [
        makeProduct({ id: 'lower', ratingCount: 5, ratingSumStars: 15 }),
        makeProduct({ id: 'higher', ratingCount: 5, ratingSumStars: 25 }),
      ],
    });
    const result = await service.getProducts('branch-1', { sort: 'highestRated' });
    expect(result.data.map((p: any) => p.id)).toEqual(['higher', 'lower']);
  });
});

describe('ProductsService.getProducts — Best Selling', () => {
  it('PIECE products sort by deliveredQuantityCount', async () => {
    const { service } = buildHarness({
      products: [
        makeProduct({ id: 'low', deliveredQuantityCount: 5 }),
        makeProduct({ id: 'high', deliveredQuantityCount: 50 }),
      ],
    });
    const result = await service.getProducts('branch-1', { sort: 'bestSelling' });
    expect(result.data.map((p: any) => p.id)).toEqual(['high', 'low']);
  });

  it('WEIGHT products sort by deliveredWeightGramsCount, never by a piece-count interpretation', async () => {
    const { service } = buildHarness({
      products: [
        makeProduct({ id: 'low', pricingUnit: PricingUnit.WEIGHT, deliveredWeightGramsCount: 500 }),
        makeProduct({ id: 'high', pricingUnit: PricingUnit.WEIGHT, deliveredWeightGramsCount: 5000 }),
      ],
    });
    const result = await service.getProducts('branch-1', { sort: 'bestSelling' });
    expect(result.data.map((p: any) => p.id)).toEqual(['high', 'low']);
  });
});

describe('ProductsService.getProducts — price sorting', () => {
  it('sorts ASC by the current Product.priceMinor only, never historical OrderItem pricing', async () => {
    const { service } = buildHarness({
      products: [makeProduct({ id: 'cheap', priceMinor: 500 }), makeProduct({ id: 'expensive', priceMinor: 2000 })],
    });
    const result = await service.getProducts('branch-1', { sort: 'price_asc' });
    expect(result.data.map((p: any) => p.id)).toEqual(['cheap', 'expensive']);
  });

  it('sorts DESC by the current Product.priceMinor', async () => {
    const { service } = buildHarness({
      products: [makeProduct({ id: 'cheap', priceMinor: 500 }), makeProduct({ id: 'expensive', priceMinor: 2000 })],
    });
    const result = await service.getProducts('branch-1', { sort: 'price_desc' });
    expect(result.data.map((p: any) => p.id)).toEqual(['expensive', 'cheap']);
  });
});

describe('ProductsService.getProducts — search', () => {
  it('matches product name, case-insensitively, substring', async () => {
    const { service } = buildHarness({
      products: [makeProduct({ id: 'p1', name: 'Cheese Burger' }), makeProduct({ id: 'p2', name: 'Pizza' })],
    });
    const result = await service.getProducts('branch-1', { search: 'burger' });
    expect(result.data.map((p: any) => p.id)).toEqual(['p1']);
  });

  it('a 1-character search term is not applied (2-character minimum)', async () => {
    const { service } = buildHarness({ products: [makeProduct({ id: 'p1', name: 'Burger' })] });
    const result = await service.getProducts('branch-1', { search: 'b' });
    expect(result.data).toHaveLength(1);
  });

  it('returns empty results gracefully when nothing matches', async () => {
    const { service } = buildHarness({ products: [makeProduct({ id: 'p1', name: 'Burger' })] });
    const result = await service.getProducts('branch-1', { search: 'nonexistent' });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

describe('ProductsService.getProducts — vendor isolation & pagination', () => {
  it('never returns a product from a different VendorBranch', async () => {
    const { service } = buildHarness({
      products: [makeProduct({ id: 'p1', vendorBranchId: 'branch-1' }), makeProduct({ id: 'p2', vendorBranchId: 'branch-2' })],
    });
    const result = await service.getProducts('branch-1');
    expect(result.data.map((p: any) => p.id)).toEqual(['p1']);
  });

  it('paginates and reports total correctly', async () => {
    const products = [1, 2, 3].map((n) => makeProduct({ id: `p${n}` }));
    const { service } = buildHarness({ products });
    const result = await service.getProducts('branch-1', { page: 1, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it('caps a garbage/malicious limit at the sanity ceiling', async () => {
    const { service } = buildHarness({ products: [makeProduct()] });
    const result = await service.getProducts('branch-1', { limit: 9999 });
    expect(result.limit).toBe(50);
  });
});

describe('ProductsService.getProductById', () => {
  it('rejects a non-existent product', async () => {
    const productsRepository = { findOne: async () => null };
    const categoriesRepository = { find: jest.fn() };
    // `manager.query` answers the branch-closure lookup: no branch is under a closure in these tests.
  const branchesRepository = {
    manager: { query: jest.fn(async () => []) }, findOne: jest.fn() };
    const service = new ProductsService(categoriesRepository as any, productsRepository as any, branchesRepository as any);
    await expect(service.getProductById('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('ProductsService.getBranchDetails (L1-B)', () => {
  function buildDetailsHarness(branchRow: any) {
    // `manager.query` answers the branch-closure lookup: no branch is under a closure in these tests.
  const branchesRepository = {
    manager: { query: jest.fn(async () => []) },
      findOne: jest.fn(async (opts: any) => (opts.where.id === branchRow?.id ? branchRow : null)),
    };
    const service = new ProductsService({} as any, {} as any, branchesRepository as any);
    return { service, branchesRepository };
  }

  it('resolves a real VendorBranch joined with its Vendor', async () => {
    const { service } = buildDetailsHarness({
      id: 'branch-1',
      address: '12 Market St',
      latitude: 30.1,
      longitude: 31.1,
      isOpen: true,
      openingHours: { mon: { open: '09:00', close: '23:00' } },
      ratingCount: 10,
      ratingSumStars: 45,
      vendor: { id: 'vendor-1', name: 'Pizza House', nameAr: null, logoUrl: null },
    });

    const result = await service.getBranchDetails('branch-1');

    expect(result.id).toBe('branch-1');
    expect(result.address).toBe('12 Market St');
    expect(result.vendor).toEqual({ id: 'vendor-1', name: 'Pizza House', nameAr: null, logoUrl: null });
  });

  it('computes ratingAverage with the EXACT same formula as MarketplaceVendorsService — ratingSumStars/ratingCount', async () => {
    const { service } = buildDetailsHarness({
      id: 'branch-1',
      address: 'X',
      latitude: 0,
      longitude: 0,
      isOpen: true,
      openingHours: {},
      ratingCount: 10,
      ratingSumStars: 45,
      vendor: { id: 'vendor-1', name: 'X', nameAr: null, logoUrl: null },
    });
    const result = await service.getBranchDetails('branch-1');
    expect(result.ratingAverage).toBe(4.5);
    expect(result.ratingCount).toBe(10);
  });

  it('ratingAverage is 0 when ratingCount is 0 — never a division by zero', async () => {
    const { service } = buildDetailsHarness({
      id: 'branch-1',
      address: 'X',
      latitude: 0,
      longitude: 0,
      isOpen: true,
      openingHours: {},
      ratingCount: 0,
      ratingSumStars: 0,
      vendor: { id: 'vendor-1', name: 'X', nameAr: null, logoUrl: null },
    });
    const result = await service.getBranchDetails('branch-1');
    expect(result.ratingAverage).toBe(0);
  });

  it('CRITICAL: a nonexistent branch throws NotFoundException — never a fixture/fabricated fallback', async () => {
    const { service } = buildDetailsHarness(null);
    await expect(service.getBranchDetails('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('an inactive branch is still returned when directly requested by id — no invented 404-on-inactive rule', async () => {
    const { service } = buildDetailsHarness({
      id: 'branch-1',
      address: 'X',
      latitude: 0,
      longitude: 0,
      isOpen: false,
      isActive: false,
      openingHours: {},
      ratingCount: 0,
      ratingSumStars: 0,
      vendor: { id: 'vendor-1', name: 'X', nameAr: null, logoUrl: null, isActive: false },
    });
    const result = await service.getBranchDetails('branch-1');
    expect(result.id).toBe('branch-1');
  });
});
