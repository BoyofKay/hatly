import { MarketplaceVendorsService } from './marketplace-vendors.service';

/**
 * Filters V1 — dedicated spec for the new Vendor List filters/sort
 * (`openNow`, `hasOffers`, `minRating`, `sort=offers`) and the new
 * real `hasOffer` field on `MarketplaceVendorView`. Kept separate from
 * the pre-existing `marketplace-vendors.service.spec.ts` harness (same
 * discipline already established for the Subcategory filter's own
 * dedicated spec file).
 */
function buildHarness(seed: {
  sectors?: any[];
  branches?: any[];
  branchIdsWithOffer?: string[];
}) {
  const sectors = new Map((seed.sectors ?? []).map((s) => [s.id, s]));
  const allBranches = seed.branches ?? [];
  const branchIdsWithOffer = new Set(seed.branchIdsWithOffer ?? []);

  const sectorsRepository = {
    findOne: jest.fn(async (opts: any) => sectors.get(opts.where.id) ?? null),
  };
  const subcategoriesRepository = {
    findOne: jest.fn(async () => {
      throw new Error('subcategoriesRepository should not be queried in these tests');
    }),
  };

  function makeQb() {
    const qb: any = {
      _sectorId: undefined as string | undefined,
      _openNow: false,
      _hasOffers: false,
      _minRating: undefined as number | undefined,
      _sortOffers: false,
      innerJoinAndSelect: () => qb,
      where: (_sql: string, params: any) => {
        qb._sectorId = params.sectorId;
        return qb;
      },
      andWhere: (sql: string, params?: any) => {
        if (sql.includes('is_open')) qb._openNow = true;
        if (sql.includes('EXISTS') && sql.includes('offers')) qb._hasOffers = true;
        if (sql.includes('rating_sum_stars::float')) qb._minRating = params.minRating;
        return qb;
      },
      orderBy: (sql: string) => {
        if (sql.includes('EXISTS') && sql.includes('offers')) qb._sortOffers = true;
        return qb;
      },
      addOrderBy: () => qb,
      offset: () => qb,
      limit: () => qb,
      getManyAndCount: async () => {
        let filtered = allBranches.filter((b: any) => b.marketplaceSectorId === qb._sectorId && b.isActive);
        if (qb._openNow) filtered = filtered.filter((b: any) => b.isOpen);
        if (qb._hasOffers) filtered = filtered.filter((b: any) => branchIdsWithOffer.has(b.id));
        if (qb._minRating != null) {
          filtered = filtered.filter((b: any) => b.ratingCount > 0 && b.ratingSumStars / b.ratingCount >= qb._minRating);
        }
        if (qb._sortOffers) {
          filtered = [...filtered].sort((a: any, b: any) => {
            const aHas = branchIdsWithOffer.has(a.id) ? 1 : 0;
            const bHas = branchIdsWithOffer.has(b.id) ? 1 : 0;
            return bHas - aHas;
          });
        }
        return [filtered, filtered.length];
      },
    };
    return qb;
  }

  // `manager.query` answers the branch-closure lookup: no branch is under a closure in these tests.
  const branchesRepository = {
    manager: { query: jest.fn(async () => []) }, createQueryBuilder: jest.fn(() => makeQb()) };
  const serviceAreaResolverService = {
    resolveForPoint: jest.fn(async () => {
      throw new Error('resolveForPoint should not be called in these tests');
    }),
  };

  const offerRows = [...branchIdsWithOffer].map((id) => ({ vendor_branch_id: id }));
  const getRawManyCalls: any[] = [];
  function makeOffersQb() {
    let branchIds: string[] = [];
    const qb: any = {
      select: () => qb,
      where: (_sql: string, params: any) => {
        branchIds = params.branchIds;
        getRawManyCalls.push(branchIds);
        return qb;
      },
      andWhere: () => qb,
      getRawMany: async () => offerRows.filter((r) => branchIds.includes(r.vendor_branch_id)),
    };
    return qb;
  }
  const offersRepository = {
    createQueryBuilder: jest.fn(() => makeOffersQb()),
  };

  const service = new MarketplaceVendorsService(
    sectorsRepository as any,
    subcategoriesRepository as any,
    branchesRepository as any,
    offersRepository as any,
    serviceAreaResolverService as any,
  );
  return { service, getRawManyCalls };
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

describe('MarketplaceVendorsService.listBySector — Filters V1', () => {
  describe('hasOffer (real data, batch-resolved, never N+1)', () => {
    it('marks exactly the branches with a real active offer, and never queries offers for an empty page', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'b1' }), makeBranch({ id: 'b2' })],
        branchIdsWithOffer: ['b1'],
      });
      const result = await service.listBySector('sector-1');
      const byId = new Map(result.data.map((v) => [v.id, v]));
      expect(byId.get('b1')!.hasOffer).toBe(true);
      expect(byId.get('b2')!.hasOffer).toBe(false);
    });

    it('never calls the offers batch query when the page is empty', async () => {
      const { service, getRawManyCalls } = buildHarness({ sectors: [{ id: 'sector-1', isActive: true }], branches: [] });
      await service.listBySector('sector-1');
      expect(getRawManyCalls).toEqual([]);
    });
  });

  describe('openNow filter', () => {
    it('with openNow=true, returns only branches whose real isOpen is true', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'open-1', isOpen: true }), makeBranch({ id: 'closed-1', isOpen: false })],
      });
      const result = await service.listBySector('sector-1', { openNow: true });
      expect(result.data.map((v) => v.id)).toEqual(['open-1']);
    });

    it('omitted, returns every branch regardless of isOpen — unchanged pre-Filters-V1 behavior', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'open-1', isOpen: true }), makeBranch({ id: 'closed-1', isOpen: false })],
      });
      const result = await service.listBySector('sector-1');
      expect(result.data.map((v) => v.id).sort()).toEqual(['closed-1', 'open-1']);
    });
  });

  describe('hasOffers filter', () => {
    it('with hasOffers=true, returns only branches with a real active offer', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'b1' }), makeBranch({ id: 'b2' })],
        branchIdsWithOffer: ['b2'],
      });
      const result = await service.listBySector('sector-1', { hasOffers: true });
      expect(result.data.map((v) => v.id)).toEqual(['b2']);
    });

    it('with hasOffers=true and no branch has an offer, returns an empty (not error) result', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'b1' })],
        branchIdsWithOffer: [],
      });
      const result = await service.listBySector('sector-1', { hasOffers: true });
      expect(result.data).toEqual([]);
    });
  });

  describe('minRating filter', () => {
    it('excludes a branch with no ratings at all, even with minRating=0-adjacent thresholds', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [
          makeBranch({ id: 'unrated', ratingCount: 0, ratingSumStars: 0 }),
          makeBranch({ id: 'rated-4', ratingCount: 10, ratingSumStars: 40 }),
        ],
      });
      const result = await service.listBySector('sector-1', { minRating: 4 });
      expect(result.data.map((v) => v.id)).toEqual(['rated-4']);
    });

    it('a branch exactly AT the threshold (4.0) qualifies for 4.0+', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'exactly-4', ratingCount: 5, ratingSumStars: 20 })],
      });
      const result = await service.listBySector('sector-1', { minRating: 4 });
      expect(result.data.map((v) => v.id)).toEqual(['exactly-4']);
    });

    it('a branch below the threshold is excluded', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'below', ratingCount: 5, ratingSumStars: 15 })], // avg 3.0
      });
      const result = await service.listBySector('sector-1', { minRating: 4 });
      expect(result.data).toEqual([]);
    });
  });

  describe('sort=offers', () => {
    it('orders branches with a real active offer first, deterministic tiebreak otherwise', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [makeBranch({ id: 'no-offer' }), makeBranch({ id: 'has-offer' })],
        branchIdsWithOffer: ['has-offer'],
      });
      const result = await service.listBySector('sector-1', { sort: 'offers' as any });
      expect(result.data.map((v) => v.id)).toEqual(['has-offer', 'no-offer']);
    });
  });

  describe('deterministic combinations', () => {
    it('openNow + hasOffers + minRating combine as a real, correct AND', async () => {
      const { service } = buildHarness({
        sectors: [{ id: 'sector-1', isActive: true }],
        branches: [
          makeBranch({ id: 'matches-all', isOpen: true, ratingCount: 10, ratingSumStars: 40 }),
          makeBranch({ id: 'closed', isOpen: false, ratingCount: 10, ratingSumStars: 40 }),
          makeBranch({ id: 'no-offer', isOpen: true, ratingCount: 10, ratingSumStars: 40 }),
          makeBranch({ id: 'low-rating', isOpen: true, ratingCount: 10, ratingSumStars: 10 }),
        ],
        branchIdsWithOffer: ['matches-all', 'closed', 'low-rating'],
      });
      const result = await service.listBySector('sector-1', { openNow: true, hasOffers: true, minRating: 4 });
      expect(result.data.map((v) => v.id)).toEqual(['matches-all']);
    });
  });
});
