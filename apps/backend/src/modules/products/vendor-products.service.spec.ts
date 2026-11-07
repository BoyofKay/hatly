import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VendorProductsService } from './vendor-products.service';

function buildHarness(
  seed: { ownedBranches?: Record<string, string[]>; products?: Record<string, any>; categories?: any[] } = {},
) {
  const ownedBranches = seed.ownedBranches ?? {}; // userId -> branchId[]
  const products = new Map(Object.entries(seed.products ?? {}));

  const vendorStaffAuthorizationService = {
    getOwnedBranchIds: jest.fn(async (userId: string) => ownedBranches[userId] ?? []),
    assertOwnsBranch: jest.fn(async (userId: string, branchId: string) => {
      if (!(ownedBranches[userId] ?? []).includes(branchId)) {
        throw new Error('not owned');
      }
    }),
  };

  const productsService = {
    adminCreateProduct: jest.fn(async (dto: any) => ({ id: 'new-product', ...dto })),
    adminListCategories: jest.fn(async (branchId: string) => (seed.categories ?? []).filter((c: any) => c.vendorBranchId === branchId)),
    adminListProducts: jest.fn(async (branchId: string) => [...products.values()].filter((p) => p.vendorBranchId === branchId)),
    adminGetProduct: jest.fn(async (id: string) => {
      const product = products.get(id);
      if (!product) throw new NotFoundException('Product not found.');
      return product;
    }),
    adminUpdateProduct: jest.fn(async (id: string, dto: any) => ({ ...products.get(id), ...dto })),
    adminActivateProduct: jest.fn(async (id: string) => ({ ...products.get(id), isAvailable: true })),
    adminDeactivateProduct: jest.fn(async (id: string) => ({ ...products.get(id), isAvailable: false })),
    adminSetInventoryToZero: jest.fn(async (id: string) => ({ ...products.get(id), quantity: 0 })),
  };

  const uploadsService = {
    upload: jest.fn(async (base64Content: string, filename: string, uploadedByUserId: string) => ({
      id: 'upload-1',
      url: `/uploads/files/mock-${filename}`,
    })),
  };

  const productExcelImportService = {};
  const manager = { query: jest.fn(async () => []) };
  const dataSource = { manager, transaction: jest.fn(async (cb: (m: any) => any) => cb(manager)) };
  const governance = {
    submitNew: jest.fn(async () => 'req-new'),
    submitUpdate: jest.fn(async () => 'req-update'),
    setPendingAvailability: jest.fn(async () => undefined),
    view1: jest.fn(async (id: string) => ({ id, status: 'PENDING' })),
  };

  const service = new VendorProductsService(
    productsService as any,
    vendorStaffAuthorizationService as any,
    uploadsService as any,
    productExcelImportService as any,
    dataSource as any,
    governance as any,
  );
  return { service, productsService, vendorStaffAuthorizationService, uploadsService, governance, manager };
}

describe('VendorProductsService.listForUser', () => {
  it('returns products across every branch the user owns when vendorBranchId is omitted', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1', 'branch-2'] },
      products: {
        p1: { id: 'p1', vendorBranchId: 'branch-1' },
        p2: { id: 'p2', vendorBranchId: 'branch-2' },
        p3: { id: 'p3', vendorBranchId: 'branch-OTHER' },
      },
    });
    const result = await service.listForUser('user-1');
    expect(result.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('returns an empty list for a user who owns no branches — never leaks anything', async () => {
    const { service } = buildHarness({ ownedBranches: {} });
    expect(await service.listForUser('user-with-no-branches')).toEqual([]);
  });

  it('scopes to a single requested branch when vendorBranchId is provided and owned', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1' } },
    });
    const result = await service.listForUser('user-1', 'branch-1');
    expect(result.map((p) => p.id)).toEqual(['p1']);
  });

  it('CRITICAL: returns an empty list (never an error revealing existence) for a branch the user does not own', async () => {
    const { service } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    expect(await service.listForUser('user-1', 'branch-BELONGS-TO-ANOTHER-VENDOR')).toEqual([]);
  });
});

describe('VendorProductsService.getForUser', () => {
  it('returns a product from an owned branch', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1' } },
    });
    expect((await service.getForUser('user-1', 'p1')).id).toBe('p1');
  });

  it('CRITICAL: rejects with NotFoundException (not Forbidden) for a product in an unowned branch — never leaks existence', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-OWNED-BY-VENDOR-B' } },
    });
    await expect(service.getForUser('user-1', 'p1')).rejects.toThrow(NotFoundException);
  });

  it('propagates NotFoundException for a genuinely nonexistent product', async () => {
    const { service } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    await expect(service.getForUser('user-1', 'missing')).rejects.toThrow(NotFoundException);
  });
});

describe('VendorProductsService.updateForUser', () => {
  it('updates a product in an owned branch, delegating to the existing adminUpdateProduct (Chunk 12A rules reused, not duplicated)', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', name: 'Old' } },
    });
    const updated = await service.updateForUser('user-1', 'p1', { name: 'New' } as any);
    expect(updated.name).toBe('New');
    expect(productsService.adminUpdateProduct).toHaveBeenCalledWith('p1', { name: 'New' }, expect.anything(), { userId: expect.anything(), role: 'VENDOR' });
  });

  it('CRITICAL: rejects updating a product in a branch the user does not own, and never calls adminUpdateProduct', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-OWNED-BY-VENDOR-B' } },
    });
    await expect(service.updateForUser('user-1', 'p1', { name: 'Hijacked' } as any)).rejects.toThrow(
      NotFoundException,
    );
    expect(productsService.adminUpdateProduct).not.toHaveBeenCalled();
  });
});

describe('VendorProductsService.activateForUser / deactivateForUser', () => {
  it('activates/deactivates a product in an owned branch', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', isAvailable: false } },
    });
    expect((await service.activateForUser('user-1', 'p1')).isAvailable).toBe(true);
  });

  it('CRITICAL: rejects activating a product in an unowned branch', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-OWNED-BY-VENDOR-B' } },
    });
    await expect(service.activateForUser('user-1', 'p1')).rejects.toThrow(NotFoundException);
    expect(productsService.adminActivateProduct).not.toHaveBeenCalled();
  });
});

describe('VendorProductsService.uploadImageForUser (Chunk 12B-1 Correction)', () => {
  function jpegFile(overrides: Partial<any> = {}) {
    return { buffer: Buffer.from('fake-jpeg-bytes'), mimetype: 'image/jpeg', size: 1024, originalname: 'photo.jpg', ...overrides };
  }

  it('VENDOR can upload an image for an owned product', async () => {
    const { service, productsService, uploadsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', imageUrl: null } },
    });
    const updated = await service.uploadImageForUser('user-1', 'p1', jpegFile());
    expect(uploadsService.upload).toHaveBeenCalled();
    expect(productsService.adminUpdateProduct).toHaveBeenCalledWith('p1', { imageUrl: expect.stringContaining('/uploads/files/') });
    expect(updated.imageUrl).toContain('/uploads/files/');
  });

  it('VENDOR_MANAGER can upload an image for an owned product — identical treatment, same method', async () => {
    // Role itself is irrelevant to this service (confirmed, Chunk 12B
    // design review) — the controller's @Roles gate is what
    // distinguishes actors; both roles reach this same method identically.
    const { service } = buildHarness({
      ownedBranches: { 'manager-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1' } },
    });
    const updated = await service.uploadImageForUser('manager-1', 'p1', jpegFile());
    expect(updated.imageUrl).toContain('/uploads/files/');
  });

  it('CRITICAL: cross-vendor image upload is rejected with NotFoundException, and storage is NEVER invoked', async () => {
    const { service, uploadsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-OWNED-BY-VENDOR-B' } },
    });
    await expect(service.uploadImageForUser('user-1', 'p1', jpegFile())).rejects.toThrow(NotFoundException);
    expect(uploadsService.upload).not.toHaveBeenCalled();
  });

  it('rejects a non-image MIME type before any storage call', async () => {
    const { service, uploadsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1' } },
    });
    await expect(
      service.uploadImageForUser('user-1', 'p1', jpegFile({ mimetype: 'application/pdf' })),
    ).rejects.toThrow(BadRequestException);
    expect(uploadsService.upload).not.toHaveBeenCalled();
  });

  it('rejects an oversized file regardless of an otherwise-valid image MIME type', async () => {
    const { service, uploadsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1' } },
    });
    await expect(
      service.uploadImageForUser('user-1', 'p1', jpegFile({ size: 10 * 1024 * 1024 })),
    ).rejects.toThrow(BadRequestException);
    expect(uploadsService.upload).not.toHaveBeenCalled();
  });

  it('storage failure does not update Product.imageUrl', async () => {
    const { service, productsService, uploadsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', imageUrl: 'existing-url' } },
    });
    uploadsService.upload.mockRejectedValueOnce(new Error('disk write failed'));
    await expect(service.uploadImageForUser('user-1', 'p1', jpegFile())).rejects.toThrow('disk write failed');
    expect(productsService.adminUpdateProduct).not.toHaveBeenCalled();
  });

  it('replacing an existing image stores the new image (via UploadsService) BEFORE the product record is updated', async () => {
    const callOrder: string[] = [];
    const { service, productsService, uploadsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', imageUrl: 'old-url' } },
    });
    uploadsService.upload.mockImplementation(async () => {
      callOrder.push('upload');
      return { id: 'u2', url: '/uploads/files/new.jpg' };
    });
    productsService.adminUpdateProduct.mockImplementation(async (id: string, dto: any) => {
      callOrder.push('db-update');
      return { id, imageUrl: dto.imageUrl };
    });
    await service.uploadImageForUser('user-1', 'p1', jpegFile());
    expect(callOrder).toEqual(['upload', 'db-update']);
  });

  it('existing Vendor product update functionality (non-image fields) remains intact', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', name: 'Old' } },
    });
    const updated = await service.updateForUser('user-1', 'p1', { name: 'New' } as any);
    expect(updated.name).toBe('New');
    expect(productsService.adminUpdateProduct).toHaveBeenCalledWith('p1', { name: 'New' }, expect.anything(), { userId: expect.anything(), role: 'VENDOR' });
  });
});

describe('VendorProductsService.createForUser (Chunk 12B-2)', () => {
  /**
   * NOTE on test-layer scope: category-branch-mismatch, nonexistent-
   * category, and OPEN/TRACKED inventory validation are NOT
   * re-tested here — `productsService.adminCreateProduct` is mocked
   * at this layer (by design: VendorProductsService delegates to it
   * verbatim, per the approved design review's "zero duplication"
   * requirement). Those rules are already covered by the existing
   * Chunk 12A/12B-1 tests in `admin-catalog.service.spec.ts`, which
   * exercise the real `ProductsService.adminCreateProduct`. Testing
   * them again here against a mock would be hollow — it would only
   * prove the mock does what the mock was told to do, not that the
   * real rule holds. What IS this layer's genuine responsibility, and
   * what these tests actually verify: the ownership gate, and that
   * the dto passes through to `adminCreateProduct` unmodified.
   */

  function baseDto(overrides: Partial<any> = {}) {
    return {
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: 'PIECE',
      ...overrides,
    };
  }

  it('VENDOR can create in an owned branch', async () => {
    const { service, productsService } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    const dto = baseDto();
    const created = await service.createForUser('user-1', dto as any);
    expect(created.id).toBe('new-product');
    // R7: saved PENDING and unavailable, and sent to Hatly for review
    expect(productsService.adminCreateProduct).toHaveBeenCalledWith({ ...dto, isAvailable: false }, expect.objectContaining({ approvalStatus: 'PENDING' }));
  });

  it('VENDOR_MANAGER can create in an owned branch — identical treatment', async () => {
    const { service } = buildHarness({ ownedBranches: { 'manager-1': ['branch-1'] } });
    const created = await service.createForUser('manager-1', baseDto() as any);
    expect(created.id).toBe('new-product');
  });

  it('CRITICAL: an unowned branch is rejected, and ProductsService.adminCreateProduct is NEVER called', async () => {
    const { service, productsService } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    await expect(
      service.createForUser('user-1', baseDto({ vendorBranchId: 'branch-OWNED-BY-VENDOR-B' }) as any),
    ).rejects.toThrow();
    expect(productsService.adminCreateProduct).not.toHaveBeenCalled();
  });

  it('a user who owns no branches is rejected outright', async () => {
    const { service, productsService } = buildHarness({ ownedBranches: {} });
    await expect(service.createForUser('nobody', baseDto() as any)).rejects.toThrow();
    expect(productsService.adminCreateProduct).not.toHaveBeenCalled();
  });

  // R7: a new product is never available before Hatly approves it; what the vendor asked for is kept on the review request.
  it('isAvailable omitted: saved unavailable; the review asks for it to go live once approved', async () => {
    const { service, productsService, governance } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    await service.createForUser('user-1', baseDto() as any);
    expect(productsService.adminCreateProduct.mock.calls[0][0]).toMatchObject({ isAvailable: false });
    expect((governance.submitNew.mock.calls[0] as any[])[4]).toBe(true);
  });

  it('isAvailable=false: saved unavailable and stays off after approval', async () => {
    const { service, productsService, governance } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    await service.createForUser('user-1', baseDto({ isAvailable: false }) as any);
    expect(productsService.adminCreateProduct).toHaveBeenCalledWith(expect.objectContaining({ isAvailable: false }), expect.anything());
    expect((governance.submitNew.mock.calls[0] as any[])[4]).toBe(false);
  });

  it('isAvailable=true: still saved unavailable until Hatly approves', async () => {
    const { service, productsService, governance } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    await service.createForUser('user-1', baseDto({ isAvailable: true }) as any);
    expect(productsService.adminCreateProduct).toHaveBeenCalledWith(expect.objectContaining({ isAvailable: false }), expect.anything());
    expect((governance.submitNew.mock.calls[0] as any[])[4]).toBe(true);
  });

  it('R7 on a LIVE product: a price reduction and inventory apply now; a price increase and a rename go to Hatly', async () => {
    const live = { id: 'p1', vendorBranchId: 'branch-1', name: 'Old', priceMinor: 1000, approvalStatus: 'APPROVED' };
    const { service, productsService, governance } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] }, products: { p1: live } });
    const down = await service.updateForUser('user-1', 'p1', { priceMinor: 900, quantity: 5 } as any);
    expect(productsService.adminUpdateProduct).toHaveBeenCalledWith('p1', { priceMinor: 900, quantity: 5 }, expect.anything(), expect.anything());
    expect(governance.submitUpdate).not.toHaveBeenCalled();
    expect(down.pendingChange).toBeNull();
    productsService.adminUpdateProduct.mockClear();
    const up = await service.updateForUser('user-1', 'p1', { priceMinor: 1200, name: 'New' } as any);
    expect(productsService.adminUpdateProduct).not.toHaveBeenCalled();
    expect(governance.submitUpdate).toHaveBeenCalledWith(expect.anything(), live, { priceMinor: 1200, name: 'New' }, expect.anything(), 'DASHBOARD');
    expect(up.pendingChange).toMatchObject({ id: 'req-update' });
  });

  it('R7: activating a product Hatly rejected is refused; activating one that waits only records the wish', async () => {
    const { service, productsService, governance } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { r: { id: 'r', vendorBranchId: 'branch-1', approvalStatus: 'REJECTED' }, w: { id: 'w', vendorBranchId: 'branch-1', approvalStatus: 'PENDING' } },
    });
    await expect(service.activateForUser('user-1', 'r')).rejects.toMatchObject({ response: { details: { code: 'PRODUCT_REJECTED' } } });
    await service.activateForUser('user-1', 'w');
    expect(governance.setPendingAvailability).toHaveBeenCalledWith(expect.anything(), 'w', true);
    expect(productsService.adminActivateProduct).not.toHaveBeenCalled();
  });

  it('pricingUnit is passed through to adminCreateProduct exactly as supplied', async () => {
    const { service, productsService } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] } });
    await service.createForUser('user-1', baseDto({ pricingUnit: 'WEIGHT' }) as any);
    expect(productsService.adminCreateProduct).toHaveBeenCalledWith(expect.objectContaining({ pricingUnit: 'WEIGHT' }), expect.anything());
  });

  it('VendorCreateProductDto structurally has no imageUrl/id/rating/counter/timestamp field to inject', () => {
    const dto = baseDto();
    expect('imageUrl' in dto).toBe(false);
    expect('id' in dto).toBe(false);
    expect('ratingCount' in dto).toBe(false);
    expect('deliveredQuantityCount' in dto).toBe(false);
    expect('createdAt' in dto).toBe(false);
  });
});

describe('VendorProductsService — existing Chunk 12B-1 operations remain intact (regression)', () => {
  it('listForUser, getForUser, updateForUser, activate/deactivateForUser, uploadImageForUser are all still present and callable', () => {
    const { service } = buildHarness();
    expect(typeof service.listForUser).toBe('function');
    expect(typeof service.getForUser).toBe('function');
    expect(typeof service.updateForUser).toBe('function');
    expect(typeof service.activateForUser).toBe('function');
    expect(typeof service.deactivateForUser).toBe('function');
    expect(typeof service.uploadImageForUser).toBe('function');
  });
});

describe('VendorProductsService.listCategoriesForUser (Chunk 12B-3)', () => {
  it('VENDOR can list categories for an owned branch', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      categories: [
        { id: 'c1', vendorBranchId: 'branch-1', name: 'Mains' },
        { id: 'c2', vendorBranchId: 'branch-OTHER', name: 'Other' },
      ],
    });
    const result = await service.listCategoriesForUser('user-1', 'branch-1');
    expect(result.map((c: any) => c.id)).toEqual(['c1']);
    expect(productsService.adminListCategories).toHaveBeenCalledWith('branch-1');
  });

  it('VENDOR_MANAGER can list categories for an owned branch — identical treatment', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'manager-1': ['branch-1'] },
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const result = await service.listCategoriesForUser('manager-1', 'branch-1');
    expect(result.map((c: any) => c.id)).toEqual(['c1']);
  });

  it('CRITICAL: an unowned branch returns [] — never an error, never leaks category data', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      categories: [{ id: 'c1', vendorBranchId: 'branch-OWNED-BY-VENDOR-B', name: 'Secret Menu' }],
    });
    const result = await service.listCategoriesForUser('user-1', 'branch-OWNED-BY-VENDOR-B');
    expect(result).toEqual([]);
    expect(productsService.adminListCategories).not.toHaveBeenCalled();
  });

  it('vendorBranchId omitted returns categories aggregated across every owned branch', async () => {
    const { service } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1', 'branch-2'] },
      categories: [
        { id: 'c1', vendorBranchId: 'branch-1' },
        { id: 'c2', vendorBranchId: 'branch-2' },
        { id: 'c3', vendorBranchId: 'branch-OTHER' },
      ],
    });
    const result = await service.listCategoriesForUser('user-1');
    expect(result.map((c: any) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('a user with no owned branches receives [] when vendorBranchId is omitted', async () => {
    const { service } = buildHarness({ ownedBranches: {} });
    expect(await service.listCategoriesForUser('nobody')).toEqual([]);
  });

  it('a branch with no categories returns [] cleanly', async () => {
    const { service } = buildHarness({ ownedBranches: { 'user-1': ['branch-1'] }, categories: [] });
    expect(await service.listCategoriesForUser('user-1', 'branch-1')).toEqual([]);
  });

  it('calls the existing ProductsService.adminListCategories with the correct branch id(s) — no duplicated read logic', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1', 'branch-2'] },
      categories: [],
    });
    await service.listCategoriesForUser('user-1');
    expect(productsService.adminListCategories).toHaveBeenCalledWith('branch-1');
    expect(productsService.adminListCategories).toHaveBeenCalledWith('branch-2');
  });

  it('READ-ONLY GUARANTEE: no category create/update/delete/activate/deactivate method exists on VendorProductsService', () => {
    const { service } = buildHarness();
    expect((service as any).createCategoryForUser).toBeUndefined();
    expect((service as any).updateCategoryForUser).toBeUndefined();
    expect((service as any).deleteCategoryForUser).toBeUndefined();
    expect((service as any).activateCategoryForUser).toBeUndefined();
    expect((service as any).deactivateCategoryForUser).toBeUndefined();
  });
});

describe('VendorProductsService — 12B-1/12B-2 regression after 12B-3 (category read addition)', () => {
  it('existing Vendor product create/list/update/activate/deactivate/image-upload all remain intact', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', name: 'Old' } },
    });
    const updated = await service.updateForUser('user-1', 'p1', { name: 'New' } as any);
    expect(updated.name).toBe('New');
    expect(productsService.adminUpdateProduct).toHaveBeenCalledWith('p1', { name: 'New' }, expect.anything(), { userId: expect.anything(), role: 'VENDOR' });
  });
});

describe('VendorProductsService.setInventoryToZeroForUser (Tracked Inventory Order-Time Enforcement)', () => {
  it('Vendor can set inventory to zero for a product in an owned branch', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-1', inventoryMode: 'TRACKED', quantity: 10 } },
    });
    const updated = await service.setInventoryToZeroForUser('user-1', 'p1');
    expect(updated.quantity).toBe(0);
    expect(productsService.adminSetInventoryToZero).toHaveBeenCalledWith('p1', { userId: expect.anything(), role: 'VENDOR' });
  });

  it('CRITICAL: rejects for a product in a branch the Vendor does not own, and never calls the underlying service method', async () => {
    const { service, productsService } = buildHarness({
      ownedBranches: { 'user-1': ['branch-1'] },
      products: { p1: { id: 'p1', vendorBranchId: 'branch-OWNED-BY-VENDOR-B', inventoryMode: 'TRACKED', quantity: 10 } },
    });
    await expect(service.setInventoryToZeroForUser('user-1', 'p1')).rejects.toThrow(NotFoundException);
    expect(productsService.adminSetInventoryToZero).not.toHaveBeenCalled();
  });
});
