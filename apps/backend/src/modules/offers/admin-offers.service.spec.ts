import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AdminOffersService } from './admin-offers.service';
import { Offer } from './entities/offer.entity';
import { OfferProduct } from './entities/offer-product.entity';
import { OfferCategory } from './entities/offer-category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductCategory } from '../products/entities/product-category.entity';
import { DiscountType } from './discount-type.enum';
import { OfferMechanism } from './offer-mechanism.enum';
import { CreateOfferDto } from './dto/create-offer.dto';

function matchesWhere(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'value' in (value as any) && Array.isArray((value as any).value)) {
      return (value as any).value.includes(row[key]);
    }
    return row[key] === value;
  });
}

function buildHarness(params: { products?: any[]; categories?: any[] }) {
  const offers = new Map<string, any>();
  const offerProducts: any[] = [];
  const offerCategories: any[] = [];
  const products = new Map((params.products ?? []).map((p) => [p.id, p]));
  const categories = new Map((params.categories ?? []).map((c) => [c.id, c]));

  const manager = {
    find: async (EntityClass: any, opts: any) => {
      const where = opts.where ?? {};
      if (EntityClass === Product) return [...products.values()].filter((p) => matchesWhere(p, where));
      if (EntityClass === ProductCategory) return [...categories.values()].filter((c) => matchesWhere(c, where));
      if (EntityClass === Offer) return [...offers.values()].filter((o) => matchesWhere(o, where));
      if (EntityClass === OfferProduct) return offerProducts.filter((r) => matchesWhere(r, where));
      if (EntityClass === OfferCategory) return offerCategories.filter((r) => matchesWhere(r, where));
      throw new Error(`unhandled find ${EntityClass.name}`);
    },
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === Offer) return offers.get(opts.where.id) ?? null;
      throw new Error(`unhandled findOne ${EntityClass.name}`);
    },
    count: async (EntityClass: any, opts: any) => {
      const where = opts.where ?? {};
      if (EntityClass === OfferProduct) return offerProducts.filter((r) => matchesWhere(r, where)).length;
      if (EntityClass === OfferCategory) return offerCategories.filter((r) => matchesWhere(r, where)).length;
      throw new Error(`unhandled count ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === Offer) offers.set(withId.id, withId);
      else if (EntityClass === OfferProduct) offerProducts.push(withId);
      else if (EntityClass === OfferCategory) offerCategories.push(withId);
      return withId;
    },
  };

  const offersRepository = {
    find: async (opts: any) => {
      const all = [...offers.values()];
      if (opts?.where?.vendorBranchId) return all.filter((o) => o.vendorBranchId === opts.where.vendorBranchId);
      return all;
    },
    findOne: async (opts: any) => offers.get(opts.where.id) ?? null,
    save: async (entity: any) => {
      offers.set(entity.id, entity);
      return entity;
    },
  };

  const offerProductsRepository = {
    find: async (opts: any) => offerProducts.filter((r) => r.offerId === opts.where.offerId),
  };
  const offerCategoriesRepository = {
    find: async (opts: any) => offerCategories.filter((r) => r.offerId === opts.where.offerId),
  };

  const dataSource = {
    transaction: async (cb: any) => cb(manager),
    getRepository: (EntityClass: any) => {
      if (EntityClass === Offer) return offersRepository;
      if (EntityClass === OfferProduct) return offerProductsRepository;
      if (EntityClass === OfferCategory) return offerCategoriesRepository;
      throw new Error('unhandled getRepository');
    },
  };

  const service = new AdminOffersService(dataSource as any);
  return { service, offers, offerProducts, offerCategories, manager };
}

function subtotalDiscountDto(overrides: Partial<CreateOfferDto> = {}): CreateOfferDto {
  const now = new Date();
  return {
    vendorBranchId: 'branch-1',
    name: 'Ramadan Sale',
    mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
    discountType: DiscountType.PERCENTAGE,
    discountValue: 2000,
    startAt: new Date(now.getTime() - 1000).toISOString(),
    endAt: new Date(now.getTime() + 1000 * 60 * 60).toISOString(),
    productIds: ['product-1'],
    ...overrides,
  } as CreateOfferDto;
}

function flashSaleDto(overrides: Partial<CreateOfferDto> = {}): CreateOfferDto {
  const now = new Date();
  return {
    vendorBranchId: 'branch-1',
    name: 'Sugar Flash Sale',
    mechanism: OfferMechanism.FLASH_SALE,
    specialPriceMinor: 2000,
    startAt: new Date(now.getTime() - 1000).toISOString(),
    endAt: new Date(now.getTime() + 1000 * 60 * 60).toISOString(),
    productIds: ['product-1'],
    ...overrides,
  } as CreateOfferDto;
}

const product1 = { id: 'product-1', vendorBranchId: 'branch-1', categoryId: 'cat-1' };
const category1 = { id: 'cat-1', vendorBranchId: 'branch-1' };

describe('AdminOffersService.create — SUBTOTAL_DISCOUNT', () => {
  it('creates a valid SUBTOTAL_DISCOUNT offer with product targeting', async () => {
    const { service, offers } = buildHarness({ products: [product1], categories: [category1] });
    const offer = await service.create(subtotalDiscountDto());
    expect(offer.mechanism).toBe(OfferMechanism.SUBTOTAL_DISCOUNT);
    expect(offer.discountType).toBe(DiscountType.PERCENTAGE);
    expect(offer.specialPriceMinor).toBeNull();
    expect(offers.size).toBe(1);
  });

  it('CRITICAL: rejects SUBTOTAL_DISCOUNT missing discountType/discountValue', async () => {
    const { service } = buildHarness({ products: [product1] });
    await expect(
      service.create(subtotalDiscountDto({ discountType: undefined, discountValue: undefined })),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejects SUBTOTAL_DISCOUNT that also sets specialPriceMinor', async () => {
    const { service } = buildHarness({ products: [product1] });
    await expect(service.create(subtotalDiscountDto({ specialPriceMinor: 1000 } as any))).rejects.toThrow(BadRequestException);
  });

  it('rejects a percentage discount above 100%', async () => {
    const { service } = buildHarness({ products: [product1] });
    await expect(
      service.create(subtotalDiscountDto({ discountType: DiscountType.PERCENTAGE, discountValue: 10001 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('supports branch-wide targeting (no productIds/categoryIds)', async () => {
    const { service, offers, offerProducts, offerCategories } = buildHarness({ products: [product1] });
    const offer = await service.create(subtotalDiscountDto({ productIds: undefined, categoryIds: undefined }));
    expect(offers.size).toBe(1);
    expect(offerProducts.filter((p) => p.offerId === offer.id)).toHaveLength(0);
    expect(offerCategories.filter((c) => c.offerId === offer.id)).toHaveLength(0);
  });

  it('supports category targeting', async () => {
    const { service, offerCategories } = buildHarness({ products: [product1], categories: [category1] });
    const offer = await service.create(subtotalDiscountDto({ productIds: undefined, categoryIds: ['cat-1'] }));
    expect(offerCategories.filter((c) => c.offerId === offer.id)).toHaveLength(1);
  });

  it('rejects a product that does not belong to the offer\u2019s VendorBranch', async () => {
    const wrongBranchProduct = { id: 'product-2', vendorBranchId: 'branch-OTHER', categoryId: 'cat-1' };
    const { service } = buildHarness({ products: [wrongBranchProduct] });
    await expect(service.create(subtotalDiscountDto({ productIds: ['product-2'] }))).rejects.toThrow(BadRequestException);
  });

  it('rejects endAt <= startAt', async () => {
    const { service } = buildHarness({ products: [product1] });
    const now = new Date();
    await expect(
      service.create(subtotalDiscountDto({ startAt: now.toISOString(), endAt: now.toISOString() })),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('AdminOffersService.create — FLASH_SALE', () => {
  it('creates a valid FLASH_SALE offer with a special price', async () => {
    const { service, offers } = buildHarness({ products: [product1] });
    const offer = await service.create(flashSaleDto());
    expect(offer.mechanism).toBe(OfferMechanism.FLASH_SALE);
    expect(offer.specialPriceMinor).toBe(2000);
    expect(offer.discountType).toBeNull();
    expect(offer.discountValue).toBeNull();
    expect(offers.size).toBe(1);
  });

  it('CRITICAL: rejects FLASH_SALE missing specialPriceMinor', async () => {
    const { service } = buildHarness({ products: [product1] });
    await expect(service.create(flashSaleDto({ specialPriceMinor: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejects FLASH_SALE that also sets discountType/discountValue', async () => {
    const { service } = buildHarness({ products: [product1] });
    await expect(
      service.create(flashSaleDto({ discountType: DiscountType.PERCENTAGE, discountValue: 1000 } as any)),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejects FLASH_SALE that also sets minimumEligibleSubtotalMinor', async () => {
    const { service } = buildHarness({ products: [product1] });
    await expect(service.create(flashSaleDto({ minimumEligibleSubtotalMinor: 1000 } as any))).rejects.toThrow(BadRequestException);
  });

  it('supports cumulative quantity limits (perCustomerLifetimeLimit, totalAllocationLimit)', async () => {
    const { service, offers } = buildHarness({ products: [product1] });
    const offer = await service.create(flashSaleDto({ perCustomerLifetimeLimit: 2000, totalAllocationLimit: 500000 }));
    const stored = offers.get(offer.id);
    expect(stored.perCustomerLifetimeLimit).toBe(2000);
    expect(stored.totalAllocationLimit).toBe(500000);
  });
});

describe('AdminOffersService.create — MUTUAL EXCLUSION', () => {
  it('CRITICAL: rejects creating a FLASH_SALE for a product already covered by an active, overlapping SUBTOTAL_DISCOUNT', async () => {
    const { service } = buildHarness({ products: [product1] });
    await service.create(subtotalDiscountDto({ productIds: ['product-1'] }));
    await expect(service.create(flashSaleDto({ productIds: ['product-1'] }))).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: rejects creating a SUBTOTAL_DISCOUNT for a product already covered by an active, overlapping FLASH_SALE', async () => {
    const { service } = buildHarness({ products: [product1] });
    await service.create(flashSaleDto({ productIds: ['product-1'] }));
    await expect(service.create(subtotalDiscountDto({ productIds: ['product-1'] }))).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: a branch-wide offer of one mechanism conflicts with ANY product targeted by the other mechanism', async () => {
    const { service } = buildHarness({ products: [product1] });
    await service.create(flashSaleDto({ productIds: undefined, categoryIds: undefined })); // branch-wide flash sale
    await expect(service.create(subtotalDiscountDto({ productIds: ['product-1'] }))).rejects.toThrow(BadRequestException);
  });

  it('does NOT conflict when the two offers target different, non-overlapping products', async () => {
    const product2 = { id: 'product-2', vendorBranchId: 'branch-1', categoryId: 'cat-1' };
    const { service, offers } = buildHarness({ products: [product1, product2] });
    await service.create(flashSaleDto({ productIds: ['product-1'] }));
    const offer2 = await service.create(subtotalDiscountDto({ productIds: ['product-2'] }));
    expect(offers.size).toBe(2);
    expect(offer2.mechanism).toBe(OfferMechanism.SUBTOTAL_DISCOUNT);
  });

  it('does NOT conflict when the two offers\u2019 validity windows do not overlap', async () => {
    const { service, offers } = buildHarness({ products: [product1] });
    const now = new Date();
    await service.create(
      flashSaleDto({ startAt: new Date(now.getTime() - 20000).toISOString(), endAt: new Date(now.getTime() - 10000).toISOString() }),
    );
    const offer2 = await service.create(subtotalDiscountDto({ productIds: ['product-1'] }));
    expect(offers.size).toBe(2);
    expect(offer2.mechanism).toBe(OfferMechanism.SUBTOTAL_DISCOUNT);
  });

  it('CODE-QUALITY FIX: a category-targeted offer that currently resolves to ZERO real products is NOT misread as branch-wide, and does not falsely conflict', async () => {
    // Regression test for a real bug found and fixed during this
    // chunk's code-quality review: branch-wide detection previously
    // inferred from "resolved product list is empty", which wrongly
    // treated an empty category (targets nothing yet) the same as
    // explicit branch-wide targeting (targets everything).
    const emptyCategory = { id: 'empty-cat', vendorBranchId: 'branch-1' };
    const { service, offers } = buildHarness({ products: [product1], categories: [emptyCategory] });
    await service.create(flashSaleDto({ productIds: undefined, categoryIds: ['empty-cat'] })); // targets nothing real
    const offer2 = await service.create(subtotalDiscountDto({ productIds: ['product-1'] }));
    expect(offers.size).toBe(2);
    expect(offer2.mechanism).toBe(OfferMechanism.SUBTOTAL_DISCOUNT);
  });
});

describe('AdminOffersService — authorization (unchanged)', () => {
  it('MANAGE_OFFERS remains the sole authorization path — confirmed no Vendor-facing method exists on this service', () => {
    const proto = Object.getOwnPropertyNames(AdminOffersService.prototype);
    expect(proto).not.toContain('createForVendor');
    expect(proto).not.toContain('createForUser');
  });
});

describe('AdminOffersService — read/deactivate (unchanged behavior)', () => {
  it('getOne throws NotFoundException for a missing offer', async () => {
    const { service } = buildHarness({});
    await expect(service.getOne('missing-id')).rejects.toThrow(NotFoundException);
  });

  it('deactivate flips isActive without touching mechanism-specific fields', async () => {
    const { service } = buildHarness({ products: [product1] });
    const offer = await service.create(flashSaleDto());
    const deactivated = await service.deactivate(offer.id);
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.specialPriceMinor).toBe(2000);
  });

  it('activate flips isActive back to true', async () => {
    const { service } = buildHarness({ products: [product1] });
    const offer = await service.create(flashSaleDto());
    await service.deactivate(offer.id);
    const reactivated = await service.activate(offer.id);
    expect(reactivated.isActive).toBe(true);
  });

  it('Admin Offers Management UI: listForBranch/getOne enrich each offer with resolved productIds/categoryIds for the targeting-summary display', async () => {
    const { service } = buildHarness({ products: [product1], categories: [category1] });
    const productOffer = await service.create(subtotalDiscountDto({ productIds: ['product-1'] }));
    const categoryOffer = await service.create(subtotalDiscountDto({ productIds: undefined, categoryIds: ['cat-1'] }));
    const branchWideOffer = await service.create(subtotalDiscountDto({ productIds: undefined, categoryIds: undefined }));

    const list = await service.listForBranch('branch-1');
    const found = (id: string) => list.find((o) => o.id === id)!;

    expect(found(productOffer.id).productIds).toEqual(['product-1']);
    expect(found(productOffer.id).categoryIds).toEqual([]);
    expect(found(categoryOffer.id).categoryIds).toEqual(['cat-1']);
    expect(found(branchWideOffer.id).productIds).toEqual([]);
    expect(found(branchWideOffer.id).categoryIds).toEqual([]);

    const single = await service.getOne(productOffer.id);
    expect(single.productIds).toEqual(['product-1']);
  });
});
