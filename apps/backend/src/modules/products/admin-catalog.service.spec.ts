import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProductsService } from './products.service';
import { PricingUnit } from './pricing-unit.enum';

function buildHarness(seed: { branches?: any[]; categories?: any[]; products?: any[] } = {}) {
  const branches = new Map((seed.branches ?? []).map((b) => [b.id, b]));
  const categories = new Map((seed.categories ?? []).map((c) => [c.id, c]));
  const products = new Map((seed.products ?? []).map((p) => [p.id, p]));

  const branchesRepository = {
    findOne: async (opts: any) => branches.get(opts.where.id) ?? null,
  };

  const categoriesRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      categories.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => {
      const all = [...categories.values()];
      if (opts?.where?.vendorBranchId) return all.filter((c) => c.vendorBranchId === opts.where.vendorBranchId);
      return all;
    },
    findOne: async (opts: any) => categories.get(opts.where.id) ?? null,
  };

  const productsRepository = {
    create: (data: any) => ({ ...data }),
    save: async (entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      products.set(withId.id, withId);
      return withId;
    },
    find: async (opts: any) => {
      let all = [...products.values()];
      if (opts?.where?.vendorBranchId) all = all.filter((p) => p.vendorBranchId === opts.where.vendorBranchId);
      if (opts?.where?.categoryId) all = all.filter((p) => p.categoryId === opts.where.categoryId);
      return all;
    },
    findOne: async (opts: any) => products.get(opts.where.id) ?? null,
  };

  const service = new ProductsService(categoriesRepository as any, productsRepository as any, branchesRepository as any);
  return { service, branches, categories, products };
}

describe('ProductsService.adminCreateCategory', () => {
  it('creates a category for an existing branch, using the entity default isActive', async () => {
    const { service } = buildHarness({ branches: [{ id: 'branch-1' }] });
    const category = await service.adminCreateCategory({ vendorBranchId: 'branch-1', name: 'Mains' });
    expect(category.vendorBranchId).toBe('branch-1');
    expect(category.name).toBe('Mains');
  });

  it('rejects creation for a nonexistent branch', async () => {
    const { service } = buildHarness();
    await expect(
      service.adminCreateCategory({ vendorBranchId: 'missing', name: 'Mains' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('ProductsService — category list/get/update/activate/deactivate', () => {
  it('lists categories filtered by vendorBranchId', async () => {
    const { service } = buildHarness({
      categories: [
        { id: 'c1', vendorBranchId: 'branch-1', sortOrder: 0, createdAt: new Date() },
        { id: 'c2', vendorBranchId: 'branch-2', sortOrder: 0, createdAt: new Date() },
      ],
    });
    const result = await service.adminListCategories('branch-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('rejects getCategory for a nonexistent category', async () => {
    const { service } = buildHarness();
    await expect(service.adminGetCategory('missing')).rejects.toThrow(NotFoundException);
  });

  it('update never touches vendorBranchId or isActive', async () => {
    const { service } = buildHarness({
      categories: [{ id: 'c1', vendorBranchId: 'branch-1', isActive: true, sortOrder: 0 }],
    });
    const updated = await service.adminUpdateCategory('c1', { name: 'New Name' });
    expect(updated.vendorBranchId).toBe('branch-1');
    expect(updated.isActive).toBe(true);
  });

  it('deactivate/activate toggle isActive without deleting the row', async () => {
    const { service, categories } = buildHarness({
      categories: [{ id: 'c1', vendorBranchId: 'branch-1', isActive: true, sortOrder: 0 }],
    });
    await service.adminDeactivateCategory('c1');
    expect(categories.get('c1').isActive).toBe(false);
    expect(categories.has('c1')).toBe(true); // never deleted
    await service.adminActivateCategory('c1');
    expect(categories.get('c1').isActive).toBe(true);
  });

  it('deactivating a category does not remove existing Product rows referencing it', async () => {
    const { service, products } = buildHarness({
      categories: [{ id: 'c1', vendorBranchId: 'branch-1', isActive: true, sortOrder: 0 }],
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1' }],
    });
    await service.adminDeactivateCategory('c1');
    expect(products.has('p1')).toBe(true);
  });
});

describe('ProductsService.adminCreateProduct — branch isolation', () => {
  it('creates a PIECE product when category belongs to the same branch', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
    });
    expect(product.pricingUnit).toBe(PricingUnit.PIECE);
  });

  it('creates a WEIGHT product preserving pricingUnit exactly', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Chicken Breast',
      priceMinor: 20000,
      pricingUnit: PricingUnit.WEIGHT,
    });
    expect(product.pricingUnit).toBe(PricingUnit.WEIGHT);
  });

  it('rejects creation for a nonexistent branch', async () => {
    const { service } = buildHarness({ categories: [{ id: 'c1', vendorBranchId: 'branch-1' }] });
    await expect(
      service.adminCreateProduct({
        vendorBranchId: 'missing',
        categoryId: 'c1',
        name: 'X',
        priceMinor: 100,
        pricingUnit: PricingUnit.PIECE,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects creation for a nonexistent category', async () => {
    const { service } = buildHarness({ branches: [{ id: 'branch-1' }] });
    await expect(
      service.adminCreateProduct({
        vendorBranchId: 'branch-1',
        categoryId: 'missing',
        name: 'X',
        priceMinor: 100,
        pricingUnit: PricingUnit.PIECE,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejects a category belonging to a DIFFERENT branch', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-A' }, { id: 'branch-B' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-B' }],
    });
    await expect(
      service.adminCreateProduct({
        vendorBranchId: 'branch-A',
        categoryId: 'c1',
        name: 'X',
        priceMinor: 100,
        pricingUnit: PricingUnit.PIECE,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('never accepts client-supplied rating or Best Selling cache fields', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
      ratingCount: 999,
      deliveredQuantityCount: 999,
    } as any);
    expect(product.ratingCount).toBeUndefined();
    expect(product.deliveredQuantityCount).toBeUndefined();
  });
});

describe('ProductsService.adminCreateProduct — isAvailable (Chunk 12B-2)', () => {
  it('omitted isAvailable preserves existing behavior — never explicitly set on the created object', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
    } as any);
    // Not set at all — the entity column's own default governs,
    // exactly as before this chunk.
    expect('isAvailable' in product).toBe(false);
  });

  it('explicit isAvailable=false creates an unavailable product', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
      isAvailable: false,
    } as any);
    expect(product.isAvailable).toBe(false);
  });

  it('explicit isAvailable=true is persisted', async () => {
    const { service } = buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
      isAvailable: true,
    } as any);
    expect(product.isAvailable).toBe(true);
  });

  it('does not change existing activate/deactivate endpoint behavior', async () => {
    const { service, products } = buildHarness({
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1', isAvailable: true }],
    });
    await service.adminDeactivateProduct('p1');
    expect(products.get('p1').isAvailable).toBe(false);
  });
});

describe('ProductsService — product list/get/update/activate/deactivate', () => {
  it('lists products filtered by vendorBranchId and categoryId', async () => {
    const { service } = buildHarness({
      products: [
        { id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1' },
        { id: 'p2', vendorBranchId: 'branch-1', categoryId: 'c2' },
        { id: 'p3', vendorBranchId: 'branch-2', categoryId: 'c1' },
      ],
    });
    const byBranch = await service.adminListProducts('branch-1');
    expect(byBranch.map((p: any) => p.id).sort()).toEqual(['p1', 'p2']);

    const byBranchAndCategory = await service.adminListProducts('branch-1', 'c1');
    expect(byBranchAndCategory.map((p: any) => p.id)).toEqual(['p1']);
  });

  it('rejects getProduct for a nonexistent product', async () => {
    const { service } = buildHarness();
    await expect(service.adminGetProduct('missing')).rejects.toThrow(NotFoundException);
  });

  it('update allows editable fields and never touches vendorBranchId', async () => {
    const { service } = buildHarness({
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1', name: 'Old', priceMinor: 1000 }],
    });
    const updated = await service.adminUpdateProduct('p1', { name: 'New Name', priceMinor: 1500 });
    expect(updated.name).toBe('New Name');
    expect(updated.priceMinor).toBe(1500);
    expect(updated.vendorBranchId).toBe('branch-1');
  });

  it('allows reassigning categoryId within the SAME branch', async () => {
    const { service } = buildHarness({
      categories: [
        { id: 'c1', vendorBranchId: 'branch-1' },
        { id: 'c2', vendorBranchId: 'branch-1' },
      ],
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1' }],
    });
    const updated = await service.adminUpdateProduct('p1', { categoryId: 'c2' });
    expect(updated.categoryId).toBe('c2');
  });

  it('CRITICAL: rejects reassigning categoryId to a category from a DIFFERENT branch', async () => {
    const { service } = buildHarness({
      categories: [{ id: 'c-other-branch', vendorBranchId: 'branch-B' }],
      products: [{ id: 'p1', vendorBranchId: 'branch-A', categoryId: 'c1' }],
    });
    await expect(service.adminUpdateProduct('p1', { categoryId: 'c-other-branch' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('activate/deactivate toggle isAvailable only, never delete the row', async () => {
    const { service, products } = buildHarness({
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1', isAvailable: true }],
    });
    await service.adminDeactivateProduct('p1');
    expect(products.get('p1').isAvailable).toBe(false);
    expect(products.has('p1')).toBe(true);
    await service.adminActivateProduct('p1');
    expect(products.get('p1').isAvailable).toBe(true);
  });
});

describe('ProductsService — Inventory Foundation (Chunk 12A)', () => {
  function seededHarness() {
    return buildHarness({
      branches: [{ id: 'branch-1' }],
      categories: [{ id: 'c1', vendorBranchId: 'branch-1' }],
    });
  }

  it('a new Product defaults to OPEN with null quantity when inventory fields are omitted', async () => {
    const { service } = seededHarness();
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
    } as any);
    expect(product.inventoryMode).toBe('OPEN');
    expect(product.quantity).toBeNull();
  });

  it('a new OPEN Product may have null/omitted quantity — valid', async () => {
    const { service } = seededHarness();
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
      inventoryMode: 'OPEN',
    } as any);
    expect(product.quantity).toBeNull();
  });

  it('a new TRACKED PIECE Product requires a valid integer quantity', async () => {
    const { service } = seededHarness();
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
      inventoryMode: 'TRACKED',
      quantity: 25,
    } as any);
    expect(product.inventoryMode).toBe('TRACKED');
    expect(product.quantity).toBe(25);
  });

  it('a new TRACKED WEIGHT Product requires a valid integer gram quantity', async () => {
    const { service } = seededHarness();
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Chicken Breast',
      priceMinor: 20000,
      pricingUnit: PricingUnit.WEIGHT,
      inventoryMode: 'TRACKED',
      quantity: 5000, // grams
    } as any);
    expect(product.pricingUnit).toBe(PricingUnit.WEIGHT);
    expect(product.quantity).toBe(5000);
  });

  it('CRITICAL: TRACKED + no quantity is rejected at creation', async () => {
    const { service } = seededHarness();
    await expect(
      service.adminCreateProduct({
        vendorBranchId: 'branch-1',
        categoryId: 'c1',
        name: 'Burger',
        priceMinor: 1000,
        pricingUnit: PricingUnit.PIECE,
        inventoryMode: 'TRACKED',
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('zero quantity is allowed for TRACKED', async () => {
    const { service } = seededHarness();
    const product = await service.adminCreateProduct({
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      name: 'Burger',
      priceMinor: 1000,
      pricingUnit: PricingUnit.PIECE,
      inventoryMode: 'TRACKED',
      quantity: 0,
    } as any);
    expect(product.quantity).toBe(0);
  });

  it('OPEN → TRACKED requires quantity to be supplied in the same update', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'OPEN',
      quantity: null,
      isAvailable: true,
    });
    await expect(service.adminUpdateProduct('p1', { inventoryMode: 'TRACKED' } as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('OPEN → TRACKED succeeds when quantity is supplied', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'OPEN',
      quantity: null,
      isAvailable: true,
    });
    const updated = await service.adminUpdateProduct('p1', { inventoryMode: 'TRACKED', quantity: 25 } as any);
    expect(updated.inventoryMode).toBe('TRACKED');
    expect(updated.quantity).toBe(25);
  });

  it('TRACKED → TRACKED allows updating quantity alone, mode unspecified', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'TRACKED',
      quantity: 10,
      isAvailable: true,
    });
    const updated = await service.adminUpdateProduct('p1', { quantity: 40 } as any);
    expect(updated.inventoryMode).toBe('TRACKED');
    expect(updated.quantity).toBe(40);
  });

  it('TRACKED → OPEN normalizes quantity to NULL', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'TRACKED',
      quantity: 10,
      isAvailable: true,
    });
    const updated = await service.adminUpdateProduct('p1', { inventoryMode: 'OPEN' } as any);
    expect(updated.inventoryMode).toBe('OPEN');
    expect(updated.quantity).toBeNull();
  });

  it('OPEN stays OPEN and normalizes an accidentally-supplied quantity to NULL', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'OPEN',
      quantity: null,
      isAvailable: true,
    });
    const updated = await service.adminUpdateProduct('p1', { inventoryMode: 'OPEN', quantity: 99 } as any);
    expect(updated.quantity).toBeNull();
  });

  it('a request that never mentions inventory fields leaves them completely untouched', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'TRACKED',
      quantity: 10,
      isAvailable: true,
      name: 'Old',
    });
    const updated = await service.adminUpdateProduct('p1', { name: 'New Name' } as any);
    expect(updated.inventoryMode).toBe('TRACKED');
    expect(updated.quantity).toBe(10);
  });

  it('isAvailable is never automatically changed by an inventory update, in either direction', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'OPEN',
      quantity: null,
      isAvailable: false, // manually disabled
    });
    const updated = await service.adminUpdateProduct('p1', { inventoryMode: 'TRACKED', quantity: 50 } as any);
    expect(updated.isAvailable).toBe(false); // still manually disabled, not silently reactivated
  });

  it('existing (pre-Chunk-12A-shaped) update behavior remains intact — price/name edits still work exactly as before', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'OPEN',
      quantity: null,
      name: 'Old',
      priceMinor: 1000,
    });
    const updated = await service.adminUpdateProduct('p1', { name: 'New', priceMinor: 1500 } as any);
    expect(updated.name).toBe('New');
    expect(updated.priceMinor).toBe(1500);
  });

  it('pricingUnit remains immutable — never accepted by UpdateProductDto/adminUpdateProduct', async () => {
    const { service, products } = seededHarness();
    products.set('p1', {
      id: 'p1',
      vendorBranchId: 'branch-1',
      categoryId: 'c1',
      inventoryMode: 'OPEN',
      quantity: null,
      pricingUnit: PricingUnit.PIECE,
    });
    const updated = await service.adminUpdateProduct('p1', { pricingUnit: PricingUnit.WEIGHT } as any);
    // The field isn't even read by the service — pricingUnit stays PIECE regardless of what's smuggled in.
    expect(updated.pricingUnit).toBe(PricingUnit.PIECE);
  });
});

describe('ProductsService.adminSetInventoryToZero (Tracked Inventory Order-Time Enforcement)', () => {
  it('sets a TRACKED product\u2019s quantity to 0', async () => {
    const { service, products } = buildHarness({
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1', inventoryMode: 'TRACKED', quantity: 10, isAvailable: true }],
    });
    const updated = await service.adminSetInventoryToZero('p1');
    expect(updated.quantity).toBe(0);
    expect(products.get('p1').quantity).toBe(0);
  });

  it('CRITICAL: does NOT change isAvailable', async () => {
    const { service, products } = buildHarness({
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1', inventoryMode: 'TRACKED', quantity: 10, isAvailable: true }],
    });
    await service.adminSetInventoryToZero('p1');
    expect(products.get('p1').isAvailable).toBe(true);
  });

  it('does not change inventoryMode, categoryId, or pricingUnit', async () => {
    const { service, products } = buildHarness({
      products: [
        {
          id: 'p1',
          vendorBranchId: 'branch-1',
          categoryId: 'c1',
          inventoryMode: 'TRACKED',
          quantity: 10,
          isAvailable: true,
          pricingUnit: 'PIECE',
        },
      ],
    });
    const updated = await service.adminSetInventoryToZero('p1');
    expect(updated.inventoryMode).toBe('TRACKED');
    expect(updated.categoryId).toBe('c1');
    expect(updated.pricingUnit).toBe('PIECE');
  });

  it('CRITICAL: is rejected for an OPEN product — not silently a no-op', async () => {
    const { service } = buildHarness({
      products: [{ id: 'p1', vendorBranchId: 'branch-1', categoryId: 'c1', inventoryMode: 'OPEN', quantity: null, isAvailable: true }],
    });
    await expect(service.adminSetInventoryToZero('p1')).rejects.toThrow(BadRequestException);
  });
});
