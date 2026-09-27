import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminServiceAreasService } from './admin-service-areas.service';
import { ServiceAreaResolverService } from './service-area-resolver.service';

function buildAdminHarness(seed: { areas?: any[] } = {}) {
  const areas = new Map((seed.areas ?? []).map((a) => [a.id, a]));
  const repository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      areas.set(withId.id, withId);
      return withId;
    },
    find: async () => [...areas.values()],
    findOne: async (opts: any) => areas.get(opts.where.id) ?? null,
  };
  const service = new AdminServiceAreasService(repository as any);
  return { service, areas };
}

describe('AdminServiceAreasService', () => {
  it('creates a ServiceArea active by default (unlike Vendor/Branch — no onboarding-inactive rule applies here)', async () => {
    const { service } = buildAdminHarness();
    const area = await service.create({ name: 'Belbeis Center', centerLatitude: 30.42, centerLongitude: 31.57, radiusMeters: 8000 });
    expect(area.isActive).toBe(true);
    expect(area.radiusMeters).toBe(8000);
  });

  it('rejects getOne for a nonexistent area', async () => {
    const { service } = buildAdminHarness();
    await expect(service.getOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('update only touches provided fields', async () => {
    const { service } = buildAdminHarness({
      areas: [{ id: 'a1', name: 'Old', centerLatitude: 30, centerLongitude: 31, radiusMeters: 5000, isActive: true }],
    });
    const updated = await service.update('a1', { radiusMeters: 6000 });
    expect(updated.radiusMeters).toBe(6000);
    expect(updated.name).toBe('Old');
  });

  it('activate/deactivate toggle isActive without deleting the row', async () => {
    const { service, areas } = buildAdminHarness({
      areas: [{ id: 'a1', name: 'X', centerLatitude: 30, centerLongitude: 31, radiusMeters: 5000, isActive: true }],
    });
    await service.deactivate('a1');
    expect(areas.get('a1').isActive).toBe(false);
    expect(areas.has('a1')).toBe(true);
    await service.activate('a1');
    expect(areas.get('a1').isActive).toBe(true);
  });
});

describe('ServiceAreaResolverService (Haversine containment)', () => {
  function buildResolver(areas: any[]) {
    const repository = { find: jest.fn(async () => areas) };
    return { resolver: new ServiceAreaResolverService(repository as any), repository };
  }

  it('resolves a point inside an active zone', async () => {
    const { resolver } = buildResolver([
      { id: 'zone-1', centerLatitude: 30.42, centerLongitude: 31.57, radiusMeters: 8000, isActive: true },
    ]);
    // ~1km away, well within an 8km radius
    const result = await resolver.resolveForPoint(30.43, 31.57);
    expect(result?.id).toBe('zone-1');
  });

  it('returns null for a point outside every active zone', async () => {
    const { resolver } = buildResolver([
      { id: 'zone-1', centerLatitude: 30.42, centerLongitude: 31.57, radiusMeters: 1000, isActive: true },
    ]);
    // Roughly 100+ km away
    const result = await resolver.resolveForPoint(31.5, 32.5);
    expect(result).toBeNull();
  });

  it('queries only active zones (delegates isActive filtering to the repository query)', async () => {
    const { resolver, repository } = buildResolver([]);
    await resolver.resolveForPoint(30.42, 31.57);
    expect(repository.find).toHaveBeenCalledWith({ where: { isActive: true } });
  });

  it('picks the nearest zone when a point falls within multiple overlapping active zones', async () => {
    const { resolver } = buildResolver([
      { id: 'zone-far', centerLatitude: 30.5, centerLongitude: 31.5, radiusMeters: 50000, isActive: true },
      { id: 'zone-near', centerLatitude: 30.42, centerLongitude: 31.57, radiusMeters: 8000, isActive: true },
    ]);
    const result = await resolver.resolveForPoint(30.42, 31.57);
    expect(result?.id).toBe('zone-near');
  });
});
