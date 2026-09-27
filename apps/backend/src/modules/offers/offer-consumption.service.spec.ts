import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { OfferConsumptionService, OfferCandidateItem, FlashSaleLimitExceededException } from './offer-consumption.service';
import { Offer } from './entities/offer.entity';
import { OfferProduct } from './entities/offer-product.entity';
import { OfferCategory } from './entities/offer-category.entity';
import { OfferConsumption } from './entities/offer-consumption.entity';
import { DiscountType } from './discount-type.enum';
import { OfferMechanism } from './offer-mechanism.enum';
import { PricingUnit } from '../products/pricing-unit.enum';

function makeFlashSaleOffer(overrides: Partial<Offer> = {}): Offer {
  const now = new Date();
  return {
    id: randomUUID(),
    vendorBranchId: 'branch-1',
    name: 'Test Flash Sale',
    mechanism: OfferMechanism.FLASH_SALE,
    discountType: null,
    discountValue: null,
    minimumEligibleSubtotalMinor: null,
    maximumDiscountMinor: null,
    specialPriceMinor: 2000, // 20 EGP special price
    startAt: new Date(now.getTime() - 1000 * 60 * 60),
    endAt: new Date(now.getTime() + 1000 * 60 * 60),
    isActive: true,
    perOrderLimit: null,
    perCustomerLifetimeLimit: null,
    totalAllocationLimit: null,
    budgetCapMinor: null,
    consumedUnitsCount: 0,
    consumedDiscountMinor: 0,
    ...overrides,
  } as Offer;
}

function makeSubtotalDiscountOffer(overrides: Partial<Offer> = {}): Offer {
  const now = new Date();
  return {
    id: randomUUID(),
    vendorBranchId: 'branch-1',
    name: 'Test Subtotal Discount',
    mechanism: OfferMechanism.SUBTOTAL_DISCOUNT,
    discountType: DiscountType.PERCENTAGE,
    discountValue: 1000, // 10%
    minimumEligibleSubtotalMinor: null,
    maximumDiscountMinor: null,
    specialPriceMinor: null,
    startAt: new Date(now.getTime() - 1000 * 60 * 60),
    endAt: new Date(now.getTime() + 1000 * 60 * 60),
    isActive: true,
    perOrderLimit: null,
    perCustomerLifetimeLimit: null,
    totalAllocationLimit: null,
    budgetCapMinor: null,
    consumedUnitsCount: 0,
    consumedDiscountMinor: 0,
    ...overrides,
  } as Offer;
}

/**
 * Faithful in-memory simulation of the manager calls
 * OfferConsumptionService actually issues — including manager.count
 * (needed for branch-wide-targeting detection, new in this chunk),
 * not merely asserting methods were called.
 */
function buildHarness(params: {
  offers: Offer[];
  offerProducts?: OfferProduct[];
  offerCategories?: OfferCategory[];
  existingConsumptions?: OfferConsumption[];
}) {
  const offers = new Map(params.offers.map((o) => [o.id, o]));
  const offerProducts = params.offerProducts ?? [];
  const offerCategories = params.offerCategories ?? [];
  const consumptions = new Map<string, any>((params.existingConsumptions ?? []).map((c) => [c.id ?? randomUUID(), c]));

  function matchesWhere(row: any, where: any): boolean {
    return Object.entries(where).every(([key, value]) => {
      // TypeORM's real In() returns a FindOperator instance exposing
      // `.value` (the array) — detected generically here (rather than
      // importing typeorm's FindOperator class) since the real
      // service code under test uses the actual `In()` from typeorm,
      // not a test double.
      if (value && typeof value === 'object' && 'value' in (value as any) && Array.isArray((value as any).value)) {
        return (value as any).value.includes(row[key]);
      }
      return row[key] === value;
    });
  }

  const manager = {
    find: async (EntityClass: any, opts: any) => {
      const where = opts.where ?? {};
      if (EntityClass === OfferProduct) return offerProducts.filter((r) => matchesWhere(r, where));
      if (EntityClass === OfferCategory) return offerCategories.filter((r) => matchesWhere(r, where));
      if (EntityClass === Offer) return [...offers.values()].filter((o) => matchesWhere(o, where));
      if (EntityClass === OfferConsumption) return [...consumptions.values()].filter((c) => matchesWhere(c, where));
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
      if (EntityClass === OfferConsumption) return [...consumptions.values()].filter((c) => matchesWhere(c, where)).length;
      throw new Error(`unhandled count ${EntityClass.name}`);
    },
    create: (EntityClass: any, data: any) => {
      // Mirrors the real entity's own DB-level column default (see
      // OfferConsumption's `@Column({ name: 'is_reversed', type:
      // 'boolean', default: false })`) — finalizeConsumption's real
      // production call never sets `isReversed` explicitly, relying
      // on Postgres to default it to `false`. Without this, a row
      // created here has `isReversed: undefined`, which the `find`
      // mock's strict `row[key] === value` equality never matches
      // against a later `where: { isReversed: false }` query — so
      // reverseFlashSaleConsumptionForOrder would silently find
      // nothing to reverse at all, the exact bug this mock previously
      // hid instead of catching.
      if (EntityClass === OfferConsumption) return { isReversed: false, ...data };
      return { ...data };
    },
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === OfferConsumption) consumptions.set(withId.id, withId);
      else if (EntityClass === Offer) offers.set(withId.id, withId);
      return withId;
    },
    createQueryBuilder: (EntityClass: any, _alias: string) => {
      if (EntityClass === Offer) {
        // planCouponForCart: `WHERE lower(offer.coupon_code) = lower(:code)` → getOne()
        const oqb: any = {
          _code: '',
          where: (_sql: string, p: any) => {
            oqb._code = String(p.code).toLowerCase();
            return oqb;
          },
          getOne: async () => [...offers.values()].find((o) => (o.couponCode ?? '').toLowerCase() === oqb._code) ?? null,
        };
        return oqb;
      }
      if (EntityClass !== OfferConsumption) throw new Error('unhandled createQueryBuilder');
      const qb: any = {
        _where: {} as any,
        select: () => qb,
        where: (_sql: string, p: any) => {
          qb._where = p;
          return qb;
        },
        getRawOne: async () => {
          // Mirrors the REAL query's own `AND c.is_reversed = false`
          // clause (see sumCustomerConsumedQuantity's own comment:
          // "reversed rows are excluded from the customer's cumulative
          // usage, per the FINAL approved rule") — without this, a
          // cancelled/reversed Flash Sale consumption would still
          // count against the customer's lifetime limit forever,
          // which is exactly the bug this mock previously hid rather
          // than caught.
          const sum = [...consumptions.values()]
            .filter((c) => c.offerId === qb._where.offerId && c.customerId === qb._where.customerId && !c.isReversed)
            .reduce((acc, c) => acc + c.quantityConsumed, 0);
          return { sum: String(sum) };
        },
      };
      return qb;
    },
  };

  const dataSource = { manager };
  const financialEventService = { record: jest.fn(async () => undefined) };
  const service = new OfferConsumptionService(dataSource as any, financialEventService as any);
  return { service, manager, offers, offerProducts, offerCategories, consumptions, financialEventService };
}

function makeProductCandidate(overrides: Partial<OfferCandidateItem> = {}): OfferCandidateItem {
  return {
    cartItemId: 'item-1',
    vendorBranchId: 'branch-1',
    productId: 'product-1',
    categoryId: 'category-1',
    quantity: 1,
    unitPriceMinor: 3000, // 30 EGP
    pricingUnit: PricingUnit.PIECE,
    ...overrides,
  };
}

describe('OfferConsumptionService — FLASH_SALE', () => {
  it('computes the discount as (unit price - special price), never a percentage', async () => {
    const offer = makeFlashSaleOffer({ specialPriceMinor: 2000 });
    const { service, manager } = buildHarness({
      offers: [offer],
      offerProducts: [{ id: 'op1', offerId: offer.id, productId: 'product-1' } as OfferProduct],
    });
    const { plans } = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ unitPriceMinor: 3000, quantity: 2 })],
    });
    const plan = plans.get('item-1')!;
    expect(plan.discountPerUnitMinor).toBe(1000); // 3000 - 2000
    expect(plan.discountAmountMinor).toBe(2000); // 2 units * 1000
  });

  it('branch-wide targeting: an offer with no OfferProduct/OfferCategory rows matches every product in its branch', async () => {
    const offer = makeFlashSaleOffer();
    const { service, manager } = buildHarness({ offers: [offer] }); // no targeting rows at all
    const { plans } = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate()],
    });
    expect(plans.has('item-1')).toBe(true);
  });

  it('CRITICAL: WEIGHT products are never eligible', async () => {
    const offer = makeFlashSaleOffer();
    const { service, manager } = buildHarness({ offers: [offer] });
    const { plans } = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ pricingUnit: PricingUnit.WEIGHT })],
    });
    expect(plans.size).toBe(0);
  });

  it('expired offer does not match', async () => {
    const now = new Date();
    const offer = makeFlashSaleOffer({ startAt: new Date(now.getTime() - 2000), endAt: new Date(now.getTime() - 1000) });
    const { service, manager } = buildHarness({ offers: [offer] });
    const { plans } = await service.planFlashSaleForCart(manager as any, { customerId: 'cust-1', items: [makeProductCandidate()] });
    expect(plans.size).toBe(0);
  });

  it('inactive offer does not match', async () => {
    const offer = makeFlashSaleOffer({ isActive: false });
    const { service, manager } = buildHarness({ offers: [offer] });
    const { plans } = await service.planFlashSaleForCart(manager as any, { customerId: 'cust-1', items: [makeProductCandidate()] });
    expect(plans.size).toBe(0);
  });

  it('CRITICAL: cumulative customer limit across multiple prior orders is summed correctly, and remaining allowance is accepted', async () => {
    const offer = makeFlashSaleOffer({ perCustomerLifetimeLimit: 2000 }); // 2kg-equivalent units
    const existing = [
      { id: 'c1', offerId: offer.id, customerId: 'cust-1', quantityConsumed: 1000 } as any,
      { id: 'c2', offerId: offer.id, customerId: 'cust-1', quantityConsumed: 500 } as any,
    ];
    const { service, manager } = buildHarness({ offers: [offer], existingConsumptions: existing });
    // Remaining = 2000 - 1500 = 500. Requesting 500 must succeed.
    const { plans } = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 500 })],
    });
    expect(plans.get('item-1')!.discountedQuantity).toBe(500);
  });

  it('CRITICAL: exceeding the cumulative customer limit REJECTS (throws), never clamps or splits', async () => {
    const offer = makeFlashSaleOffer({ perCustomerLifetimeLimit: 2000 });
    const existing = [
      { id: 'c1', offerId: offer.id, customerId: 'cust-1', quantityConsumed: 1000 } as any,
      { id: 'c2', offerId: offer.id, customerId: 'cust-1', quantityConsumed: 500 } as any,
    ];
    const { service, manager } = buildHarness({ offers: [offer], existingConsumptions: existing });
    let caught: any;
    try {
      await service.planFlashSaleForCart(manager as any, {
        customerId: 'cust-1',
        items: [makeProductCandidate({ quantity: 1000 })], // remaining is only 500
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FlashSaleLimitExceededException);
    expect(caught.getResponse().details.code).toBe('FLASH_SALE_LIMIT_EXCEEDED');
    expect(caught.getResponse().details.limitType).toBe('CUSTOMER');
    expect(caught.getResponse().details.remaining).toBe(500);
    expect(caught.getResponse().details.requested).toBe(1000);
  });

  it('CRITICAL: exceeding the GLOBAL allocation REJECTS, never clamps', async () => {
    const offer = makeFlashSaleOffer({ totalAllocationLimit: 500000, consumedUnitsCount: 499000 }); // 500kg total, 499kg consumed
    const { service, manager } = buildHarness({ offers: [offer] });
    let caught: any;
    try {
      await service.planFlashSaleForCart(manager as any, {
        customerId: 'cust-1',
        items: [makeProductCandidate({ quantity: 2000 })], // remaining is only 1000
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FlashSaleLimitExceededException);
    expect(caught.getResponse().details.limitType).toBe('GLOBAL');
    expect(caught.getResponse().details.remaining).toBe(1000);
  });

  it('perOrderLimit (a single-order cap, distinct from cumulative limits) still clamps rather than rejects', async () => {
    const offer = makeFlashSaleOffer({ perOrderLimit: 300 });
    const { service, manager } = buildHarness({ offers: [offer] });
    const { plans } = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 1000 })],
    });
    expect(plans.get('item-1')!.discountedQuantity).toBe(300);
  });

  it('historical snapshot: finalizeConsumption preserves the special price and mechanism', async () => {
    const offer = makeFlashSaleOffer({ specialPriceMinor: 1500 });
    const { service, manager, consumptions } = buildHarness({ offers: [offer] });
    const { plans } = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ unitPriceMinor: 3000, quantity: 1 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });
    const consumption = [...consumptions.values()][0];
    expect(consumption.mechanismSnapshot).toBe('FLASH_SALE');
    expect(consumption.specialPriceMinorSnapshot).toBe(1500);
    expect(consumption.orderItemId).toBe('oi-1');
  });
});

describe('OfferConsumptionService — SUBTOTAL_DISCOUNT', () => {
  it('percentage discount off the eligible subtotal', async () => {
    const offer = makeSubtotalDiscountOffer({ discountType: DiscountType.PERCENTAGE, discountValue: 1000 }); // 10%
    const { service, manager } = buildHarness({ offers: [offer] }); // branch-wide
    const items = [makeProductCandidate({ unitPriceMinor: 50000, quantity: 1 })]; // 500 EGP eligible subtotal
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan!.eligibleSubtotalMinor).toBe(50000);
    expect(plan!.discountAmountMinor).toBe(5000); // 10% of 500 EGP = 50 EGP
  });

  it('fixed discount off the eligible subtotal, never exceeding it', async () => {
    const offer = makeSubtotalDiscountOffer({ discountType: DiscountType.FIXED, discountValue: 100000 }); // 1000 EGP fixed
    const { service, manager } = buildHarness({ offers: [offer] });
    const items = [makeProductCandidate({ unitPriceMinor: 30000, quantity: 1 })]; // only 300 EGP eligible
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan!.discountAmountMinor).toBe(30000); // never more than the eligible subtotal itself
  });

  it('product targeting: only the targeted product contributes to eligible subtotal', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service, manager } = buildHarness({
      offers: [offer],
      offerProducts: [{ id: 'op1', offerId: offer.id, productId: 'product-A' } as OfferProduct],
    });
    const items = [
      makeProductCandidate({ cartItemId: 'a', productId: 'product-A', unitPriceMinor: 10000, quantity: 1 }),
      makeProductCandidate({ cartItemId: 'b', productId: 'product-B', unitPriceMinor: 10000, quantity: 1 }),
    ];
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan!.eligibleSubtotalMinor).toBe(10000); // only product-A's line, not product-B's
  });

  it('category targeting: only items in the targeted category contribute', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service, manager } = buildHarness({
      offers: [offer],
      offerCategories: [{ id: 'oc1', offerId: offer.id, productCategoryId: 'cat-X' } as OfferCategory],
    });
    const items = [
      makeProductCandidate({ cartItemId: 'a', categoryId: 'cat-X', unitPriceMinor: 10000, quantity: 1 }),
      makeProductCandidate({ cartItemId: 'b', categoryId: 'cat-Y', unitPriceMinor: 10000, quantity: 1 }),
    ];
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan!.eligibleSubtotalMinor).toBe(10000);
  });

  it('CRITICAL: below minimumEligibleSubtotal produces zero discount (no plan)', async () => {
    const offer = makeSubtotalDiscountOffer({ minimumEligibleSubtotalMinor: 100000 }); // 1000 EGP minimum
    const { service, manager } = buildHarness({ offers: [offer] });
    const items = [makeProductCandidate({ unitPriceMinor: 50000, quantity: 1 })]; // only 500 EGP
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan).toBeNull();
  });

  it('CRITICAL: maximumDiscount caps the calculated discount', async () => {
    const offer = makeSubtotalDiscountOffer({ discountType: DiscountType.PERCENTAGE, discountValue: 2000, maximumDiscountMinor: 5000 }); // 20%, capped at 50 EGP
    const { service, manager } = buildHarness({ offers: [offer] });
    const items = [makeProductCandidate({ unitPriceMinor: 100000, quantity: 1 })]; // 1000 EGP eligible -> 20% = 200 EGP uncapped
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan!.discountAmountMinor).toBe(5000); // capped, not 20000
  });

  it('no eligible items produces no plan', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service, manager } = buildHarness({ offers: [], offerProducts: [] });
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items: [],
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan).toBeNull();
  });

  it('CRITICAL: an item already claimed by a FLASH_SALE plan is excluded from the eligible subtotal (mutual exclusion defense in depth)', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service, manager } = buildHarness({ offers: [offer] });
    const items = [
      makeProductCandidate({ cartItemId: 'flash-saled', unitPriceMinor: 10000, quantity: 1 }),
      makeProductCandidate({ cartItemId: 'normal', unitPriceMinor: 10000, quantity: 1 }),
    ];
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(['flash-saled']),
    });
    expect(plan!.eligibleSubtotalMinor).toBe(10000); // only 'normal', not both
  });

  it('WEIGHT products are excluded from eligible subtotal', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service, manager } = buildHarness({ offers: [offer] });
    const items = [makeProductCandidate({ pricingUnit: PricingUnit.WEIGHT, unitPriceMinor: 10000, quantity: 1 })];
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    expect(plan).toBeNull();
  });

  it('historical snapshot: finalizeConsumption preserves discount type/value/eligible subtotal for a segment', async () => {
    const offer = makeSubtotalDiscountOffer({ discountType: DiscountType.PERCENTAGE, discountValue: 1000 });
    const { service, manager, consumptions } = buildHarness({ offers: [offer] });
    const items = [makeProductCandidate({ unitPriceMinor: 50000, quantity: 1 })];
    const { plan } = await service.planSubtotalDiscountForSegment(manager as any, {
      vendorBranchId: 'branch-1',
      items,
      alreadyFlashSaledCartItemIds: new Set(),
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: new Map(),
      orderItemIdByCartItemId: new Map(),
      segmentPlans: [{ plan: plan!, orderVendorSegmentId: 'seg-1' }],
    });
    const consumption = [...consumptions.values()][0];
    expect(consumption.mechanismSnapshot).toBe('SUBTOTAL_DISCOUNT');
    expect(consumption.discountTypeSnapshot).toBe(DiscountType.PERCENTAGE);
    expect(consumption.discountValueSnapshot).toBe(1000);
    expect(consumption.eligibleSubtotalMinorSnapshot).toBe(50000);
    expect(consumption.orderVendorSegmentId).toBe('seg-1');
  });
});

describe('OfferConsumptionService — concurrency-sensitive consumption (deterministic, sequential simulation)', () => {
  // True parallel DB execution is not available in this sandbox (no
  // Node/database toolchain — see every other test file in this
  // project for the same standing limitation). This test does NOT
  // claim to prove true concurrent-request safety; it instead
  // exercises the actual guard logic against a shared Offer object
  // reference across two SEQUENTIAL plan+finalize cycles — verifying
  // that the second cycle correctly observes the first's already-
  // committed consumption before making its own allocation decision,
  // which is the exact mechanism (reading the LOCKED, up-to-date
  // Offer row before deciding) that makes real concurrent requests
  // safe when a real pessimistic_write lock serializes them in
  // Postgres. Static/logical verification only, stated explicitly.
  it('CRITICAL: FLASH_SALE global allocation — a second request cannot consume allocation the first already claimed', async () => {
    const offer = makeFlashSaleOffer({ totalAllocationLimit: 2000 }); // 2kg total
    const { service, manager } = buildHarness({ offers: [offer] });

    // First "concurrent" request consumes the full 2kg.
    const first = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-A',
      items: [makeProductCandidate({ cartItemId: 'first', quantity: 2000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-A',
      orderId: 'order-A',
      itemPlans: first.plans,
      orderItemIdByCartItemId: new Map([['first', 'oi-A']]),
    });

    // Second request, against the SAME offer row (now updated with
    // consumedUnitsCount=2000), must be rejected — never allowed to
    // also consume from the now-exhausted allocation.
    let caught: any;
    try {
      await service.planFlashSaleForCart(manager as any, {
        customerId: 'cust-B',
        items: [makeProductCandidate({ cartItemId: 'second', quantity: 1 })],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught.getResponse().details.remaining).toBe(0);
  });

  it('CRITICAL: legitimate separate customers CAN both consume the same Offer while allocation remains — concurrency protection only blocks OVER-consumption, not all consumption', async () => {
    const offer = makeFlashSaleOffer({ totalAllocationLimit: 2000 });
    const { service, manager } = buildHarness({ offers: [offer] });

    const first = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-A',
      items: [makeProductCandidate({ cartItemId: 'first', quantity: 1000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-A',
      orderId: 'order-A',
      itemPlans: first.plans,
      orderItemIdByCartItemId: new Map([['first', 'oi-A']]),
    });

    // 1000 remains — a second, different customer requesting 1000
    // (not exceeding what's left) must succeed.
    const second = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-B',
      items: [makeProductCandidate({ cartItemId: 'second', quantity: 1000 })],
    });
    expect(second.plans.get('second')!.discountedQuantity).toBe(1000);
  });
});

describe('OfferConsumptionService.reverseFlashSaleConsumptionForOrder — Flash Sale cancellation reversal (FINAL approved rule)', () => {
  it('an active consumption counts toward customer/global usage', async () => {
    const offer = makeFlashSaleOffer({ perCustomerLifetimeLimit: 2000 });
    const { service, manager } = buildHarness({ offers: [offer] });
    const plans = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 2000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });
    // Fully consumed — a second request must now be rejected.
    await expect(
      service.planFlashSaleForCart(manager as any, { customerId: 'cust-1', items: [makeProductCandidate({ quantity: 1 })] }),
    ).rejects.toThrow(FlashSaleLimitExceededException);
  });

  it('CRITICAL: cancellation reverses the consumption and restores the customer allowance', async () => {
    const offer = makeFlashSaleOffer({ perCustomerLifetimeLimit: 2000 });
    const { service, manager } = buildHarness({ offers: [offer] });
    const plans = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 2000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });

    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-1');

    // Full 2000 allowance restored — a new request for the full amount now succeeds.
    const secondAttempt = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ cartItemId: 'item-2', quantity: 2000 })],
    });
    expect(secondAttempt.plans.get('item-2')!.discountedQuantity).toBe(2000);
  });

  it('CRITICAL: cancellation restores the GLOBAL allocation', async () => {
    const offer = makeFlashSaleOffer({ totalAllocationLimit: 2000 });
    const { service, manager } = buildHarness({ offers: [offer] });
    const plans = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 2000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });

    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-1');

    const stored = (await manager.findOne(Offer, { where: { id: offer.id } }))!;
    expect(stored.consumedUnitsCount).toBe(0);

    // A DIFFERENT customer can now use the fully-restored allocation.
    const newCustomerAttempt = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-2',
      items: [makeProductCandidate({ cartItemId: 'item-2', quantity: 2000 })],
    });
    expect(newCustomerAttempt.plans.get('item-2')!.discountedQuantity).toBe(2000);
  });

  it('CRITICAL: preserves the historical audit record — quantityConsumed/discountAppliedMinor/snapshots remain unchanged, only isReversed/reversedAt change', async () => {
    const offer = makeFlashSaleOffer({ specialPriceMinor: 1500 });
    const { service, manager, consumptions } = buildHarness({ offers: [offer] });
    const plans = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ unitPriceMinor: 3000, quantity: 1 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });
    const before = { ...[...consumptions.values()][0] };

    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-1');

    const after = [...consumptions.values()][0];
    expect(after.isReversed).toBe(true);
    expect(after.reversedAt).toBeInstanceOf(Date);
    // Nothing else about the historical record changed.
    expect(after.quantityConsumed).toBe(before.quantityConsumed);
    expect(after.discountAppliedMinor).toBe(before.discountAppliedMinor);
    expect(after.specialPriceMinorSnapshot).toBe(before.specialPriceMinorSnapshot);
    expect(after.orderId).toBe(before.orderId);
  });

  it('CRITICAL IDEMPOTENCY: calling reverseFlashSaleConsumptionForOrder twice for the same order never double-restores the allocation', async () => {
    const offer = makeFlashSaleOffer({ totalAllocationLimit: 2000 });
    const { service, manager } = buildHarness({ offers: [offer] });
    const plans = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 1000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });

    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-1');
    const afterFirstReversal = (await manager.findOne(Offer, { where: { id: offer.id } }))!.consumedUnitsCount;
    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-1'); // second call — must be a no-op
    const afterSecondReversal = (await manager.findOne(Offer, { where: { id: offer.id } }))!.consumedUnitsCount;

    expect(afterFirstReversal).toBe(0);
    expect(afterSecondReversal).toBe(0); // never went negative, never double-adjusted
  });

  it('does NOT create negative consumedUnitsCount even in a hypothetical inconsistent-state scenario', async () => {
    const offer = makeFlashSaleOffer({ totalAllocationLimit: 2000, consumedUnitsCount: 500 }); // already inconsistent on purpose
    const { service, manager } = buildHarness({ offers: [offer] });
    const plans = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-1',
      items: [makeProductCandidate({ quantity: 500 })], // remaining is 1500, request 500 succeeds
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-1',
      orderId: 'order-1',
      itemPlans: plans.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-1']]),
    });
    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-1');
    const stored = (await manager.findOne(Offer, { where: { id: offer.id } }))!;
    expect(stored.consumedUnitsCount).toBe(500); // back to the pre-consumption baseline, never negative
    expect(stored.consumedUnitsCount).toBeGreaterThanOrEqual(0);
  });

  it('CRITICAL: cancelling one customer\u2019s order does not affect a DIFFERENT customer\u2019s consumption', async () => {
    const offer = makeFlashSaleOffer({ perCustomerLifetimeLimit: 1000 });
    const { service, manager } = buildHarness({ offers: [offer] });

    const plansA = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-A',
      items: [makeProductCandidate({ quantity: 1000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-A',
      orderId: 'order-A',
      itemPlans: plansA.plans,
      orderItemIdByCartItemId: new Map([['item-1', 'oi-A']]),
    });

    const plansB = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-B',
      items: [makeProductCandidate({ cartItemId: 'item-b', quantity: 1000 })],
    });
    await service.finalizeConsumption(manager as any, {
      customerId: 'cust-B',
      orderId: 'order-B',
      itemPlans: plansB.plans,
      orderItemIdByCartItemId: new Map([['item-b', 'oi-B']]),
    });

    // Cancel only customer A's order.
    await service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-A');

    // Customer A is fully restored...
    const aRetry = await service.planFlashSaleForCart(manager as any, {
      customerId: 'cust-A',
      items: [makeProductCandidate({ cartItemId: 'item-a2', quantity: 1000 })],
    });
    expect(aRetry.plans.get('item-a2')!.discountedQuantity).toBe(1000);

    // ...but customer B's own (unrelated, un-cancelled) consumption is untouched — still exhausted.
    await expect(
      service.planFlashSaleForCart(manager as any, {
        customerId: 'cust-B',
        items: [makeProductCandidate({ cartItemId: 'item-b2', quantity: 1 })],
      }),
    ).rejects.toThrow(FlashSaleLimitExceededException);
  });

  it('reversing an order with no FLASH_SALE consumption is a safe no-op', async () => {
    const offer = makeFlashSaleOffer();
    const { service, manager } = buildHarness({ offers: [offer] });
    await expect(service.reverseFlashSaleConsumptionForOrder(manager as any, 'order-never-consumed')).resolves.toBeUndefined();
  });
});

describe('OfferConsumptionService.resolveActiveOffersForProducts — Customer Product-Level Offers Display', () => {
  it('resolves FLASH_SALE for a directly-targeted product', async () => {
    const offer = makeFlashSaleOffer({ specialPriceMinor: 2000 });
    const { service } = buildHarness({
      offers: [offer],
      offerProducts: [{ id: 'op1', offerId: offer.id, productId: 'product-1' } as OfferProduct],
    });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [{ productId: 'product-1', categoryId: 'category-1' }],
    });
    expect(result.get('product-1')).toEqual({ mechanism: 'FLASH_SALE', specialPriceMinor: 2000 });
  });

  it('resolves a SUBTOTAL_DISCOUNT presence-only signal — no discountType/discountValue leaked', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service } = buildHarness({
      offers: [offer],
      offerProducts: [{ id: 'op1', offerId: offer.id, productId: 'product-1' } as OfferProduct],
    });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [{ productId: 'product-1', categoryId: 'category-1' }],
    });
    expect(result.get('product-1')).toEqual({ mechanism: 'SUBTOTAL_DISCOUNT' });
  });

  it('CRITICAL: branch-wide offer (no targeting rows) matches every product in the branch', async () => {
    const offer = makeFlashSaleOffer();
    const { service } = buildHarness({ offers: [offer] }); // no offerProducts/offerCategories at all
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [
        { productId: 'product-1', categoryId: 'category-1' },
        { productId: 'product-2', categoryId: 'category-2' },
      ],
    });
    expect(result.get('product-1')?.mechanism).toBe('FLASH_SALE');
    expect(result.get('product-2')?.mechanism).toBe('FLASH_SALE');
  });

  it('category targeting: only products in the targeted category resolve', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service } = buildHarness({
      offers: [offer],
      offerCategories: [{ id: 'oc1', offerId: offer.id, productCategoryId: 'cat-X' } as OfferCategory],
    });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [
        { productId: 'product-1', categoryId: 'cat-X' },
        { productId: 'product-2', categoryId: 'cat-Y' },
      ],
    });
    expect(result.has('product-1')).toBe(true);
    expect(result.has('product-2')).toBe(false);
  });

  it('CRITICAL: does not confuse "no targeting rows" (branch-wide) with "targeting rows exist but did not match"', async () => {
    const offer = makeSubtotalDiscountOffer();
    const { service } = buildHarness({
      offers: [offer],
      offerProducts: [{ id: 'op1', offerId: offer.id, productId: 'product-1' } as OfferProduct], // explicitly targeted, NOT branch-wide
    });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [
        { productId: 'product-1', categoryId: 'category-1' },
        { productId: 'product-999-unrelated', categoryId: 'category-999' },
      ],
    });
    expect(result.has('product-1')).toBe(true);
    expect(result.has('product-999-unrelated')).toBe(false); // must NOT be treated as branch-wide
  });

  it('CRITICAL: VendorBranch isolation — an offer in a different branch never matches', async () => {
    const offer = makeFlashSaleOffer({ vendorBranchId: 'branch-OTHER' });
    const { service } = buildHarness({ offers: [offer] });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [{ productId: 'product-1', categoryId: 'category-1' }],
    });
    expect(result.size).toBe(0);
  });

  it('expired and inactive offers are excluded', async () => {
    const now = new Date();
    const expired = makeFlashSaleOffer({ startAt: new Date(now.getTime() - 2000), endAt: new Date(now.getTime() - 1000) });
    const inactive = makeSubtotalDiscountOffer({ isActive: false });
    const { service } = buildHarness({ offers: [expired, inactive] });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [{ productId: 'product-1', categoryId: 'category-1' }],
    });
    expect(result.size).toBe(0);
  });

  it('CRITICAL: resolves MANY products using a bounded, small number of queries — never one query per product (no N+1)', async () => {
    const offer = makeFlashSaleOffer();
    const { service, manager } = buildHarness({ offers: [offer] });
    const findSpy = jest.spyOn(manager, 'find');
    const products = Array.from({ length: 50 }, (_, i) => ({ productId: `p${i}`, categoryId: `c${i}` }));

    await service.resolveActiveOffersForProducts({ vendorBranchId: 'branch-1', products });

    // Exactly 3 find() calls regardless of product count: Offer, OfferProduct, OfferCategory.
    expect(findSpy).toHaveBeenCalledTimes(3);
  });

  it('multiple matching FLASH_SALE offers: the lowest special price wins ("best offer")', async () => {
    const worse = makeFlashSaleOffer({ specialPriceMinor: 2500 });
    const better = makeFlashSaleOffer({ specialPriceMinor: 1500 });
    const { service } = buildHarness({
      offers: [worse, better],
      offerProducts: [
        { id: 'op1', offerId: worse.id, productId: 'product-1' } as OfferProduct,
        { id: 'op2', offerId: better.id, productId: 'product-1' } as OfferProduct,
      ],
    });
    const result = await service.resolveActiveOffersForProducts({
      vendorBranchId: 'branch-1',
      products: [{ productId: 'product-1', categoryId: 'category-1' }],
    });
    expect(result.get('product-1')?.specialPriceMinor).toBe(1500);
  });
});

function makeCoupon(overrides: Partial<Offer> = {}): Offer {
  return makeSubtotalDiscountOffer({ couponCode: 'SAVE10', ...overrides });
}
const couponSegments = (items: OfferCandidateItem[] = [makeProductCandidate()]) => [{ groupIndex: 0, vendorBranchId: 'branch-1', items }];
const planCoupon = (h: ReturnType<typeof buildHarness>, over: any = {}) =>
  h.service.planCouponForCart(h.manager as any, { code: 'save10', customerId: 'cust-1', segments: couponSegments(), alreadyFlashSaledCartItemIds: new Set<string>(), ...over });

describe('OfferConsumptionService — COUPON codes (PD-006)', () => {
  it('a coupon offer is NEVER applied automatically — neither as a flash sale nor as a subtotal discount', async () => {
    const h = buildHarness({ offers: [makeCoupon()] });
    const { plan } = await h.service.planSubtotalDiscountForSegment(h.manager as any, { vendorBranchId: 'branch-1', items: [makeProductCandidate({ quantity: 2 })], alreadyFlashSaledCartItemIds: new Set() });
    expect(plan).toBeNull();
  });

  it('applies for the entered code, case-insensitively, to ITS vendor segment only: 10% of the eligible subtotal', async () => {
    const h = buildHarness({ offers: [makeCoupon()] });
    const r = await planCoupon(h, { segments: [...couponSegments([makeProductCandidate({ quantity: 2 })]), { groupIndex: 1, vendorBranchId: 'branch-2', items: [makeProductCandidate({ cartItemId: 'i2', vendorBranchId: 'branch-2' })] }] });
    expect(r).toMatchObject({ status: 'APPLIED', groupIndex: 0, vendorBranchId: 'branch-1', code: 'SAVE10' });
    if (r.status === 'APPLIED') expect(r.plan).toMatchObject({ eligibleSubtotalMinor: 6000, discountAmountMinor: 600 });
  });

  it.each([
    ['unknown code', () => [makeCoupon()], { code: 'nope' }, 'COUPON_NOT_FOUND'],
    ['a non-coupon offer is not a coupon', () => [makeSubtotalDiscountOffer()], {}, 'COUPON_NOT_FOUND'],
    ['a flash-sale offer is never a coupon', () => [makeFlashSaleOffer({ couponCode: 'SAVE10' })], {}, 'COUPON_NOT_FOUND'],
    ['inactive', () => [makeCoupon({ isActive: false })], {}, 'COUPON_INACTIVE'],
    ['not started', () => [makeCoupon({ startAt: new Date(Date.now() + 3_600_000), endAt: new Date(Date.now() + 7_200_000) })], {}, 'COUPON_NOT_STARTED'],
    ['expired', () => [makeCoupon({ startAt: new Date(Date.now() - 7_200_000), endAt: new Date(Date.now() - 3_600_000) })], {}, 'COUPON_EXPIRED'],
    ['vendor not in the cart', () => [makeCoupon({ vendorBranchId: 'branch-9' })], {}, 'COUPON_NOT_APPLICABLE_TO_CART'],
    ['minimum not met', () => [makeCoupon({ minimumEligibleSubtotalMinor: 999999 })], {}, 'COUPON_MINIMUM_NOT_MET'],
    ['global usage limit reached', () => [makeCoupon({ totalAllocationLimit: 5, consumedUnitsCount: 5 })], {}, 'COUPON_USAGE_LIMIT_REACHED'],
    ['budget exhausted', () => [makeCoupon({ budgetCapMinor: 1000, consumedDiscountMinor: 1000 })], {}, 'COUPON_BUDGET_EXHAUSTED'],
    ['only weighed items in the cart', () => [makeCoupon()], { segments: couponSegments([makeProductCandidate({ pricingUnit: PricingUnit.WEIGHT })]) }, 'COUPON_NO_ELIGIBLE_ITEMS'],
    ['the only item is already on flash sale', () => [makeCoupon()], { alreadyFlashSaledCartItemIds: new Set(['item-1']) }, 'COUPON_NO_ELIGIBLE_ITEMS'],
  ])('rejects: %s → %s', async (_label, offers, over, reason) => {
    const r = await planCoupon(buildHarness({ offers: offers() }), over);
    expect(r).toMatchObject({ status: 'REJECTED', reasonCode: reason });
  });

  it('the per-customer limit counts that customer\'s own past uses (not other customers\')', async () => {
    const offer = makeCoupon({ perCustomerLifetimeLimit: 1 });
    const used = (customerId: string) => ({ id: randomUUID(), offerId: offer.id, customerId, mechanismSnapshot: OfferMechanism.SUBTOTAL_DISCOUNT, isReversed: false }) as any;
    expect(await planCoupon(buildHarness({ offers: [offer], existingConsumptions: [used('cust-1')] }))).toMatchObject({ status: 'REJECTED', reasonCode: 'COUPON_CUSTOMER_LIMIT_REACHED' });
    expect(await planCoupon(buildHarness({ offers: [offer], existingConsumptions: [used('someone-else')] }))).toMatchObject({ status: 'APPLIED' });
  });

  it('the discount is capped by what is left of the budget, and by the maximum discount', async () => {
    const budget = await planCoupon(buildHarness({ offers: [makeCoupon({ discountType: DiscountType.FIXED, discountValue: 800, budgetCapMinor: 1000, consumedDiscountMinor: 800 })] }));
    if (budget.status === 'APPLIED') expect(budget.plan.discountAmountMinor).toBe(200);
    const max = await planCoupon(buildHarness({ offers: [makeCoupon({ maximumDiscountMinor: 100 })] }));
    if (max.status === 'APPLIED') expect(max.plan.discountAmountMinor).toBe(100);
  });

  it('a coupon over targeted products discounts only those items', async () => {
    const offer = makeCoupon();
    const h = buildHarness({ offers: [offer], offerProducts: [{ offerId: offer.id, productId: 'product-1' } as OfferProduct] });
    const r = await planCoupon(h, { segments: couponSegments([makeProductCandidate(), makeProductCandidate({ cartItemId: 'i2', productId: 'product-2', unitPriceMinor: 5000 })]) });
    if (r.status === 'APPLIED') expect(r.plan.eligibleSubtotalMinor).toBe(3000);
  });

  it('read-only planning (a quote) never asks for the offer row lock', async () => {
    const h = buildHarness({ offers: [makeCoupon()] });
    const spy = jest.spyOn(h.manager, 'findOne');
    await planCoupon(h, { readOnly: true });
    expect(spy.mock.calls.every(([, opts]: any[]) => !opts.lock)).toBe(true);
    spy.mockClear();
    await planCoupon(h);
    expect(spy.mock.calls.some(([, opts]: any[]) => opts.lock?.mode === 'pessimistic_write')).toBe(true);
  });
});

describe('OfferConsumptionService.reverseFlashSaleConsumptionForOrder — per-item (partial vendor cancellation)', () => {
  it('reverses only the given order items; the other vendors\' allocation stays consumed', async () => {
    const offer = makeFlashSaleOffer();
    const h = buildHarness({ offers: [offer] });
    for (const [cartItemId, orderItemId] of [['item-1', 'oi-1'], ['item-2', 'oi-2']]) {
      const plans = await h.service.planFlashSaleForCart(h.manager as any, { customerId: 'cust-1', items: [makeProductCandidate({ cartItemId })] });
      await h.service.finalizeConsumption(h.manager as any, { customerId: 'cust-1', orderId: 'order-1', itemPlans: plans.plans, orderItemIdByCartItemId: new Map([[cartItemId, orderItemId]]) });
    }
    await h.service.reverseFlashSaleConsumptionForOrder(h.manager as any, 'order-1', ['oi-2']);
    const rows = [...h.consumptions.values()];
    expect(rows.find((c) => c.orderItemId === 'oi-2').isReversed).toBe(true);
    expect(rows.find((c) => c.orderItemId === 'oi-1').isReversed).toBe(false);
    expect(h.offers.get(offer.id)!.consumedUnitsCount).toBe(1);
    await h.service.reverseFlashSaleConsumptionForOrder(h.manager as any, 'order-1', []); // nothing to reverse: a no-op
    expect(rows.find((c) => c.orderItemId === 'oi-1').isReversed).toBe(false);
  });
});
