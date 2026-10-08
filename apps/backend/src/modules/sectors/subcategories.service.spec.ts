import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SubcategoriesService } from './subcategories.service';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';

function buildHarness(seed: {
  sectors?: any[];
  subcategories?: any[];
  branches?: any[];
  branchSubcategories?: Array<{ vendorBranchId: string; subcategoryId: string }>;
}) {
  const sectors = new Map((seed.sectors ?? []).map((s) => [s.id, s]));
  const subcategories = new Map((seed.subcategories ?? []).map((s) => [s.id, s]));
  const branches = new Map((seed.branches ?? []).map((b) => [b.id, b]));
  const branchSubcategories = [...(seed.branchSubcategories ?? [])];

  const sectorsRepository = {
    findOne: jest.fn(async (opts: any) => sectors.get(opts.where.id) ?? null),
  };

  const subcategoriesRepository = {
    find: jest.fn(async (opts: any) => {
      let list = [...subcategories.values()];
      if (opts?.where?.sectorId !== undefined) list = list.filter((s) => s.sectorId === opts.where.sectorId);
      if (opts?.where?.isActive !== undefined) list = list.filter((s) => s.isActive === opts.where.isActive);
      return list.sort((a, b) => a.sortOrder - b.sortOrder);
    }),
    findOne: jest.fn(async (opts: any) => subcategories.get(opts.where.id) ?? null),
    create: (data: any) => ({ ...data }),
    save: jest.fn(async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      subcategories.set(withId.id, withId);
      return withId;
    }),
    createQueryBuilder: jest.fn(() => {
      let ids: string[] = [];
      const qb: any = {
        where: (_sql: string, params: any) => {
          ids = params.ids;
          return qb;
        },
        getMany: async () => ids.map((id) => subcategories.get(id)).filter(Boolean),
      };
      return qb;
    }),
  };

  const branchesRepository = {
    findOne: jest.fn(async (opts: any) => branches.get(opts.where.id) ?? null),
  };

  const branchSubcategoriesRepository = {
    delete: jest.fn(async (criteria: any) => {
      for (let i = branchSubcategories.length - 1; i >= 0; i--) {
        if (branchSubcategories[i].vendorBranchId === criteria.vendorBranchId) branchSubcategories.splice(i, 1);
      }
    }),
    insert: jest.fn(async (rows: Array<{ vendorBranchId: string; subcategoryId: string }>) => {
      branchSubcategories.push(...rows);
    }),
  };

  const service = new SubcategoriesService(
    subcategoriesRepository as any,
    sectorsRepository as any,
    branchesRepository as any,
    branchSubcategoriesRepository as any,
  );
  return { service, sectors, subcategories, branches, branchSubcategories };
}

function baseDto(overrides: Partial<CreateSubcategoryDto> = {}): CreateSubcategoryDto {
  return { sectorId: 'sector-1', name: 'Burgers', nameAr: 'برجر', ...overrides } as CreateSubcategoryDto;
}

describe('SubcategoriesService.create', () => {
  it('creates a subcategory with defaults (sortOrder 0, isActive true)', async () => {
    const { service, subcategories } = buildHarness({ sectors: [{ id: 'sector-1', isActive: true }] });
    const subcategory = await service.create(baseDto());
    expect(subcategory.sortOrder).toBe(0);
    expect(subcategory.isActive).toBe(true);
    expect(subcategory.sectorId).toBe('sector-1');
    expect(subcategories.size).toBe(1);
  });

  it('rejects creation under a nonexistent sector', async () => {
    const { service } = buildHarness({});
    await expect(service.create(baseDto({ sectorId: 'missing' }))).rejects.toThrow(NotFoundException);
  });
});

describe('SubcategoriesService — list/get/update/activate/deactivate', () => {
  it('listAllForAdmin returns every subcategory including inactive ones, optionally scoped to a sector', async () => {
    const { service } = buildHarness({
      subcategories: [
        { id: 'sc1', sectorId: 'sector-1', isActive: false, sortOrder: 2 },
        { id: 'sc2', sectorId: 'sector-1', isActive: true, sortOrder: 1 },
        { id: 'sc3', sectorId: 'sector-2', isActive: true, sortOrder: 0 },
      ],
    });
    const all = await service.listAllForAdmin();
    expect(all).toHaveLength(3);
    const scoped = await service.listAllForAdmin('sector-1');
    expect(scoped).toHaveLength(2);
    expect(scoped[0].id).toBe('sc2'); // sortOrder 1 first
  });

  it('listActiveForSector excludes inactive subcategories and re-verifies the sector is active', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: true }],
      subcategories: [
        { id: 'sc1', sectorId: 'sector-1', isActive: true, sortOrder: 0 },
        { id: 'sc2', sectorId: 'sector-1', isActive: false, sortOrder: 1 },
        { id: 'sc3', sectorId: 'sector-2', isActive: true, sortOrder: 0 },
      ],
    });
    const active = await service.listActiveForSector('sector-1');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('sc1');
  });

  it('listActiveForSector rejects a nonexistent sector', async () => {
    const { service } = buildHarness({});
    await expect(service.listActiveForSector('missing')).rejects.toThrow(NotFoundException);
  });

  it('listActiveForSector rejects a deactivated sector — its subcategories must never surface on their own', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 'sector-1', isActive: false }],
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', isActive: true, sortOrder: 0 }],
    });
    await expect(service.listActiveForSector('sector-1')).rejects.toThrow(NotFoundException);
  });

  it('getOne rejects a non-existent subcategory', async () => {
    const { service } = buildHarness({});
    await expect(service.getOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('update only touches name/nameAr/imageUrl/sortOrder, never sectorId or isActive', async () => {
    const { service } = buildHarness({
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', name: 'Old', isActive: true, sortOrder: 0 }],
    });
    const updated = await service.update('sc1', { name: 'Burgers Updated', sortOrder: 5 });
    expect(updated.name).toBe('Burgers Updated');
    expect(updated.sortOrder).toBe(5);
    expect(updated.sectorId).toBe('sector-1'); // untouched — UpdateSubcategoryDto has no sectorId field
    expect(updated.isActive).toBe(true);
  });

  it('deactivate/activate flip isActive', async () => {
    const { service } = buildHarness({
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', isActive: true, sortOrder: 0 }],
    });
    const deactivated = await service.deactivate('sc1');
    expect(deactivated.isActive).toBe(false);
    const activated = await service.activate('sc1');
    expect(activated.isActive).toBe(true);
  });
});

describe('SubcategoriesService.setBranchSubcategories', () => {
  it('assigns a fresh set of valid, same-sector subcategories to a branch', async () => {
    const { service, branchSubcategories } = buildHarness({
      subcategories: [
        { id: 'sc1', sectorId: 'sector-1', isActive: true, sortOrder: 0 },
        { id: 'sc2', sectorId: 'sector-1', isActive: true, sortOrder: 1 },
      ],
      branches: [{ id: 'b1', marketplaceSectorId: 'sector-1', isActive: true }],
    });
    const result = await service.setBranchSubcategories('b1', ['sc1', 'sc2']);
    expect(result.map((s) => s.id).sort()).toEqual(['sc1', 'sc2']);
    expect(branchSubcategories).toHaveLength(2);
  });

  it('replaces a previous set entirely rather than merging with it', async () => {
    const { service, branchSubcategories } = buildHarness({
      subcategories: [
        { id: 'sc1', sectorId: 'sector-1', isActive: true, sortOrder: 0 },
        { id: 'sc2', sectorId: 'sector-1', isActive: true, sortOrder: 1 },
      ],
      branches: [{ id: 'b1', marketplaceSectorId: 'sector-1', isActive: true }],
      branchSubcategories: [{ vendorBranchId: 'b1', subcategoryId: 'sc1' }],
    });
    await service.setBranchSubcategories('b1', ['sc2']);
    expect(branchSubcategories).toEqual([{ vendorBranchId: 'b1', subcategoryId: 'sc2' }]);
  });

  it('allows clearing every subcategory assignment with an empty array', async () => {
    const { service, branchSubcategories } = buildHarness({
      branches: [{ id: 'b1', marketplaceSectorId: 'sector-1', isActive: true }],
      branchSubcategories: [{ vendorBranchId: 'b1', subcategoryId: 'sc1' }],
    });
    const result = await service.setBranchSubcategories('b1', []);
    expect(result).toEqual([]);
    expect(branchSubcategories).toEqual([]);
  });

  it('rejects a nonexistent branch', async () => {
    const { service } = buildHarness({});
    await expect(service.setBranchSubcategories('missing', [])).rejects.toThrow(NotFoundException);
  });

  it('rejects a nonexistent subcategory id', async () => {
    const { service } = buildHarness({ branches: [{ id: 'b1', marketplaceSectorId: 'sector-1', isActive: true }] });
    await expect(service.setBranchSubcategories('b1', ['missing-sc'])).rejects.toThrow(NotFoundException);
  });

  it('rejects a subcategory belonging to a different sector than the branch\'s own', async () => {
    const { service } = buildHarness({
      subcategories: [{ id: 'sc1', sectorId: 'sector-2', isActive: true, sortOrder: 0 }],
      branches: [{ id: 'b1', marketplaceSectorId: 'sector-1', isActive: true }],
    });
    await expect(service.setBranchSubcategories('b1', ['sc1'])).rejects.toThrow(BadRequestException);
  });

  it('deduplicates repeated ids in the request', async () => {
    const { service, branchSubcategories } = buildHarness({
      subcategories: [{ id: 'sc1', sectorId: 'sector-1', isActive: true, sortOrder: 0 }],
      branches: [{ id: 'b1', marketplaceSectorId: 'sector-1', isActive: true }],
    });
    await service.setBranchSubcategories('b1', ['sc1', 'sc1']);
    expect(branchSubcategories).toHaveLength(1);
  });
});
