import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminVendorsService } from './admin-vendors.service';

function buildHarness(seed: { vendors?: any[]; branches?: any[] } = {}) {
  const vendors = new Map((seed.vendors ?? []).map((v) => [v.id, v]));
  const branches = new Map((seed.branches ?? []).map((b) => [b.id, b]));

  const vendorsRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      vendors.set(withId.id, withId);
      return withId;
    },
    find: async () => [...vendors.values()],
    findOne: async (opts: any) => vendors.get(opts.where.id) ?? null,
  };

  const branchesRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      branches.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => {
      const all = [...branches.values()];
      if (opts?.where?.vendorId) return all.filter((b) => b.vendorId === opts.where.vendorId);
      return all;
    },
    findOne: async (opts: any) => branches.get(opts.where.id) ?? null,
  };

  const serviceAreasRepository = { findOne: jest.fn(async () => ({ id: 'default-service-area', isActive: true })) };
  const service = new AdminVendorsService(vendorsRepository as any, branchesRepository as any, serviceAreasRepository as any);
  return { service, vendors, branches };
}

function vendorDto(overrides: Partial<any> = {}) {
  return { name: 'Pizza House', ...overrides };
}

function branchDto(vendorId: string, overrides: Partial<any> = {}) {
  return { vendorId, name: 'Downtown Branch', address: '12 Market St', latitude: 30.1, longitude: 31.2, ...overrides };
}

describe('AdminVendorsService.createVendor', () => {
  it('creates a Vendor starting inactive — CONFIRMED, never auto-active', async () => {
    const { service } = buildHarness();
    const vendor = await service.createVendor(vendorDto());
    expect(vendor.isActive).toBe(false);
    expect(vendor.name).toBe('Pizza House');
  });

  it('never touches category or commissionPercent', async () => {
    const { service } = buildHarness();
    const vendor = await service.createVendor(vendorDto());
    expect(vendor.category).toBeUndefined();
    expect(vendor.commissionPercent).toBeUndefined();
  });

  it('defaults nameAr/logoUrl to null when omitted', async () => {
    const { service } = buildHarness();
    const vendor = await service.createVendor(vendorDto());
    expect(vendor.nameAr).toBeNull();
    expect(vendor.logoUrl).toBeNull();
  });
});

describe('AdminVendorsService — Vendor list/get/update/activate/deactivate', () => {
  it('rejects getVendor for a nonexistent vendor', async () => {
    const { service } = buildHarness();
    await expect(service.getVendor('missing')).rejects.toThrow(NotFoundException);
  });

  it('update only touches name/nameAr/logoUrl', async () => {
    const { service } = buildHarness({
      vendors: [{ id: 'v1', name: 'Old', nameAr: null, logoUrl: null, isActive: false }],
    });
    const updated = await service.updateVendor('v1', { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(updated.isActive).toBe(false); // untouched by update
  });

  it('activate flips isActive true, deactivate flips it back', async () => {
    const { service } = buildHarness({ vendors: [{ id: 'v1', name: 'X', isActive: false }] });
    const activated = await service.activateVendor('v1');
    expect(activated.isActive).toBe(true);
    const deactivated = await service.deactivateVendor('v1');
    expect(deactivated.isActive).toBe(false);
  });
});

describe('AdminVendorsService.createVendorBranch', () => {
  it('creates a branch starting inactive and closed, for an existing vendor', async () => {
    const { service } = buildHarness({ vendors: [{ id: 'v1', name: 'X', isActive: false }] });
    const branch = await service.createVendorBranch(branchDto('v1'));
    expect(branch.isActive).toBe(false);
    expect(branch.isOpen).toBe(false);
    expect(branch.vendorId).toBe('v1');
  });

  it('rejects creation for a nonexistent vendorId', async () => {
    const { service } = buildHarness();
    await expect(service.createVendorBranch(branchDto('missing-vendor'))).rejects.toThrow(BadRequestException);
  });

  it('defaults deliveryEnabled/pickupEnabled to true, commissionRateBasisPoints to null', async () => {
    const { service } = buildHarness({ vendors: [{ id: 'v1', name: 'X', isActive: false }] });
    const branch = await service.createVendorBranch(branchDto('v1'));
    expect(branch.deliveryEnabled).toBe(true);
    expect(branch.pickupEnabled).toBe(true);
    expect(branch.commissionRateBasisPoints).toBeNull();
  });

  it('accepts an explicit commissionRateBasisPoints — the real commission mechanism', async () => {
    const { service } = buildHarness({ vendors: [{ id: 'v1', name: 'X', isActive: false }] });
    const branch = await service.createVendorBranch(branchDto('v1', { commissionRateBasisPoints: 1500 }));
    expect(branch.commissionRateBasisPoints).toBe(1500);
  });
});

describe('AdminVendorsService — VendorBranch list/get/update/activate/deactivate', () => {
  it('lists branches filtered by vendorId', async () => {
    const { service } = buildHarness({
      vendors: [
        { id: 'v1', name: 'A', isActive: false },
        { id: 'v2', name: 'B', isActive: false },
      ],
      branches: [
        { id: 'b1', vendorId: 'v1', isActive: false, createdAt: new Date() },
        { id: 'b2', vendorId: 'v2', isActive: false, createdAt: new Date() },
      ],
    });
    const result = await service.listVendorBranches('v1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b1');
  });

  it('rejects getVendorBranch for a nonexistent branch', async () => {
    const { service } = buildHarness();
    await expect(service.getVendorBranch('missing')).rejects.toThrow(NotFoundException);
  });

  it('update never touches vendorId, isActive, isOpen, or marketplaceSectorId', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'b1', vendorId: 'v1', isActive: false, isOpen: false, marketplaceSectorId: null }],
    });
    const updated = await service.updateVendorBranch('b1', { name: 'New Branch Name' });
    expect(updated.vendorId).toBe('v1');
    expect(updated.isActive).toBe(false);
    expect(updated.isOpen).toBe(false);
    expect(updated.marketplaceSectorId).toBeNull();
  });

  it('activate/deactivate toggle isActive only', async () => {
    const { service } = buildHarness({ branches: [{ id: 'b1', vendorId: 'v1', isActive: false, isOpen: false }] });
    const activated = await service.activateVendorBranch('b1');
    expect(activated.isActive).toBe(true);
    expect(activated.isOpen).toBe(false); // untouched
    const deactivated = await service.deactivateVendorBranch('b1');
    expect(deactivated.isActive).toBe(false);
  });
});

describe('AdminVendorsService — VendorBranch ServiceArea assignment (Phase I-B)', () => {
  function buildServiceAreaHarness(opts: { branch: any; serviceAreas?: any[] }) {
    const branches = new Map([[opts.branch.id, opts.branch]]);
    const serviceAreas = new Map((opts.serviceAreas ?? []).map((a) => [a.id, a]));

    const vendorsRepository = { findOne: async () => null };
    const branchesRepository = {
      findOne: async (o: any) => branches.get(o.where.id) ?? null,
      save: async (entity: any) => {
        branches.set(entity.id, entity);
        return entity;
      },
    };
    const serviceAreasRepository = { findOne: async (o: any) => serviceAreas.get(o.where.id) ?? null };

    const service = new AdminVendorsService(vendorsRepository as any, branchesRepository as any, serviceAreasRepository as any);
    return { service, branches };
  }

  it('accepts a valid, active ServiceArea assignment', async () => {
    const { service } = buildServiceAreaHarness({
      branch: { id: 'b1', vendorId: 'v1', isActive: false },
      serviceAreas: [{ id: 'zone-1', isActive: true }],
    });
    const updated = await service.updateVendorBranch('b1', { serviceAreaId: 'zone-1' });
    expect(updated.serviceAreaId).toBe('zone-1');
  });

  it('rejects an invalid (nonexistent) ServiceArea', async () => {
    const { service } = buildServiceAreaHarness({ branch: { id: 'b1', vendorId: 'v1', isActive: false } });
    await expect(service.updateVendorBranch('b1', { serviceAreaId: 'missing-zone' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an inactive ServiceArea', async () => {
    const { service } = buildServiceAreaHarness({
      branch: { id: 'b1', vendorId: 'v1', isActive: false },
      serviceAreas: [{ id: 'zone-1', isActive: false }],
    });
    await expect(service.updateVendorBranch('b1', { serviceAreaId: 'zone-1' })).rejects.toThrow(BadRequestException);
  });

  it('preserves existing branch behavior — updating other fields never requires a ServiceArea lookup', async () => {
    const { service, branches } = buildServiceAreaHarness({
      branch: { id: 'b1', vendorId: 'v1', isActive: false, name: 'Old', serviceAreaId: null },
    });
    const updated = await service.updateVendorBranch('b1', { name: 'New Name' });
    expect(updated.name).toBe('New Name');
    expect(branches.get('b1').serviceAreaId).toBeNull(); // untouched
  });
});
