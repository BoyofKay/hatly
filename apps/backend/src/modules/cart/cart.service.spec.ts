import { ConflictException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CartService } from './cart.service';
import { CartPricingService } from './cart-pricing.service';
import { Cart, CartStatus } from './entities/cart.entity';
import { CartVendorGroup } from './entities/cart-vendor-group.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartGroupType } from './cart-group-type.enum';
import { FulfillmentType } from './fulfillment-type.enum';
import { AdHocServiceType } from './ad-hoc-service-type.enum';
import { PricingUnit } from '../products/pricing-unit.enum';

/**
 * A deliberately special-cased in-memory fake, not a generic ORM mock
 * — it only implements the exact query shapes CartService actually
 * issues (see the service's own source), which is enough to exercise
 * its real branch/group/validation logic without a database. Product
 * and VendorBranch fixtures are pre-seeded as fully-formed plain
 * objects (their "relations" are just object properties already set),
 * so no join logic is needed for them; Cart/CartVendorGroup/CartItem
 * ARE assembled dynamically, since those are what the tests create
 * during each call.
 */
function buildHarness(seedProducts: any[], seedBranches: any[]) {
  const carts = new Map<string, any>();
  const groups = new Map<string, any>();
  const items = new Map<string, any>();
  const products = new Map<string, any>(seedProducts.map((p) => [p.id, p]));
  const branches = new Map<string, any>(seedBranches.map((b) => [b.id, b]));

  function loadCartAssembled(cartId: string): Cart | null {
    const cart = carts.get(cartId);
    if (!cart) return null;
    const cartGroups = [...groups.values()].filter((g) => g.cartId === cartId);
    for (const g of cartGroups) {
      g.items = [...items.values()].filter((i) => i.cartVendorGroupId === g.id);
      for (const item of g.items) {
        item.product = item.productId ? products.get(item.productId) ?? null : null;
        item.selectedOptionValues = item.selectedOptionValues ?? [];
      }
    }
    return { ...cart, groups: cartGroups };
  }

  const manager = {
    findOne: async (EntityClass: any, opts: any) => {
      if (EntityClass === Cart) {
        if (opts.where.id) return loadCartAssembled(opts.where.id);
        // plain lookup by customerId/status — raw row is enough (only .id/.fulfillmentType read before replacement)
        return [...carts.values()].find(
          (c) => c.customerId === opts.where.customerId && c.status === opts.where.status,
        ) ?? null;
      }
      if (EntityClass === CartVendorGroup) {
        return [...groups.values()].find((g) => Object.entries(opts.where).every(([k, v]) => g[k] === v)) ?? null;
      }
      if (EntityClass.name === 'Product') {
        return products.get(opts.where.id) ?? null;
      }
      if (EntityClass.name === 'VendorBranch') {
        return branches.get(opts.where.id) ?? null;
      }
      throw new Error(`unhandled manager.findOne for ${EntityClass.name}`);
    },
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === Cart) carts.set(withId.id, withId);
      else if (EntityClass === CartVendorGroup) groups.set(withId.id, withId);
      else if (EntityClass === CartItem) items.set(withId.id, withId);
      else if (Array.isArray(entity)) {
        // CartItemOptionValue[] batch save — not exercised by these tests' assertions, just accept it.
      }
      return withId;
    },
    create: (EntityClass: any, data: any) => ({ ...data }),
    find: async (EntityClass: any, opts: any) => {
      if (EntityClass === CartVendorGroup) {
        return [...groups.values()].filter((g) => g.cartId === opts.where.cartId);
      }
      throw new Error(`unhandled manager.find for ${EntityClass.name}`);
    },
  };

  const cartsRepository = {
    findOne: async (opts: any) => manager.findOne(Cart, opts),
    save: async (entity: any) => manager.save(Cart, entity),
    create: (data: any) => manager.create(Cart, data),
  };

  const branchesRepository = {
    findOne: async (opts: any) => branches.get(opts.where.id) ?? null,
    find: async (opts: any) => {
      const ids = (opts.where as any[]).map((w) => w.id);
      return ids.map((id) => branches.get(id)).filter(Boolean);
    },
  };

  const cartItemRepo = {
    update: async (where: any, patch: any) => {
      const item = items.get(where.id);
      if (item) Object.assign(item, patch);
    },
    findOne: async (opts: any) => {
      const item = items.get(opts.where.id);
      if (!item) return null;
      // PHASE G addition (Weighted Products): attach `.product` when
      // the caller asked for it via `relations` — needed for
      // CartService's pricingUnit guards (updateItemWeight /
      // updateItemQuantity's assertNotWeightedItem).
      const product = item.productId ? products.get(item.productId) ?? null : null;
      return { ...item, cartVendorGroup: groups.get(item.cartVendorGroupId), product };
    },
    delete: async (where: any) => {
      if (where.id) items.delete(where.id);
    },
    count: async (opts: any) =>
      [...items.values()].filter((i) => i.cartVendorGroupId === opts.where.cartVendorGroupId).length,
  };

  const cartVendorGroupRepo = {
    delete: async (where: any) => {
      if (where.id) groups.delete(where.id);
      if (where.cartId) {
        for (const [id, g] of [...groups.entries()]) {
          if (g.cartId === where.cartId) groups.delete(id);
        }
      }
    },
  };

  const dataSource = {
    manager,
    transaction: async (cb: any) => cb(manager),
    getRepository: (EntityClass: any) => {
      if (EntityClass === CartItem) return cartItemRepo;
      if (EntityClass === CartVendorGroup) return cartVendorGroupRepo;
      throw new Error(`unhandled getRepository for ${EntityClass.name}`);
    },
  };

  const uploadsService = {
    findOwnedUrls: jest.fn(async (urls: string[]) => new Set(urls.filter((u) => u.startsWith('stub-upload://owned')))),
  };

  // Not exercised by these tests (no test here calls quoteDeliveryFee) —
  // provided only so CartService's constructor is satisfied.
  const deliveryFeeCalculationService = { calculate: jest.fn() };

  // PHASE G addition (Offers & Promotions). Default: no Offer ever
  // matches — this spec file predates Offers; new Offer-preview tests
  // below construct their own harness with a real preview mock.
  const offerConsumptionService = {
    previewOffersForItems: jest.fn(async (_candidates: any[]) => ({
      flashSalePreviews: new Map(),
      subtotalDiscountPreviews: new Map(),
    })),
  };

  const service = new CartService(
    cartsRepository as any,
    branchesRepository as any,
    dataSource as any,
    new CartPricingService(),
    uploadsService as any,
    deliveryFeeCalculationService as any,
    offerConsumptionService as any,
  );

  return { service, carts, groups, items, offerConsumptionService };
}

function makeProduct(id: string, vendorBranchId: string) {
  return {
    id,
    name: `Product ${id}`,
    priceMinor: 1000,
    isAvailable: true,
    deletedAt: null,
    options: [],
    vendorBranch: { id: vendorBranchId, isActive: true, isOpen: true, vendor: { isActive: true } },
    vendorBranchId,
  };
}

/** `sector`: the branch's marketplace sector — by default one whose admin setting allows custom requests (most tests are about other things). */
function makeBranch(id: string, sector: { isActive: boolean; customRequestsEnabled: boolean } | null = { isActive: true, customRequestsEnabled: true }) {
  return { id, isActive: true, isOpen: true, pickupEnabled: true, vendor: { name: `Vendor ${id}`, isActive: true }, marketplaceSector: sector };
}

describe('CartService', () => {
  it('rejects adding a product to a closed store while retaining menu visibility', async () => {
    const product = makeProduct('p1', 'branch-1');
    product.vendorBranch.isOpen = false;
    const branch = { ...makeBranch('branch-1'), isOpen: false };
    const { service } = buildHarness([product], [branch]);
    await expect(service.addItem('customer-1', { productId: 'p1', quantity: 1 })).rejects.toMatchObject({
      response: { details: { code: 'STORE_CLOSED' } },
    });
  });

  it('rejects a 4th distinct vendor with MAX_VENDOR_GROUPS_EXCEEDED', async () => {
    const products = [1, 2, 3, 4].map((n) => makeProduct(`p${n}`, `branch-${n}`));
    const branches = [1, 2, 3, 4].map((n) => makeBranch(`branch-${n}`));
    const { service } = buildHarness(products, branches);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    await service.addItem('customer-1', { productId: 'p2', quantity: 1 });
    await service.addItem('customer-1', { productId: 'p3', quantity: 1 });

    await expect(service.addItem('customer-1', { productId: 'p4', quantity: 1 })).rejects.toThrow(
      ConflictException,
    );
  });

  it('adding a 2nd item to an already-present vendor group does not count against the 3-group cap', async () => {
    const products = [makeProduct('p1', 'branch-1'), makeProduct('p1b', 'branch-1')];
    const branches = [makeBranch('branch-1')];
    const { service } = buildHarness(products, branches);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const view = await service.addItem('customer-1', { productId: 'p1b', quantity: 1 });

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].items).toHaveLength(2);
  });

  it('creates a new AD_HOC_SERVICE group with a valid owned image', async () => {
    const { service } = buildHarness([], []);

    const view = await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
      freeTextDescription: 'Panadol Extra',
      quantity: 1,
      imageUrls: ['stub-upload://owned/rx.png'],
    });

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].groupType).toBe(CartGroupType.AD_HOC_SERVICE);
    expect(view.groups[0].adHocPlaceName).toBe('Corner Pharmacy');
    expect(view.groups[0].items[0].imageUrls).toEqual(['stub-upload://owned/rx.png']);
    expect(view.groups[0].subtotalMinor).toBeNull();
  });

  it('rejects more than 2 images on an ad-hoc item', async () => {
    const { service } = buildHarness([], []);

    await expect(
      service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
        freeTextDescription: 'Panadol Extra',
        quantity: 1,
        imageUrls: ['stub-upload://owned/1.png', 'stub-upload://owned/2.png', 'stub-upload://owned/3.png'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an image URL that is not a real Hatly upload owned by this customer', async () => {
    const { service } = buildHarness([], []);

    await expect(
      service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
        freeTextDescription: 'Panadol Extra',
        quantity: 1,
        imageUrls: ['https://example.com/not-a-hatly-upload.png'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects switching to PICKUP when the cart already has 2 vendor groups', async () => {
    const products = [makeProduct('p1', 'branch-1'), makeProduct('p2', 'branch-2')];
    const branches = [makeBranch('branch-1'), makeBranch('branch-2')];
    const { service } = buildHarness(products, branches);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    await service.addItem('customer-1', { productId: 'p2', quantity: 1 });

    await expect(service.setFulfillmentType('customer-1', FulfillmentType.PICKUP)).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects switching to PICKUP when the only group is AD_HOC_SERVICE', async () => {
    const { service } = buildHarness([], []);

    await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
      freeTextDescription: 'Panadol Extra',
      quantity: 1,
    });

    await expect(service.setFulfillmentType('customer-1', FulfillmentType.PICKUP)).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows PICKUP for a single CATALOG group whose branch has pickup enabled', async () => {
    const products = [makeProduct('p1', 'branch-1')];
    const branches = [makeBranch('branch-1')];
    const { service } = buildHarness(products, branches);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const view = await service.setFulfillmentType('customer-1', FulfillmentType.PICKUP);

    expect(view.fulfillmentType).toBe(FulfillmentType.PICKUP);
  });

  it('rejects adding an AD_HOC_SERVICE item once the cart already has a CATALOG group — no mixing', async () => {
    const products = [makeProduct('p1', 'branch-1')];
    const branches = [makeBranch('branch-1')];
    const { service } = buildHarness(products, branches);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });

    await expect(
      service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
        freeTextDescription: 'Panadol Extra',
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects adding a CATALOG item once the cart already has an AD_HOC_SERVICE group — no mixing, the other direction', async () => {
    const products = [makeProduct('p1', 'branch-1')];
    const branches = [makeBranch('branch-1')];
    const { service } = buildHarness(products, branches);

    await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
      freeTextDescription: 'Panadol Extra',
      quantity: 1,
    });

    await expect(service.addItem('customer-1', { productId: 'p1', quantity: 1 })).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects a second Hatly Service location — a Hatly Service cart is capped at one group, unlike the general 3-group cap', async () => {
    const { service } = buildHarness([], []);

    await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
      freeTextDescription: 'Panadol Extra',
      quantity: 1,
    });

    await expect(
      service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Another Pharmacy',
        adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
        freeTextDescription: 'Vitamin C',
        quantity: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('requires adHocServiceType when starting a new Hatly Service group', async () => {
    const { service } = buildHarness([], []);

    await expect(
      service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        freeTextDescription: 'Panadol Extra',
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a BUY_FROM_PLACE group with a customer-supplied pickup override', async () => {
    const { service } = buildHarness([], []);

    const view = await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
      pickupLatitude: 30.1,
      pickupLongitude: 31.2,
      freeTextDescription: 'Panadol Extra',
      quantity: 1,
    });

    expect(view.groups[0].adHocServiceType).toBe(AdHocServiceType.BUY_FROM_PLACE);
    expect(view.groups[0].adHocPickupLatitude).toBe(30.1);
    expect(view.groups[0].adHocPickupLongitude).toBe(31.2);
  });

  it('PD-012: BOTH service types accept an origin and a destination, each with its own label', async () => {
    for (const type of [AdHocServiceType.BUY_FROM_PLACE, AdHocServiceType.DELIVER_TO_PLACE]) {
      const { service } = buildHarness([], []);
      const view = await service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: type,
        pickupLatitude: 30.1,
        pickupLongitude: 31.2,
        pickupLabel: '  Current location  ',
        destinationLatitude: 30.3,
        destinationLongitude: 31.4,
        destinationLabel: 'Mama\'s house',
        freeTextDescription: 'x',
        quantity: 1,
      });
      expect(view.groups[0]).toMatchObject({
        adHocPickupLatitude: 30.1,
        adHocPickupLabel: 'Current location',
        adHocDestinationLatitude: 30.3,
        adHocDestinationLongitude: 31.4,
        adHocDestinationLabel: 'Mama\'s house',
      });
    }
  });

  it('PD-012: an end the customer did not choose stays null (the default is resolved at checkout, never stored here)', async () => {
    const { service } = buildHarness([], []);
    const view = await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
      freeTextDescription: 'x',
      quantity: 1,
    });
    expect(view.groups[0]).toMatchObject({
      adHocPickupLatitude: null,
      adHocPickupLabel: null,
      adHocDestinationLatitude: null,
      adHocDestinationLabel: null,
    });
  });

  describe('updateAdHocRoute (PD-012)', () => {
    const start = async () => {
      const h = buildHarness([], []);
      await h.service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE,
        pickupLatitude: 30.1,
        pickupLongitude: 31.2,
        pickupLabel: 'Start',
        freeTextDescription: 'x',
        quantity: 1,
      });
      return h.service;
    };

    it('changes each end independently; the other end is left untouched', async () => {
      const service = await start();
      const afterDestination = await service.updateAdHocRoute('customer-1', { destination: { latitude: 30.5, longitude: 31.6, label: 'New place' } });
      expect(afterDestination.groups[0]).toMatchObject({
        adHocPickupLatitude: 30.1,
        adHocPickupLabel: 'Start',
        adHocDestinationLatitude: 30.5,
        adHocDestinationLabel: 'New place',
      });
      const afterOrigin = await service.updateAdHocRoute('customer-1', { origin: { latitude: 30.7, longitude: 31.8 } });
      expect(afterOrigin.groups[0]).toMatchObject({ adHocPickupLatitude: 30.7, adHocPickupLabel: null, adHocDestinationLatitude: 30.5 });
    });

    it('null clears an end back to the configured default', async () => {
      const service = await start();
      const view = await service.updateAdHocRoute('customer-1', { origin: null });
      expect(view.groups[0]).toMatchObject({ adHocPickupLatitude: null, adHocPickupLongitude: null, adHocPickupLabel: null });
    });

    it('is refused when the cart has no Hatly / Wasally request', async () => {
      const { service } = buildHarness([], []);
      await expect(service.updateAdHocRoute('customer-1', { origin: null })).rejects.toThrow('There is no Hatly Service request in the cart.');
    });
  });

  it('rejects an incomplete coordinate pair (latitude without longitude)', async () => {
    const { service } = buildHarness([], []);

    await expect(
      service.addAdHocItem('customer-1', {
        adHocPlaceName: 'Corner Pharmacy',
        adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
        pickupLatitude: 30.1,
        freeTextDescription: 'Panadol Extra',
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CartService — Weighted Products (Phase G)', () => {
  function makeWeightProduct(id: string, vendorBranchId: string, priceMinorPerKg = 20000) {
    return {
      id,
      name: `Product ${id}`,
      priceMinor: priceMinorPerKg,
      pricingUnit: PricingUnit.WEIGHT,
      isAvailable: true,
      deletedAt: null,
      options: [],
      vendorBranch: { id: vendorBranchId, isActive: true, vendor: { isActive: true } },
      vendorBranchId,
    };
  }

  it('adding a WEIGHT product requires requestedWeightGrams and stores quantity as 1', async () => {
    const product = makeWeightProduct('p1', 'branch-1');
    const { service, items } = buildHarness([product], [makeBranch('branch-1')]);

    const view = await service.addItem('customer-1', { productId: 'p1', quantity: 5, requestedWeightGrams: 1150 });

    const [item]: any = [...items.values()];
    expect(item.quantity).toBe(1); // never overloaded with the customer-submitted quantity
    expect(item.requestedWeightGrams).toBe(1150);

    const viewItem = view.groups[0].items[0];
    expect(viewItem.pricingUnit).toBe(PricingUnit.WEIGHT);
    expect(viewItem.requestedWeightGrams).toBe(1150);
    // 200 EGP/kg (20000 minor) * 1.15kg = 23000
    expect(viewItem.lineTotalMinor).toBe(23000);
  });

  it('rejects adding a WEIGHT product without requestedWeightGrams', async () => {
    const product = makeWeightProduct('p1', 'branch-1');
    const { service } = buildHarness([product], [makeBranch('branch-1')]);

    await expect(service.addItem('customer-1', { productId: 'p1', quantity: 1 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects adding a PIECE product with requestedWeightGrams supplied', async () => {
    const product = makeProduct('p1', 'branch-1'); // default PIECE fixture
    const { service } = buildHarness([product], [makeBranch('branch-1')]);

    await expect(
      service.addItem('customer-1', { productId: 'p1', quantity: 1, requestedWeightGrams: 500 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateItemWeight updates requestedWeightGrams for a WEIGHT item', async () => {
    const product = makeWeightProduct('p1', 'branch-1');
    const { service, items } = buildHarness([product], [makeBranch('branch-1')]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1, requestedWeightGrams: 1000 });
    const [item]: any = [...items.values()];

    await service.updateItemWeight('customer-1', item.id, 1300);
    expect(items.get(item.id).requestedWeightGrams).toBe(1300);
  });

  it('rejects updateItemWeight on a PIECE item', async () => {
    const product = makeProduct('p1', 'branch-1');
    const { service, items } = buildHarness([product], [makeBranch('branch-1')]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 2 });
    const [item]: any = [...items.values()];

    await expect(service.updateItemWeight('customer-1', item.id, 1000)).rejects.toThrow(BadRequestException);
  });

  it('rejects updateItemQuantity on a WEIGHT item — must use updateItemWeight instead', async () => {
    const product = makeWeightProduct('p1', 'branch-1');
    const { service, items } = buildHarness([product], [makeBranch('branch-1')]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1, requestedWeightGrams: 1000 });
    const [item]: any = [...items.values()];

    await expect(service.updateItemQuantity('customer-1', item.id, 3)).rejects.toThrow(BadRequestException);
  });

  it('existing PIECE-item quantity update flow remains completely unaffected', async () => {
    const product = makeProduct('p1', 'branch-1');
    const { service, items } = buildHarness([product], [makeBranch('branch-1')]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const [item]: any = [...items.values()];

    await service.updateItemQuantity('customer-1', item.id, 4);
    expect(items.get(item.id).quantity).toBe(4);
  });
});

describe('CartService — Offer preview (Phase G, best-effort, non-authoritative)', () => {
  it('decorates a CATALOG item\'s view with the offer preview when one matches', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service, offerConsumptionService } = buildHarness([product], [branch]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 2 });

    offerConsumptionService.previewOffersForItems = jest.fn(async (candidates: any[]) => {
      const flashSalePreviews = new Map();
      for (const c of candidates) {
        flashSalePreviews.set(c.cartItemId, {
          offerId: 'offer-1',
          mechanism: 'FLASH_SALE',
          specialPriceMinor: 600,
          discountType: 'PERCENTAGE',
          discountValue: 2000,
          discountedQuantity: c.quantity,
          discountAmountMinor: 400, // 20% of 1000 * 2
        });
      }
      return { flashSalePreviews, subtotalDiscountPreviews: new Map() };
    });

    const view = await service.getCartView('customer-1');
    const itemView = view.groups[0].items[0];

    expect(itemView.offerId).toBe('offer-1');
    expect(itemView.offerDiscountType).toBe('PERCENTAGE');
    expect(itemView.offerDiscountAmountMinor).toBe(400);
    expect(itemView.payableLineTotalMinor).toBe(itemView.lineTotalMinor! - 400);
    // Customer Offers Integration — unambiguous fields.
    expect(itemView.offerMechanism).toBe('FLASH_SALE');
    expect(itemView.specialPriceMinor).toBe(600);
  });

  it('leaves the offer-specific fields null when no offer matches, while payableLineTotalMinor still reflects the full (undiscounted) line total — the documented "lineTotalMinor - offerDiscountAmountMinor" contract with no discount applied', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const view = await service.getCartView('customer-1');
    const itemView = view.groups[0].items[0];

    expect(itemView.offerId).toBeNull();
    expect(itemView.offerDiscountAmountMinor).toBeNull();
    // CartItemView.payableLineTotalMinor's own contract (see
    // cart-view.interface.ts): "lineTotalMinor - offerDiscountAmountMinor"
    // — with no offer/discount, that's just the full line total, never
    // null (null is reserved for a WEIGHT item, where no line total is
    // known before weighing at all — see CartPricingService.buildItemView).
    expect(itemView.payableLineTotalMinor).toBe(itemView.lineTotalMinor);
    expect(itemView.offerMechanism).toBeNull();
    expect(itemView.specialPriceMinor).toBeNull();
    expect(view.groups[0].hasSubtotalDiscountOffer).toBe(false);
  });

  it('Customer Offers Integration: hasSubtotalDiscountOffer is set on the GROUP when a SUBTOTAL_DISCOUNT offer matches an item, never on the item itself', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service, offerConsumptionService } = buildHarness([product], [branch]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });

    offerConsumptionService.previewOffersForItems = jest.fn(async (candidates: any[]) => {
      const subtotalDiscountPreviews = new Map();
      for (const c of candidates) {
        subtotalDiscountPreviews.set(c.cartItemId, { offerId: 'offer-2', discountType: 'PERCENTAGE', discountValue: 1000 });
      }
      return { flashSalePreviews: new Map(), subtotalDiscountPreviews };
    });

    const view = await service.getCartView('customer-1');
    expect(view.groups[0].hasSubtotalDiscountOffer).toBe(true);
    expect(view.groups[0].items[0].offerMechanism).toBeNull(); // never set on the item — segment-level only
  });

  it('the client never calculates the discount itself — the preview always comes from the server-side service, never a client-supplied value', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service, offerConsumptionService } = buildHarness([product], [branch]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    await service.getCartView('customer-1');

    // The preview call receives only server-known fields (productId,
    // vendorBranchId, quantity, unitPriceMinor derived server-side) —
    // never anything the request body could have supplied for pricing.
    expect(offerConsumptionService.previewOffersForItems).toHaveBeenCalledWith([
      expect.objectContaining({ productId: 'p1', vendorBranchId: 'branch-1', unitPriceMinor: 1000, quantity: 1 }),
    ]);
  });
});

describe('CartService.addVendorCustomItem — Vendor/Pharmacy Custom Item', () => {
  it('a Custom Item can be added to an existing CATALOG group', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);

    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cartAfterProduct = await service.getCartView('customer-1');
    const groupId = cartAfterProduct.groups[0].id;

    const view = await service.addVendorCustomItem('customer-1', {
      cartVendorGroupId: groupId,
      freeTextDescription: 'Panadol Extra 500mg, any brand available',
    });

    expect(view.groups).toHaveLength(1); // still ONE group, never a second/AD_HOC_SERVICE group
    expect(view.groups[0].items).toHaveLength(2); // the product + the custom item, same group
  });

  describe('per-sector setting (server-enforced)', () => {
    const request = (service: any, groupId?: string) =>
      service.addVendorCustomItem('customer-1', groupId ? { cartVendorGroupId: groupId, freeTextDescription: 'x' } : { vendorBranchId: 'branch-1', freeTextDescription: 'x' });

    it.each([
      ['the sector switch is OFF (the default, e.g. restaurants)', { isActive: true, customRequestsEnabled: false }],
      ['the sector is inactive', { isActive: false, customRequestsEnabled: true }],
      ['the branch has no sector', null],
    ])('refuses (CUSTOM_REQUESTS_NOT_AVAILABLE) when %s — for a new group', async (_name, sector) => {
      const { service } = buildHarness([makeProduct('p1', 'branch-1')], [makeBranch('branch-1', sector)]);
      await expect(request(service)).rejects.toMatchObject({ response: { details: { code: 'CUSTOM_REQUESTS_NOT_AVAILABLE' } } });
      await expect(request(service)).rejects.toThrow(ForbiddenException);
    });

    it('refuses through an EXISTING group too, and adds nothing to the cart', async () => {
      const { service } = buildHarness([makeProduct('p1', 'branch-1')], [makeBranch('branch-1', { isActive: true, customRequestsEnabled: false })]);
      await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
      const groupId = (await service.getCartView('customer-1')).groups[0].id;
      await expect(request(service, groupId)).rejects.toThrow(ForbiddenException);
      expect((await service.getCartView('customer-1')).groups[0].items).toHaveLength(1);
    });

    it('accepts when the sector switch is ON', async () => {
      const { service } = buildHarness([], [makeBranch('branch-1')]);
      const view = await request(service);
      expect(view.groups[0].items).toHaveLength(1);
    });
  });

  it('CRITICAL: cannot target/create an AD_HOC_SERVICE group — only an existing CATALOG group is accepted', async () => {
    const { service } = buildHarness([], []);
    await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: 'BUY_FROM_PLACE' as any,
      freeTextDescription: 'Vitamin C',
      quantity: 1,
    } as any);
    const cart = await service.getCartView('customer-1');
    const adHocGroupId = cart.groups[0].id;

    await expect(
      service.addVendorCustomItem('customer-1', {
        cartVendorGroupId: adHocGroupId,
        freeTextDescription: 'Should not be allowed here',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a non-existent cart group', async () => {
    const { service } = buildHarness([], []);
    await expect(
      service.addVendorCustomItem('customer-1', {
        cartVendorGroupId: 'no-such-group',
        freeTextDescription: 'Anything',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('CRITICAL: preserves the group\u2019s existing vendorBranchId — the custom item joins the SAME vendor segment', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service, groups } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cart = await service.getCartView('customer-1');
    const groupId = cart.groups[0].id;

    await service.addVendorCustomItem('customer-1', { cartVendorGroupId: groupId, freeTextDescription: 'x' });

    expect(groups.get(groupId).vendorBranchId).toBe('branch-1'); // untouched
  });

  it('the custom item has productId=null and unitPriceMinor=null, contributing 0 to the group subtotal', async () => {
    const product = makeProduct('p1', 'branch-1'); // priceMinor: 1000 per makeProduct's convention
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cart = await service.getCartView('customer-1');
    const groupId = cart.groups[0].id;

    const view = await service.addVendorCustomItem('customer-1', { cartVendorGroupId: groupId, freeTextDescription: 'x' });
    const customItem = view.groups[0].items.find((i: any) => i.productId === null)!;

    expect(customItem.unitPriceMinor).toBeNull();
    expect(customItem.lineTotalMinor).toBeNull();
    expect(view.groups[0].subtotalMinor).toBe(1000); // only the real product's price — custom item contributes 0
  });

  it('rejects more than 2 images', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cart = await service.getCartView('customer-1');
    await expect(
      service.addVendorCustomItem('customer-1', {
        cartVendorGroupId: cart.groups[0].id,
        freeTextDescription: 'x',
        imageUrls: ['stub-upload://owned/1', 'stub-upload://owned/2', 'stub-upload://owned/3'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('reuses the existing Upload ownership validation — rejects an image the customer does not own', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cart = await service.getCartView('customer-1');
    await expect(
      service.addVendorCustomItem('customer-1', {
        cartVendorGroupId: cart.groups[0].id,
        freeTextDescription: 'x',
        imageUrls: ['stub-upload://not-owned'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('normal catalog items remain unchanged — adding a custom item does not alter the existing product item', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 2 });
    const before = await service.getCartView('customer-1');

    const after = await service.addVendorCustomItem('customer-1', {
      cartVendorGroupId: before.groups[0].id,
      freeTextDescription: 'x',
    });
    const productItem = after.groups[0].items.find((i: any) => i.productId === 'p1')!;
    expect(productItem.quantity).toBe(2);
    expect(productItem.unitPriceMinor).toBe(1000);
  });

  it('existing External Hatly Service (AD_HOC_SERVICE) behavior is unchanged: addAdHocItem still works exactly as before', async () => {
    const { service } = buildHarness([], []);
    const view = await service.addAdHocItem('customer-1', {
      adHocPlaceName: 'Corner Pharmacy',
      adHocServiceType: 'BUY_FROM_PLACE' as any,
      freeTextDescription: 'Vitamin C',
      quantity: 1,
    } as any);
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].items[0].freeTextDescription).toBe('Vitamin C');
  });

  it('CRITICAL: an image-only custom item (no free text) is accepted', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cart = await service.getCartView('customer-1');

    const view = await service.addVendorCustomItem('customer-1', {
      cartVendorGroupId: cart.groups[0].id,
      imageUrls: ['stub-upload://owned/rx.jpg'],
    } as any);
    const customItem = view.groups[0].items.find((i: any) => i.productId === null)!;
    expect(customItem.freeTextDescription).toBeNull();
    expect(customItem.imageUrls).toEqual(['stub-upload://owned/rx.jpg']);
  });

  it('CRITICAL: neither free text nor an image is rejected', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = makeBranch('branch-1');
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });
    const cart = await service.getCartView('customer-1');

    await expect(
      service.addVendorCustomItem('customer-1', { cartVendorGroupId: cart.groups[0].id } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('CRITICAL: a Custom Item can create a brand-new CATALOG group via vendorBranchId, even with no prior catalog product from that vendor', async () => {
    const branch = { ...makeBranch('branch-1'), isActive: true };
    const { service } = buildHarness([], [branch]);

    const view = await service.addVendorCustomItem('customer-1', {
      vendorBranchId: 'branch-1',
      freeTextDescription: 'Paracetamol 500mg, any brand',
    } as any);

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].items).toHaveLength(1);
  });

  it('a Custom Item via vendorBranchId reuses an existing CATALOG group for that same branch rather than creating a second one', async () => {
    const product = makeProduct('p1', 'branch-1');
    const branch = { ...makeBranch('branch-1'), isActive: true };
    const { service } = buildHarness([product], [branch]);
    await service.addItem('customer-1', { productId: 'p1', quantity: 1 });

    const view = await service.addVendorCustomItem('customer-1', {
      vendorBranchId: 'branch-1',
      freeTextDescription: 'x',
    } as any);

    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].items).toHaveLength(2);
  });

  it('rejects a branch whose VENDOR is deactivated when starting a new group via vendorBranchId (Group 8 regression)', async () => {
    const branch = { ...makeBranch('branch-1'), isActive: true, vendor: { name: 'V', isActive: false } };
    const { service } = buildHarness([], [branch]);
    await expect(
      service.addVendorCustomItem('customer-1', { vendorBranchId: 'branch-1', freeTextDescription: 'x' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects adding a product whose branch is active but whose VENDOR is deactivated (Group 8 regression)', async () => {
    const product = { ...makeProduct('p1', 'branch-1') };
    (product as any).vendorBranch = { id: 'branch-1', isActive: true, vendor: { isActive: false } };
    const { service } = buildHarness([product], [makeBranch('branch-1')]);
    await expect(service.addItem('customer-1', { productId: 'p1', quantity: 1 })).rejects.toMatchObject({
      response: { details: { code: 'BRANCH_UNAVAILABLE' } },
    });
  });

  it('rejects an unavailable vendor branch when starting a new group via vendorBranchId', async () => {
    const branch = { ...makeBranch('branch-1'), isActive: false };
    const { service } = buildHarness([], [branch]);
    await expect(
      service.addVendorCustomItem('customer-1', { vendorBranchId: 'branch-1', freeTextDescription: 'x' } as any),
    ).rejects.toThrow(BadRequestException);
  });
});
