import { NotFoundException } from '@nestjs/common';
import { MarketplaceVendorsService } from './marketplace-vendors.service';

/**
 * Filters V1. `listBySector` now ALWAYS runs one extra batch query to
 * resolve each returned branch's real `hasOffer` value (see that
 * method's own comment) — every existing test in this file exercises
 * that path whether or not it cares about offers, so this stub must
 * exist everywhere, always answering "no branch has an active offer"
 * unless a specific test overrides it. Dedicated offer-filter/-sort
 * behavior is covered in its own new spec file, not here.
 */
function makeEmptyOffersRepository() {
  return {
    createQueryBuilder: jest.fn(() => ({
      select: () => ({
        where: () => ({
          andWhere: () => ({
            andWhere: () => ({
              andWhere: () => ({
                getRawMany: async () => [],
              }),
            }),
          }),
        }),
      }),
    })),
  };
}

function buildHarness(seed: { sectors?: any[]; branches?: any[] }) {
  const sectors = new Map((seed.sectors ?? []).map((s) => [s.id, s]));
  const allBranches = seed.branches ?? [];

  const sectorsRepository = {
    findOne: jest.fn(async (opts: any) => sectors.get(opts.where.id) ?? null),
  };

  function makeQb() {
    const qb: any = {
      _sectorId: undefined as string | undefined,
      _search: undefined as string | undefined,
      _sort: 'newest' as string,
      _skip: 0,
      _take: 1000,
      innerJoinAndSelect: () => qb,
      where: (_sql: string, params: any) => {
        qb._sectorId = params.sectorId;
        return qb;
      },
      andWhere: (sql: string, params?: any) => {
        if (sql.includes('ILIKE')) qb._search = (params.term as string).replace(/%/g, '').toLowerCase();
        if (sql.includes('rating_count >=')) qb._sort = 'highestRated';
        if (sql.includes('service_area_id')) qb._serviceAreaId = params.serviceAreaId;
        return qb;
      },
      orderBy: () => qb,
      addOrderBy: () => qb,
      offset: (n: number) => {
        qb._skip = n;
        return qb;
      },
      limit: (n: number) => {
        qb._take = n;
        return qb;
      },
      getManyAndCount: async () => {
        let filtered = allBranches.filter(
          (b: any) => b.marketplaceSectorId === qb._sectorId && b.isActive && b.vendor?.isActive,
        );
        if (qb._serviceAreaId) {
          filtered = filtered.filter((b: any) => b.serviceAreaId === qb._serviceAreaId);
        }
        if (qb._search) {
          filtered = filtered.filter((b: any) => (b.vendor.name as string).toLowerCase().includes(qb._search));
        }
        if (qb._sort === 'highestRated') {
          filtered = filtered.filter((b: any) => b.ratingCount >= 5);
          filtered = [...filtered].sort((a, b) => b.ratingSumStars / b.ratingCount - a.ratingSumStars / a.ratingCount);
        }
        const total = filtered.length;
        const page = filtered.slice(qb._skip, qb._skip + qb._take);
        return [page, total];
      },
    };
    return qb;
  }

  // `manager.query` answers the branch-closure lookup: no branch is under a closure in these tests.
  const branchesRepository = {
    manager: { query: jest.fn(async () => []) },
    createQueryBuilder: jest.fn(() => makeQb()),
  };

  // No coordinates sent in any existing test — resolveForPoint should
  // never be called; asserting that would be redundant, but the mock
  // fails loudly if it ever is, keeping the backward-compatibility
  // guarantee honest.
  const serviceAreaResolverService = {
    resolveForPoint: jest.fn(async () => {
      throw new Error('resolveForPoint should not be called when latitude/longitude are omitted');
    }),
  };
  // No test in this file exercises `subcategoryId` filtering (that's covered by
  // marketplace-vendors.service.subcategory.spec.ts) — this stub fails loudly if it's ever reached.
  const subcategoriesRepository = {
    findOne: jest.fn(async () => {
      throw new Error('subcategoriesRepository should not be queried when subcategoryId is omitted');
    }),
  };
  const service = new MarketplaceVendorsService(
    sectorsRepository as any,
    subcategoriesRepository as any,
    branchesRepository as any,
    makeEmptyOffersRepository() as any,
    serviceAreaResolverService as any,
  );
  return { service };
}

function makeBranch(overrides: Partial<any> = {}) {
  return {
    id: 'branch-1',
    marketplaceSectorId: 'sector-1',
    isActive: true,
    isOpen: true,
    ratingCount: 0,
    ratingSumStars: 0,
    vendor: { name: 'Pizza House', nameAr: null, logoUrl: null, isActive: true },
    ...overrides,
  };
}

describe('MarketplaceVendorsService.listBySector', () => {
  it('returns only branches belonging to the requested sector', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        makeBranch({ id: 'b1', marketplaceSectorId: 'sector-1' }),
        makeBranch({ id: 'b2', marketplaceSectorId: 'sector-2' }),
      ],
    });

    const result = await service.listBySector('sector-1');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('b1');
  });

  it('rejects a nonexistent sector', async () => {
    const { service } = buildHarness({ branches: [] });
    await expect(service.listBySector('missing')).rejects.toThrow(NotFoundException);
  });

  it('rejects an inactive sector — never silently returns an empty list for it', async () => {
    const { service } = buildHarness({ sectors: [{ id: 'sector-1', isActive: false }] });
    await expect(service.listBySector('sector-1')).rejects.toThrow(NotFoundException);
  });

  it('excludes an inactive VendorBranch even within the correct sector', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1', isActive: false })],
    });
    const result = await service.listBySector('sector-1');
    expect(result.data).toHaveLength(0);
  });

  it('excludes a branch whose Vendor is inactive', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1', vendor: { name: 'X', isActive: false } })],
    });
    const result = await service.listBySector('sector-1');
    expect(result.data).toHaveLength(0);
  });

  it('computes ratingAverage from the derived cache, 0 when no ratings exist', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1', ratingCount: 4, ratingSumStars: 18 })],
    });
    const result = await service.listBySector('sector-1');
    expect(result.data[0].ratingAverage).toBe(4.5);

    const { service: service2 } = buildHarness({
      sectors: [{ id: 'sector-2', isActive: true }],
      branches: [makeBranch({ id: 'b2', marketplaceSectorId: 'sector-2', ratingCount: 0, ratingSumStars: 0 })],
    });
    const result2 = await service2.listBySector('sector-2');
    expect(result2.data[0].ratingAverage).toBe(0);
  });

  it('MULTI-VENDOR: the same Vendor may have branches in different sectors, each filtered independently', async () => {
    const { service } = buildHarness({
      sectors: [
        { id: 'restaurants', isActive: true },
        { id: 'grocery', isActive: true },
      ],
      branches: [
        makeBranch({ id: 'b1', marketplaceSectorId: 'restaurants', vendor: { name: 'Vendor X', isActive: true } }),
        makeBranch({ id: 'b2', marketplaceSectorId: 'grocery', vendor: { name: 'Vendor X', isActive: true } }),
      ],
    });

    const restaurantResults = await service.listBySector('restaurants');
    const groceryResults = await service.listBySector('grocery');

    expect(restaurantResults.data).toHaveLength(1);
    expect(restaurantResults.data[0].id).toBe('b1');
    expect(groceryResults.data).toHaveLength(1);
    expect(groceryResults.data[0].id).toBe('b2');
  });

  it('never leaks a branch from Sector B into a request for Sector A', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-A', isActive: true }],
      branches: [makeBranch({ id: 'bB', marketplaceSectorId: 'sector-B' })],
    });
    const result = await service.listBySector('sector-A');
    expect(result.data).toHaveLength(0);
  });
});

describe('MarketplaceVendorsService — Discovery sort/search/pagination (Phase G)', () => {
  it('sort=highestRated excludes branches below the 5-rating threshold', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        makeBranch({ id: 'eligible', ratingCount: 5, ratingSumStars: 20 }),
        makeBranch({ id: 'not-eligible', ratingCount: 4, ratingSumStars: 20 }),
      ],
    });

    const result = await service.listBySector('sector-1', { sort: 'highestRated' });
    expect(result.data.map((b) => b.id)).toEqual(['eligible']);
  });

  it('sort=highestRated orders by average descending', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        makeBranch({ id: 'lower', ratingCount: 5, ratingSumStars: 15 }), // avg 3.0
        makeBranch({ id: 'higher', ratingCount: 5, ratingSumStars: 25 }), // avg 5.0
      ],
    });

    const result = await service.listBySector('sector-1', { sort: 'highestRated' });
    expect(result.data.map((b) => b.id)).toEqual(['higher', 'lower']);
  });

  it('default/newest sort does not apply the 5-rating threshold — a 0-rating branch is still visible', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1', ratingCount: 0, ratingSumStars: 0 })],
    });
    const result = await service.listBySector('sector-1');
    expect(result.data).toHaveLength(1);
  });

  it('search matches vendor name, case-insensitively, substring', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        makeBranch({ id: 'b1', vendor: { name: 'Pizza House', isActive: true } }),
        makeBranch({ id: 'b2', vendor: { name: 'Burger Place', isActive: true } }),
      ],
    });

    const result = await service.listBySector('sector-1', { search: 'pizza' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('b1');
  });

  it('a search term below the 2-character minimum is not applied — returns the normal unsearched result', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1', vendor: { name: 'Pizza House', isActive: true } })],
    });

    const result = await service.listBySector('sector-1', { search: 'p' });
    expect(result.data).toHaveLength(1); // not filtered out — the 1-char term was ignored
  });

  it('paginates results using page/limit and reports the correct total', async () => {
    const branches = [1, 2, 3].map((n) => makeBranch({ id: `b${n}` }));
    const { service } = buildHarness({ sectors: [{ id: 'sector-1', isActive: true }], branches });

    const result = await service.listBySector('sector-1', { page: 1, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('caps a garbage/malicious limit at the sanity ceiling', async () => {
    const { service } = buildHarness({ sectors: [{ id: 'sector-1', isActive: true }], branches: [makeBranch()] });
    const result = await service.listBySector('sector-1', { limit: 9999 });
    expect(result.limit).toBe(50);
  });
});

describe('MarketplaceVendorsService — ServiceArea filtering (Phase I-B)', () => {
  function buildServiceAreaHarness(opts: { sectors: any[]; branches: any[]; resolvedZone: any }) {
    const sectors = new Map(opts.sectors.map((s) => [s.id, s]));
    const sectorsRepository = { findOne: jest.fn(async (o: any) => sectors.get(o.where.id) ?? null) };

    function makeQb() {
      const qb: any = {
        _sectorId: undefined,
        _serviceAreaId: undefined,
        innerJoinAndSelect: () => qb,
        where: (_sql: string, params: any) => {
          qb._sectorId = params.sectorId;
          return qb;
        },
        andWhere: (sql: string, params?: any) => {
          if (sql.includes('service_area_id')) qb._serviceAreaId = params.serviceAreaId;
          return qb;
        },
        orderBy: () => qb,
        addOrderBy: () => qb,
        offset: () => qb,
        limit: () => qb,
        getManyAndCount: async () => {
          let filtered = opts.branches.filter((b: any) => b.marketplaceSectorId === qb._sectorId && b.isActive);
          if (qb._serviceAreaId) {
            filtered = filtered.filter((b: any) => b.serviceAreaId === qb._serviceAreaId);
          }
          return [filtered, filtered.length];
        },
      };
      return qb;
    }
    // `manager.query` answers the branch-closure lookup: no branch is under a closure in these tests.
  const branchesRepository = {
    manager: { query: jest.fn(async () => []) }, createQueryBuilder: jest.fn(() => makeQb()) };
    const serviceAreaResolverService = { resolveForPoint: jest.fn(async () => opts.resolvedZone) };
    const subcategoriesRepository = {
      findOne: jest.fn(async () => {
        throw new Error('subcategoriesRepository should not be queried when subcategoryId is omitted');
      }),
    };

    const service = new MarketplaceVendorsService(
      sectorsRepository as any,
      subcategoriesRepository as any,
      branchesRepository as any,
      makeEmptyOffersRepository() as any,
      serviceAreaResolverService as any,
    );
    return { service, serviceAreaResolverService };
  }

  it('a branch inside the customer resolved ServiceArea appears', async () => {
    const { service } = buildServiceAreaHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        { id: 'b1', marketplaceSectorId: 'sector-1', isActive: true, serviceAreaId: 'zone-1', vendor: { isActive: true, name: 'A' } },
      ],
      resolvedZone: { id: 'zone-1' },
    });
    const result = await service.listBySector('sector-1', { latitude: 30.42, longitude: 31.57 });
    expect(result.data.map((b) => b.id)).toEqual(['b1']);
  });

  it('a branch outside the customer resolved ServiceArea is excluded', async () => {
    const { service } = buildServiceAreaHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        { id: 'b1', marketplaceSectorId: 'sector-1', isActive: true, serviceAreaId: 'zone-OTHER', vendor: { isActive: true, name: 'A' } },
      ],
      resolvedZone: { id: 'zone-1' },
    });
    const result = await service.listBySector('sector-1', { latitude: 30.42, longitude: 31.57 });
    expect(result.data).toHaveLength(0);
  });

  it('a customer outside every active ServiceArea gets zero results, never an unfiltered fallback', async () => {
    const { service } = buildServiceAreaHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        { id: 'b1', marketplaceSectorId: 'sector-1', isActive: true, serviceAreaId: 'zone-1', vendor: { isActive: true, name: 'A' } },
      ],
      resolvedZone: null,
    });
    const result = await service.listBySector('sector-1', { latitude: 99, longitude: 99 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('coordinates omitted preserves the exact pre-existing unfiltered behavior', async () => {
    const { service, serviceAreaResolverService } = buildServiceAreaHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [
        { id: 'b1', marketplaceSectorId: 'sector-1', isActive: true, serviceAreaId: 'zone-1', vendor: { isActive: true, name: 'A' } },
        { id: 'b2', marketplaceSectorId: 'sector-1', isActive: true, serviceAreaId: null, vendor: { isActive: true, name: 'B' } },
      ],
      resolvedZone: { id: 'zone-1' },
    });
    const result = await service.listBySector('sector-1', {});
    expect(result.data.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(serviceAreaResolverService.resolveForPoint).not.toHaveBeenCalled();
  });
});
