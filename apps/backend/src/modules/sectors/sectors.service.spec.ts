import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SectorsService } from './sectors.service';
import { CreateSectorDto } from './dto/create-sector.dto';

function buildHarness(seed: { sectors?: any[]; branches?: any[] }) {
  const sectors = new Map((seed.sectors ?? []).map((s) => [s.id, s]));
  const branches = new Map((seed.branches ?? []).map((b) => [b.id, b]));

  const sectorsRepository = {
    find: jest.fn(async (opts: any) => {
      let list = [...sectors.values()];
      if (opts?.where?.isActive !== undefined) list = list.filter((s) => s.isActive === opts.where.isActive);
      if (opts?.where?.slug !== undefined) list = list.filter((s) => s.slug === opts.where.slug);
      return list.sort((a, b) => a.sortOrder - b.sortOrder);
    }),
    findOne: jest.fn(async (opts: any) => {
      if (opts.where.id) return sectors.get(opts.where.id) ?? null;
      if (opts.where.slug !== undefined) return [...sectors.values()].find((s) => s.slug === opts.where.slug) ?? null;
      return null;
    }),
    create: (data: any) => ({ ...data }),
    save: jest.fn(async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      sectors.set(withId.id, withId);
      return withId;
    }),
  };

  const branchesRepository = {
    findOne: jest.fn(async (opts: any) => branches.get(opts.where.id) ?? null),
    save: jest.fn(async (entity: any) => {
      branches.set(entity.id, entity);
      return entity;
    }),
  };

  const service = new SectorsService(sectorsRepository as any, branchesRepository as any);
  return { service, sectors, branches };
}

function baseDto(overrides: Partial<CreateSectorDto> = {}): CreateSectorDto {
  return { name: 'Restaurants', nameAr: 'مطاعم', slug: 'restaurants', ...overrides } as CreateSectorDto;
}

describe('SectorsService.create', () => {
  it('creates a sector with defaults (sortOrder 0, isActive true, imageUrl null)', async () => {
    const { service, sectors } = buildHarness({});
    const sector = await service.create(baseDto());
    expect(sector.sortOrder).toBe(0);
    expect(sector.isActive).toBe(true);
    expect(sector.imageUrl).toBeNull();
    expect(sectors.size).toBe(1);
  });

  it('Part F (Marketplace image/asset readiness): accepts an optional imageUrl', async () => {
    const { service } = buildHarness({});
    const sector = await service.create(baseDto({ imageUrl: 'https://cdn.hatly.example/sectors/restaurants.png' } as any));
    expect(sector.imageUrl).toBe('https://cdn.hatly.example/sectors/restaurants.png');
  });

  it('rejects a duplicate slug', async () => {
    const { service } = buildHarness({ sectors: [{ id: 's1', slug: 'restaurants', isActive: true, sortOrder: 0 }] });
    await expect(service.create(baseDto({ slug: 'restaurants' }))).rejects.toThrow(ConflictException);
  });

  it('allows two different slugs', async () => {
    const { service, sectors } = buildHarness({});
    await service.create(baseDto({ slug: 'restaurants' }));
    await service.create(baseDto({ slug: 'grocery', name: 'Grocery' }));
    expect(sectors.size).toBe(2);
  });
});

describe('SectorsService — list/get/update/activate/deactivate', () => {
  it('listAllForAdmin returns every sector including inactive ones, ordered by sortOrder', async () => {
    const { service } = buildHarness({
      sectors: [
        { id: 's1', slug: 'b', isActive: false, sortOrder: 2 },
        { id: 's2', slug: 'a', isActive: true, sortOrder: 1 },
      ],
    });
    const all = await service.listAllForAdmin();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('s2'); // sortOrder 1 first
  });

  it('listActiveForCustomers excludes inactive sectors', async () => {
    const { service } = buildHarness({
      sectors: [
        { id: 's1', slug: 'a', isActive: true, sortOrder: 1 },
        { id: 's2', slug: 'b', isActive: false, sortOrder: 2 },
      ],
    });
    const active = await service.listActiveForCustomers();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('s1');
  });

  it('getOne rejects a non-existent sector', async () => {
    const { service } = buildHarness({});
    await expect(service.getOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('update only touches name/nameAr/sortOrder/imageUrl, never slug or isActive', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 's1', slug: 'restaurants', name: 'Old', isActive: true, sortOrder: 0 }],
    });
    const updated = await service.update('s1', { name: 'Restaurants Updated', sortOrder: 5, imageUrl: 'https://cdn.example/x.png' });
    expect(updated.name).toBe('Restaurants Updated');
    expect(updated.sortOrder).toBe(5);
    expect(updated.imageUrl).toBe('https://cdn.example/x.png');
    expect(updated.slug).toBe('restaurants'); // untouched — UpdateSectorDto has no slug field at all
    expect(updated.isActive).toBe(true);
  });

  it('deactivate flips isActive false without touching any assigned VendorBranch', async () => {
    const { service, branches } = buildHarness({
      sectors: [{ id: 's1', slug: 'restaurants', isActive: true, sortOrder: 0 }],
      branches: [{ id: 'b1', marketplaceSectorId: 's1', isActive: true }],
    });
    const deactivated = await service.deactivate('s1');
    expect(deactivated.isActive).toBe(false);
    expect(branches.get('b1').marketplaceSectorId).toBe('s1'); // FK never nulled/corrupted
  });

  it('activate flips isActive back to true', async () => {
    const { service } = buildHarness({ sectors: [{ id: 's1', slug: 'restaurants', isActive: false, sortOrder: 0 }] });
    const activated = await service.activate('s1');
    expect(activated.isActive).toBe(true);
  });
});

describe('SectorsService.assignBranchSector', () => {
  it('assigns a valid, active sector to a branch', async () => {
    const { service, branches } = buildHarness({
      sectors: [{ id: 's1', slug: 'restaurants', isActive: true, sortOrder: 0 }],
      branches: [{ id: 'b1', marketplaceSectorId: null, isActive: true }],
    });
    const branch = await service.assignBranchSector('b1', 's1');
    expect(branch.marketplaceSectorId).toBe('s1');
    expect(branches.get('b1').marketplaceSectorId).toBe('s1');
  });

  it('rejects assignment to a nonexistent sector', async () => {
    const { service } = buildHarness({ branches: [{ id: 'b1', isActive: true }] });
    await expect(service.assignBranchSector('b1', 'missing-sector')).rejects.toThrow(NotFoundException);
  });

  it('rejects assignment to an inactive sector', async () => {
    const { service } = buildHarness({
      sectors: [{ id: 's1', slug: 'restaurants', isActive: false, sortOrder: 0 }],
      branches: [{ id: 'b1', isActive: true }],
    });
    await expect(service.assignBranchSector('b1', 's1')).rejects.toThrow(BadRequestException);
  });

  it('rejects assignment to a soft-deleted sector (excluded by findOne, same as nonexistent)', async () => {
    // A soft-deleted row is simply absent from the harness's `sectors`
    // map — mirrors TypeORM's own @DeleteDateColumn default filtering.
    const { service } = buildHarness({ branches: [{ id: 'b1', isActive: true }] });
    await expect(service.assignBranchSector('b1', 'soft-deleted-sector-id')).rejects.toThrow(NotFoundException);
  });

  it('rejects assignment for a nonexistent branch', async () => {
    const { service } = buildHarness({ sectors: [{ id: 's1', slug: 'restaurants', isActive: true, sortOrder: 0 }] });
    await expect(service.assignBranchSector('missing-branch', 's1')).rejects.toThrow(NotFoundException);
  });

  it('changing a branch\'s sector overwrites the previous one — exactly one sector at a time', async () => {
    const { service, branches } = buildHarness({
      sectors: [
        { id: 's1', slug: 'restaurants', isActive: true, sortOrder: 0 },
        { id: 's2', slug: 'grocery', isActive: true, sortOrder: 1 },
      ],
      branches: [{ id: 'b1', marketplaceSectorId: 's1', isActive: true }],
    });
    await service.assignBranchSector('b1', 's2');
    expect(branches.get('b1').marketplaceSectorId).toBe('s2');
  });
});
