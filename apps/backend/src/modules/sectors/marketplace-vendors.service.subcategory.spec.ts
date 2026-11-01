import { NotFoundException } from '@nestjs/common';
import { MarketplaceVendorsService } from './marketplace-vendors.service';

/**
 * Consolidated customer-commerce milestone (Part E — Sector
 * Subcategories): dedicated spec for the new `subcategoryId` filter on
 * `listBySector`, kept separate from the pre-existing
 * `marketplace-vendors.service.spec.ts` harness (which deliberately
 * fails loudly if `subcategoriesRepository` is ever queried, proving
 * the omitted-filter case stays byte-for-byte backward compatible).
 */
function buildHarness(seed: {
  sectors?: any[];
  subcategories?: any[];
  branches?: any[];
  branchSubcategories?: Array<{ vendorBranchId: string; subcategoryId: string }>;
}) {
  const sectors = new Map((seed.sectors ?? []).map((s) => [s.id, s]));
  const subcategories = new Map((seed.subcategories ?? []).map((s) => [s.id, s]));
  const allBranches = seed.branches ?? [];
  const branchSubcategories = seed.branchSubcategories ?? [];

  const sectorsRepository = {
    findOne: jest.fn(async (opts: any) => sectors.get(opts.where.id) ?? null),
  };
  const subcategoriesRepository = {
    findOne: jest.fn(async (opts: any) => subcategories.get(opts.where.id) ?? null),
  };

  function makeQb() {
    const qb: any = {
      _sectorId: undefined as string | undefined,
      _subcategoryId: undefined as string | undefined,
      innerJoinAndSelect: () => qb,
      where: (_sql: string, params: any) => {
        qb._sectorId = params.sectorId;
        return qb;
      },
      andWhere: (sql: string, params?: any) => {
        if (sql.includes('vendor_branch_subcategories')) qb._subcategoryId = params.subcategoryId;
        return qb;
      },
      orderBy: () => qb,
      addOrderBy: () => qb,
      offset: () => qb,
      limit: () => qb,
      getManyAndCount: async () => {
        let filtered = allBranches.filter((b: any) => b.marketplaceSectorId === qb._sectorId && b.isActive && b.vendor?.isActive);
        if (qb._subcategoryId) {
          filtered = filtered.filter((b: any) =>
            branchSubcategories.some((row) => row.vendorBranchId === b.id && row.subcategoryId === qb._subcategoryId),
          );
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
  // Filters V1: `listBySector` always batch-resolves `hasOffer` for the returned page —
  // this file doesn't exercise offers, so it always answers "no active offers."
  const offersRepository = {
    createQueryBuilder: jest.fn(() => ({
      select: () => ({ where: () => ({ andWhere: () => ({ andWhere: () => ({ andWhere: () => ({ getRawMany: async () => [] }) }) }) }) }),
    })),
  };

  const service = new MarketplaceVendorsService(
    sectorsRepository as any,
    subcategoriesRepository as any,
    branchesRepository as any,
    offersRepository as any,
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

describe('MarketplaceVendorsService.listBySector — subcategoryId filter', () => {
  it('with no subcategoryId, returns every branch in the sector — unchanged pre-existing behavior', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1' }), makeBranch({ id: 'b2' })],
    });
    const result = await service.listBySector('sector-1');
    expect(result.data.map((v) => v.id).sort()).toEqual(['b1', 'b2']);
  });

  it('with a subcategoryId, returns only branches assigned to it', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1' }), makeBranch({ id: 'b2' })],
      branchSubcategories: [{ vendorBranchId: 'b1', subcategoryId: 'sc1' }],
    });
    const result = await service.listBySector('sector-1', { subcategoryId: 'sc1' });
    expect(result.data.map((v) => v.id)).toEqual(['b1']);
  });

  it('a branch assigned to the subcategory under a DIFFERENT sector never leaks in — the query is still sector-scoped first', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', isActive: true }],
      branches: [makeBranch({ id: 'b1', marketplaceSectorId: 'sector-2' })],
      branchSubcategories: [{ vendorBranchId: 'b1', subcategoryId: 'sc1' }],
    });
    const result = await service.listBySector('sector-1', { subcategoryId: 'sc1' });
    expect(result.data).toEqual([]);
  });

  it('rejects a nonexistent subcategoryId', async () => {
    const { service } = buildHarness({ sectors: [{ id: 'sector-1', isActive: true }] });
    await expect(service.listBySector('sector-1', { subcategoryId: 'missing' })).rejects.toThrow(NotFoundException);
  });

  it('rejects a subcategoryId belonging to a different sector than the one being browsed', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      subcategories: [{ id: 'sc1', sectorId: 'sector-2', isActive: true }],
    });
    await expect(service.listBySector('sector-1', { subcategoryId: 'sc1' })).rejects.toThrow(NotFoundException);
  });

  it('rejects an inactive subcategoryId', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', isActive: false }],
    });
    await expect(service.listBySector('sector-1', { subcategoryId: 'sc1' })).rejects.toThrow(NotFoundException);
  });
});
