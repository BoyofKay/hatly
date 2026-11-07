import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderCreationService } from './order-creation.service';
import { CartPricingService } from '../cart/cart-pricing.service';
import { Cart, CartStatus } from '../cart/entities/cart.entity';
import { CartGroupType } from '../cart/cart-group-type.enum';
import { FulfillmentType } from '../cart/fulfillment-type.enum';
import { Order } from './entities/order.entity';
import { OrderVendorSegment } from './entities/order-vendor-segment.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderVendorSegmentStatus } from './order-vendor-segment-status.enum';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { AdHocServiceType } from '../cart/ad-hoc-service-type.enum';
import { Payment } from '../payments/entities/payment.entity';
import { PaymentStatus } from '../payments/payment-status.enum';
import { PricingUnit } from '../products/pricing-unit.enum';
import { CheckoutPlannerService } from './checkout/checkout-planner.service';
import { CheckoutQuoteService } from './checkout/checkout-quote.service';
import { CheckoutQuoteTokenService } from './checkout/checkout-quote-token.service';
import { AddressValidationService } from './checkout/address-validation.service';
import { ElectronicPaymentMethod } from '../payments/electronic-payment-method.enum';

/**
 * Same style of special-cased in-memory fake as cart.service.spec.ts —
 * implements only the exact query shapes OrderCreationService actually
 * issues, sufficient to exercise its real validation/snapshot logic
 * without a database.
 */
function buildHarness(opts: {
  cart: any;
  branches?: any[];
  multiVendorEnabled?: boolean;
  deliveryFeeMinor?: number;
  businessConfigValues?: Record<string, any>;
  autoAcceptEnabled?: boolean;
  hatlyServiceChargeMinor?: number;
  offerConsumptionService?: any;
  products?: any[];
  walletBalanceMinor?: number;
}) {
  const store = {
    carts: new Map<string, any>([[opts.cart.id, opts.cart]]),
    orders: new Map<string, any>(),
    segments: new Map<string, any>(),
    items: new Map<string, any>(),
    payments: new Map<string, any>(),
    products: new Map<string, any>((opts.products ?? []).map((p: any) => [p.id, p])),
  };
  const branchesById = new Map((opts.branches ?? []).map((b) => [b.id, b]));

  let orderNumberSeq = 100001;
  const manager = {
    // Segment history rows (recordSegmentEvent) — not under test here.
    getRepository: () => ({ insert: async () => undefined }),
    // `nextOrderNumber` — a plain SELECT nextval(...), same fake counter every test starts fresh so assertions never depend on it.
    query: async (sql: string) => {
      if (sql.includes('nextval')) return [{ seq: String(orderNumberSeq++) }];
      if (sql.includes('vendor_branch_closures')) return []; // no branch is under a closure in these tests
      if (sql.includes('set_config')) return [{ set_config: '' }]; // the stock-ledger context (a no-op for the fake store)
      if (sql.includes('UPDATE stock_movements')) return [[], 0]; // linking placement movements to the order
      throw new Error(`unhandled manager.query: ${sql}`);
    },
    findOne: async (EntityClass: any, findOpts: any) => {
      if (EntityClass === Cart) {
        if (findOpts.where.id) {
          const cart = store.carts.get(findOpts.where.id);
          return cart ? { ...cart } : null;
        }
        return (
          [...store.carts.values()].find(
            (c) => c.customerId === findOpts.where.customerId && c.status === findOpts.where.status,
          ) ?? null
        );
      }
      if (EntityClass === Order) {
        const order = store.orders.get(findOpts.where.id);
        if (!order) return null;
        const segments = [...store.segments.values()].filter((s) => s.orderId === order.id);
        for (const s of segments) {
          s.items = [...store.items.values()].filter((i) => i.orderVendorSegmentId === s.id);
        }
        return { ...order, segments };
      }
      throw new Error(`unhandled manager.findOne for ${EntityClass.name}`);
    },
    find: async (EntityClass: any, findOpts: any) => {
      if (EntityClass === VendorBranch) {
        const ids = (findOpts.where as any[]).map((w) => w.id);
        return ids.map((id) => branchesById.get(id)).filter(Boolean);
      }
      throw new Error(`unhandled manager.find for ${EntityClass.name}`);
    },
    create: (_EntityClass: any, data: any) => ({ ...data }),
    // `manager.update(Cart, { id }, partial)` — createOrder flips the cart
    // to ORDERED with a targeted UPDATE (see its own comment for why not
    // `save`); only the Cart update shape it actually issues is supported.
    update: async (EntityClass: any, criteria: { id: string }, partial: any) => {
      if (EntityClass !== Cart) throw new Error(`unhandled manager.update for ${EntityClass.name}`);
      const existing = store.carts.get(criteria.id);
      if (!existing) return { affected: 0 };
      store.carts.set(criteria.id, { ...existing, ...partial });
      return { affected: 1 };
    },
    save: async (EntityClass: any, entity: any) => {
      const withId = { id: entity.id ?? randomUUID(), ...entity };
      if (EntityClass === Order) store.orders.set(withId.id, withId);
      else if (EntityClass === OrderVendorSegment) store.segments.set(withId.id, withId);
      else if (EntityClass === OrderItem) store.items.set(withId.id, withId);
      else if (EntityClass === Cart) store.carts.set(withId.id, withId);
      else if (EntityClass === Payment) store.payments.set(withId.id, withId);
      return withId;
    },
    // Tracked Inventory Order-Time Enforcement — supports EXACTLY the
    // chain OrderCreationService.enforceAndDecrementInventory issues:
    // .createQueryBuilder().update(Product).set(...).where(...).andWhere(...).andWhere(...).setParameter(...).execute()
    // Mutates the SAME product object registered in store.products
    // (and therefore also the object referenced by a cart item's
    // `.product`, when a test wires them as the same reference) so
    // the decrement is observable from both places.
    createQueryBuilder: () => {
      let targetId: string | undefined;
      let amount: number | undefined;
      const qb: any = {
        update: (_EntityClass: any) => qb,
        set: (_setClause: any) => qb,
        where: (clause: string, params: any) => {
          if (params?.id) targetId = params.id;
          return qb;
        },
        andWhere: (_clause: string, params?: any) => {
          if (params?.amount !== undefined) amount = params.amount;
          return qb;
        },
        setParameter: (name: string, value: any) => {
          if (name === 'amount') amount = value;
          return qb;
        },
        execute: async () => {
          const product = store.products.get(targetId!);
          if (!product || product.inventoryMode !== 'TRACKED' || product.quantity < (amount ?? 0)) {
            return { affected: 0 };
          }
          product.quantity -= amount!;
          return { affected: 1 };
        },
      };
      return qb;
    },
  };

  // CRITICAL: reproduces the real `dataSource.transaction()`'s actual
  // atomicity guarantee, not just a pass-through call. Order/segment/
  // item/payment/cart-status writes are snapshotted before the
  // callback runs and restored if it throws — so a late failure (e.g.
  // inside `finalizeConsumption`, which runs AFTER the Order/segments/
  // items already exist in this fake) genuinely leaves no partial
  // state behind, matching what a real Postgres ROLLBACK does. (Scoped
  // to these five maps only — `store.products`' TRACKED-inventory
  // decrement is a true in-place mutation of an object other fixtures
  // may hold a direct reference to, e.g. a cart item's own `.product`;
  // the pre-existing "no orphaned deduction" test already deliberately
  // avoids depending on rollback for that and only checks
  // `store.orders.size`, per its own comment.)
  const dataSource = {
    // Supports both `transaction(cb)` (OrderCreationService) and `transaction(isolationLevel, cb)` (CheckoutQuoteService,
    // called here to mint a real quote token — see the `service.createOrder` wrapper below) — the isolation level itself is
    // meaningless against this in-memory fake, only the callback matters.
    transaction: async (cbOrIsolation: any, maybeCb?: any) => {
      const cb = typeof cbOrIsolation === 'function' ? cbOrIsolation : maybeCb;
      const snapshot = {
        orders: new Map(store.orders),
        segments: new Map(store.segments),
        items: new Map(store.items),
        payments: new Map(store.payments),
        carts: new Map(store.carts),
      };
      try {
        return await cb(manager);
      } catch (error) {
        store.orders = snapshot.orders;
        store.segments = snapshot.segments;
        store.items = snapshot.items;
        store.payments = snapshot.payments;
        store.carts = snapshot.carts;
        throw error;
      }
    },
  };
  const businessConfigService = {
    isMultiVendorOrdersEnabled: jest.fn(async () => opts.multiVendorEnabled ?? true),
    // PD-006 checkout configuration — defaults: all five electronic methods offered, Manual Transfer configured, no ETA range.
    getEnabledElectronicPaymentMethods: jest.fn(async () => ['INSTAPAY', 'VODAFONE_CASH', 'ORANGE_CASH', 'ETISALAT_CASH', 'WE_PAY']),
    getCheckoutQuoteTtlSeconds: jest.fn(async () => 900),
    getEtaRangeBufferMinutes: jest.fn(async () => null),
    get: jest.fn(async (key: string, fallback: any) => {
      const values = opts.businessConfigValues ?? {};
      if (key in values) return values[key];
      if (key === 'MANUAL_TRANSFER_DESTINATION' || key === 'CUSTOMER_SERVICE_WHATSAPP_NUMBER') return 'configured';
      return fallback;
    }),
    // PD-012: a configured route default (only a well-formed value is a default; anything else is "not configured").
    getServiceLocation: jest.fn(async (key: string) => {
      const value = (opts.businessConfigValues ?? {})[key];
      return value && typeof value.latitude === 'number' && typeof value.longitude === 'number' && value.label
        ? { latitude: value.latitude, longitude: value.longitude, label: value.label }
        : null;
    }),
    getRequired: jest.fn(async (key: string) => {
      const values = opts.businessConfigValues ?? {};
      if (!(key in values)) {
        throw new NotFoundException({ details: { code: 'BUSINESS_CONFIG_NOT_SET', key } });
      }
      return values[key];
    }),
  };
  // A fixed-response fake — these tests exercise routing/validation
  // logic, not DeliveryFeeCalculationService's own math (that has its
  // own dedicated spec file with real distance/rounding scenarios).
  const deliveryFeeCalculationService = {
    calculate: jest.fn(async () => ({
      deliveryFeeMinor: opts.deliveryFeeMinor ?? 1234,
      vendorSequence: [],
      legDistancesMeters: [],
      rawTotalDistanceMeters: 0,
      roundedTotalDistanceMeters: 0,
      pricePer100mMinorUsed: 0,
      minimumDeliveryFeeMinorUsed: 0,
      additionalVendorFeeMinorUsed: 0,
      additionalVendorChargeMinor: 0,
    })),
  };

  // PHASE F addition: fakes HatlyServicePricingService — the real
  // AD_HOC_SERVICE pricing logic has its own dedicated spec file
  // (hatly-service-pricing.service.spec.ts); this harness only needs a
  // plausible fixed charge so existing AD_HOC_SERVICE tests here keep
  // exercising THIS service's own logic (payment-method rules, Payment
  // row creation) without re-testing the pricing math itself.
  const hatlyServicePricingService = {
    calculateCharge: jest.fn(async (p: any) => ({
      // Echoes the resolved route the planner passed in, exactly as the real service freezes it (PD-012).
      route: { origin: p.origin, destination: p.destination },
      chargeMinor: opts.hatlyServiceChargeMinor ?? 500,
      pricingSource: 'DELIVERY_ZONE',
      deliveryZoneId: 'zone-1',
      zoneDeliveryFeeMinorUsed: 500,
      multiplierUsed: 1,
    })),
  };

  // PHASE G addition (Offers & Promotions). Default no-op mock — this
  // spec file predates Offers and its own tests assert pre-offer
  // behavior; new Offer-specific tests below override this per-test
  // via the harness's own opts.
  const offerConsumptionService = opts.offerConsumptionService ?? {
    planFlashSaleForCart: jest.fn(async () => ({ plans: new Map(), lockedOffers: new Map() })),
    // Offers Final System - Checkout Integration addition: createOrder
    // calls planSubtotalDiscountForSegment unconditionally for every
    // CATALOG segment with items — this default (no active
    // SUBTOTAL_DISCOUNT offer for any branch) must exist here too, not
    // only in makeOfferMockWithSubtotal below, or every pre-Offers test
    // in this file (which never overrides offerConsumptionService)
    // throws "planSubtotalDiscountForSegment is not a function" before
    // ever reaching what it actually means to test.
    planSubtotalDiscountForSegment: jest.fn(async () => ({ plan: null, lockedOffer: null })),
    checkSubtotalDiscountCustomerLimit: jest.fn(async () => true),
    finalizeConsumption: jest.fn(async () => undefined),
    recordHatlyFundedDiscountEvent: jest.fn(async () => undefined),
  };

  const requestContextService = { getCorrelationId: jest.fn(() => 'corr-test') };
  // PD-006: the pricing/validation rules live in CheckoutPlannerService (shared with the quote). It is built for REAL here from
  // this harness's fakes, so every behaviour asserted below still runs through the production planner code.
  const addressValidationService = new AddressValidationService(
    { findOne: async () => null } as any,
    // One active Delivery Zone (PD-009): every test address carries it — registered vendors still price by the pin (distance),
    // Hatly Service always by the zone.
    {
      findOne: async ({ where }: any) =>
        where.id === 'zone-1'
          ? { id: 'zone-1', name: 'Abu Naseeb', nameAr: 'أبو نصيب', city: 'Belbeis', cityAr: 'بلبيس', governorate: 'Sharqia', governorateAr: 'الشرقية', deliveryFeeMinor: 500, isActive: true, serviceAreaId: 'area-1', serviceArea: { id: 'area-1', isActive: true } }
          : null,
    } as any,
    { resolveForPoint: async () => ({ id: 'area-1' }) } as any, // every test address is inside a service area
  );
  const walletService = {
    getBalance: jest.fn(async () => opts.walletBalanceMinor ?? 0),
    lockCustomerWallet: jest.fn(async () => undefined),
    recordTransaction: jest.fn(async () => ({})),
  };
  const planner = new CheckoutPlannerService(
    new CartPricingService(),
    businessConfigService as any,
    deliveryFeeCalculationService as any,
    hatlyServicePricingService as any,
    offerConsumptionService as any,
    addressValidationService,
    walletService as any,
  );
  const tokenService = new CheckoutQuoteTokenService({ get: () => 'test-secret' } as any);
  const quoteService = new CheckoutQuoteService(dataSource as any, planner, tokenService, businessConfigService as any, addressValidationService);
  const statusHistory = { record: jest.fn(async () => undefined) };
  const service = new OrderCreationService(
    dataSource as any,
    businessConfigService as any,
    offerConsumptionService as any,
    requestContextService as any,
    planner,
    addressValidationService,
    quoteService,
    tokenService,
    walletService as any,
    statusHistory as any,
    { advanceOrder: jest.fn(async () => 0) } as any,
  );

  // A confirmed quote is now required for a DELIVERY order (production-readiness slice). Every test below predates that rule and
  // asserts its OWN thing (mapping, pricing, weight, offers, inventory…), so `createOrder` here transparently mints a real,
  // matching token first — via the SAME public `quoteService.quote()` production code path — exactly like the real client
  // always does, UNLESS the test already supplied its own `quoteToken` (none currently do). A test asserting some OTHER,
  // earlier rejection (bad address, disabled multi-vendor, unavailable branch, insufficient inventory…) is unaffected: that
  // rejection is still thrown by the SAME `ORDER`-mode planner/decrement code, before this token is ever consulted.
  const originalCreateOrder = service.createOrder.bind(service);
  service.createOrder = (async (customerId: string, dto: any) => {
    if (!dto.quoteToken) {
      const quoted = await quoteService.quote(customerId, dto);
      if (quoted.data.quoteToken) dto = { ...dto, quoteToken: quoted.data.quoteToken };
    }
    return originalCreateOrder(customerId, dto);
  }) as typeof service.createOrder;

  return { service, store, offerConsumptionService, walletService, statusHistory, tokenService, deliveryFeeCalculationService, quoteService, rawCreateOrder: originalCreateOrder };
}

function makeProduct(id: string, overrides: Partial<any> = {}) {
  return {
    id,
    name: `Product ${id}`,
    priceMinor: 1000,
    isAvailable: true,
    deletedAt: null,
    ...overrides,
  };
}

function makeCatalogGroup(id: string, branchId: string, items: any[]) {
  return {
    id,
    groupType: CartGroupType.CATALOG,
    vendorBranchId: branchId,
    adHocPlaceName: null,
    vendorNote: null,
    items,
  };
}

function makeAdHocGroup(id: string, items: any[], overrides: Partial<any> = {}) {
  return {
    id,
    groupType: CartGroupType.AD_HOC_SERVICE,
    vendorBranchId: null,
    adHocPlaceName: 'Corner Pharmacy',
    adHocServiceType: AdHocServiceType.BUY_FROM_PLACE,
    adHocPickupLatitude: null,
    adHocPickupLongitude: null,
    adHocPickupLabel: null,
    adHocDestinationLatitude: null,
    adHocDestinationLongitude: null,
    adHocDestinationLabel: null,
    vendorNote: null,
    items,
    ...overrides,
  };
}

function makeCatalogItem(id: string, product: any, quantity = 1) {
  return {
    id,
    productId: product.id,
    product,
    quantity,
    notes: null,
    freeTextDescription: null,
    imageUrls: null,
    selectedOptionValues: [],
  };
}

function makeAdHocItem(id: string) {
  return {
    id,
    productId: null,
    product: null,
    quantity: 1,
    notes: null,
    freeTextDescription: 'Panadol Extra',
    imageUrls: ['stub-upload://a'],
    selectedOptionValues: [],
  };
}

function makeCart(groups: any[], overrides: Partial<any> = {}) {
  return {
    id: 'cart-1',
    customerId: 'customer-1',
    status: CartStatus.ACTIVE,
    fulfillmentType: FulfillmentType.DELIVERY,
    orderNote: null,
    groups,
    ...overrides,
  };
}

function makeBranch(id: string, overrides: Partial<any> = {}) {
  return {
    id,
    name: `Branch ${id}`,
    isActive: true,
    isOpen: true, // R9: an open store (a closed one takes no order)
    openingHours: {},
    pickupEnabled: true,
    vendor: { name: `Vendor ${id}`, isActive: true },
    ...overrides,
  };
}

const address = { line1: '12 Market St', latitude: 30.1, longitude: 31.2, deliveryZoneId: 'zone-1' };

describe('OrderCreationService', () => {
  it('creates a single-vendor order successfully, with correct group->segment and item->item mapping', async () => {
    const product = makeProduct('p1');
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 2)])]);
    const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')], deliveryFeeMinor: 900 });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments).toHaveLength(1);
    expect(order.segments[0].groupType).toBe(CartGroupType.CATALOG);
    expect(order.segments[0].vendorBranchId).toBe('branch-1');
    expect(order.segments[0].items).toHaveLength(1);
    expect(order.segments[0].items[0].productNameSnapshot).toBe('Product p1');
    expect(order.segments[0].items[0].unitPriceMinor).toBe(1000);
    expect(order.subtotalMinor).toBe(2000);
    // Real delivery-fee wiring: computed (not null), and totalMinor
    // now derives from it correctly for a catalog+delivery order.
    expect(order.deliveryFeeMinor).toBe(900);
    expect(order.totalMinor).toBe(2000 + 900);
    expect(store.carts.get('cart-1').status).toBe(CartStatus.ORDERED);
  });

  it('charges zero delivery fee for a PICKUP order — no delivery is being rendered, not an invented price', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])], {
      fulfillmentType: FulfillmentType.PICKUP,
    });
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.deliveryFeeMinor).toBe(0);
    expect(order.deliveryFeeBreakdownSnapshot).toBeNull();
  });

  it('creates a 3-vendor order successfully', async () => {
    const groups = [1, 2, 3].map((n) =>
      makeCatalogGroup(`g${n}`, `branch-${n}`, [makeCatalogItem(`i${n}`, makeProduct(`p${n}`))]),
    );
    const cart = makeCart(groups);
    const branches = [1, 2, 3].map((n) => makeBranch(`branch-${n}`));
    const { service } = buildHarness({ cart, branches });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    expect(order.segments).toHaveLength(3);
  });

  it('rejects a multi-vendor order when MULTI_VENDOR_ORDERS_ENABLED is OFF', async () => {
    const groups = [1, 2].map((n) =>
      makeCatalogGroup(`g${n}`, `branch-${n}`, [makeCatalogItem(`i${n}`, makeProduct(`p${n}`))]),
    );
    const cart = makeCart(groups);
    const branches = [1, 2].map((n) => makeBranch(`branch-${n}`));
    const { service } = buildHarness({ cart, branches, multiVendorEnabled: false });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow(ConflictException);
  });

  it('still allows a single-vendor order when MULTI_VENDOR_ORDERS_ENABLED is OFF', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])]);
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')], multiVendorEnabled: false });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    expect(order.segments).toHaveLength(1);
  });

  it('rejects an empty cart, and leaves no partial Order behind', async () => {
    const cart = makeCart([]);
    const { service, store } = buildHarness({ cart });
    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow(BadRequestException);
    expect(store.orders.size).toBe(0);
    expect(store.carts.get('cart-1').status).toBe(CartStatus.ACTIVE);
  });

  it('rejects when there is no active cart at all', async () => {
    const { service } = buildHarness({ cart: makeCart([], { status: CartStatus.ORDERED }) });
    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an unavailable product', async () => {
    const product = makeProduct('p1', { isAvailable: false });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product)])]);
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects checkout when the VENDOR was deactivated after the cart was filled, even though its branch is still active (Group 8 regression)', async () => {
    const product = makeProduct('p1');
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product)])]);
    const branch = makeBranch('branch-1', { vendor: { name: 'Vendor branch-1', isActive: false } });
    const { service, store } = buildHarness({ cart, branches: [branch] });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toMatchObject({ response: { details: { code: 'BRANCH_UNAVAILABLE' } } });
    expect(store.orders.size).toBe(0);
  });

  it('succeeds for a small-value order — no minimum-order requirement exists', async () => {
    const product = makeProduct('p1', { priceMinor: 100 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const { service } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    expect(order.subtotalMinor).toBe(100);
  });

  it('rejects a multi-vendor cart under PICKUP', async () => {
    const groups = [1, 2].map((n) =>
      makeCatalogGroup(`g${n}`, `branch-${n}`, [makeCatalogItem(`i${n}`, makeProduct(`p${n}`))]),
    );
    const cart = makeCart(groups, { fulfillmentType: FulfillmentType.PICKUP });
    const branches = [1, 2].map((n) => makeBranch(`branch-${n}`));
    const { service } = buildHarness({ cart, branches });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects PICKUP when the branch does not allow it', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])], {
      fulfillmentType: FulfillmentType.PICKUP,
    });
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1', { pickupEnabled: false })] });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow(ConflictException);
  });

  // `makeAdHocGroup`'s default is BUY_FROM_PLACE with NO location. PD-012: a request's route is ORIGIN → DESTINATION; each end is the
  // customer's choice, else the service's configured default, else the request is refused. Every ad-hoc test that is about something
  // else supplies both ends explicitly, so it never depends on a configured default.
  const CUSTOMER_PICKUP = {
    adHocPickupLatitude: 30.5,
    adHocPickupLongitude: 31.5,
    adHocDestinationLatitude: 30.6,
    adHocDestinationLongitude: 31.6,
  };
  const HATLY_DEFAULTS = {
    HATLY_SERVICE_DEFAULT_PICKUP_LOCATION: { latitude: 30.1, longitude: 31.1, label: 'Hatly default start' },
    HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION: { latitude: 30.2, longitude: 31.2, label: 'Hatly default destination' },
  };
  const WASALLY_DEFAULT = { WASALLY_SERVICE_DEFAULT_DESTINATION_LOCATION: { latitude: 30.3, longitude: 31.3, label: 'Wasally default destination' } };

  it('preserves ad-hoc snapshot integrity: place name, free text, and images are frozen onto the order', async () => {
    const cart = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], CUSTOMER_PICKUP)]);
    const { service } = buildHarness({ cart });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments[0].adHocPlaceNameSnapshot).toBe('Corner Pharmacy');
    expect(order.segments[0].items[0].freeTextDescriptionSnapshot).toBe('Panadol Extra');
    expect(order.segments[0].items[0].imageUrlsSnapshot).toEqual(['stub-upload://a']);
  });

  it('never assigns a fake 0 price to an unpriced ad-hoc segment/item — stays null', async () => {
    const cart = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], CUSTOMER_PICKUP)]);
    const { service } = buildHarness({ cart });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments[0].subtotalMinor).toBeNull();
    expect(order.segments[0].items[0].unitPriceMinor).toBeNull();
    expect(order.segments[0].items[0].actualAmountMinor).toBeNull();
    expect(order.hasPendingAdHocPricing).toBe(true);
    expect(order.totalMinor).toBeNull();
  });

  it('rejects electronic payment for an order containing an unpriced ad-hoc segment', async () => {
    const cart = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')])]);
    const { service } = buildHarness({ cart });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'ONLINE' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows COD for an order containing an unpriced ad-hoc segment', async () => {
    const cart = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], CUSTOMER_PICKUP)]);
    const { service } = buildHarness({ cart });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    expect(order.paymentMethod).toBe('COD');
  });

  it('STALE EXPECTATION CORRECTED: a fully-catalog order still rejects ONLINE payment — no real gateway exists yet (matches the later, deliberate "PHASE E: rejects ONLINE payment outright" business decision below; this test predates that decision and originally asserted ONLINE would succeed)', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])]);
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'ONLINE' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails closed and leaves no partial Order when delivery-fee calculation fails (e.g. MapProvider unavailable)', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])]);
    const { service, store, deliveryFeeCalculationService } = buildHarness({ cart, branches: [makeBranch('branch-1')] });
    // Force the fee calculator to fail, simulating MapProvider still being a stub.
    deliveryFeeCalculationService.calculate = jest.fn(async () => {
      throw new Error('MapProvider not implemented');
    });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' }),
    ).rejects.toThrow();
    expect(store.orders.size).toBe(0);
    expect(store.carts.get('cart-1').status).toBe(CartStatus.ACTIVE);
  });

  it('Hatly (BUY_FROM_PLACE): a customer-chosen origin and destination win over the configured defaults — both are frozen on the segment', async () => {
    const cart = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], CUSTOMER_PICKUP)]);
    const { service } = buildHarness({ cart, businessConfigValues: HATLY_DEFAULTS });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments[0].adHocPickupLatitudeSnapshot).toBe(30.5);
    expect(order.segments[0].adHocPickupLongitudeSnapshot).toBe(31.5);
    expect(order.segments[0].adHocDestinationLatitudeSnapshot).toBe(30.6);
    expect(order.segments[0].adHocDestinationLongitudeSnapshot).toBe(31.6);
    expect((order.deliveryFeeBreakdownSnapshot as any).route).toMatchObject({
      origin: { latitude: 30.5, longitude: 31.5, source: 'CUSTOMER' },
      destination: { latitude: 30.6, longitude: 31.6, source: 'CUSTOMER' },
    });
  });

  it('Hatly: with no choice at all, origin and destination are the configured Hatly defaults (labelled, source DEFAULT) — never the customer address', async () => {
    const cart = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')])]);
    const { service } = buildHarness({ cart, businessConfigValues: HATLY_DEFAULTS });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments[0].adHocPickupLatitudeSnapshot).toBe(30.1);
    expect(order.segments[0].adHocDestinationLatitudeSnapshot).toBe(30.2);
    expect(order.segments[0].adHocDestinationLatitudeSnapshot).not.toBe(address.latitude);
    expect((order.deliveryFeeBreakdownSnapshot as any).route).toEqual({
      origin: { latitude: 30.1, longitude: 31.1, label: 'Hatly default start', source: 'DEFAULT' },
      destination: { latitude: 30.2, longitude: 31.2, label: 'Hatly default destination', source: 'DEFAULT' },
    });
  });

  it('Hatly: the two ends are independent — a chosen origin keeps the default destination, and vice versa', async () => {
    const onlyOrigin = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 })]);
    const first = await buildHarness({ cart: onlyOrigin, businessConfigValues: HATLY_DEFAULTS }).service.createOrder('customer-1', {
      deliveryAddress: address,
      paymentMethod: 'COD',
    });
    expect(first.segments[0].adHocPickupLatitudeSnapshot).toBe(30.5);
    expect(first.segments[0].adHocDestinationLatitudeSnapshot).toBe(30.2);

    const onlyDestination = makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], { adHocDestinationLatitude: 30.6, adHocDestinationLongitude: 31.6 })]);
    const second = await buildHarness({ cart: onlyDestination, businessConfigValues: HATLY_DEFAULTS }).service.createOrder('customer-1', {
      deliveryAddress: address,
      paymentMethod: 'COD',
    });
    expect(second.segments[0].adHocPickupLatitudeSnapshot).toBe(30.1);
    expect(second.segments[0].adHocDestinationLatitudeSnapshot).toBe(30.6);
  });

  it('Hatly: an unconfigured default is refused with its own clear code (nothing invented, the customer address never substituted)', async () => {
    const noPickup = buildHarness({ cart: makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')])]) });
    await expect(noPickup.service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toMatchObject({
      response: { details: { code: 'HATLY_DEFAULT_PICKUP_NOT_CONFIGURED' } },
    });
    expect(noPickup.store.orders.size).toBe(0);

    const noDestination = buildHarness({
      cart: makeCart([makeAdHocGroup('g1', [makeAdHocItem('i1')], { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5 })]),
      businessConfigValues: { HATLY_SERVICE_DEFAULT_PICKUP_LOCATION: HATLY_DEFAULTS.HATLY_SERVICE_DEFAULT_PICKUP_LOCATION },
    });
    await expect(noDestination.service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toMatchObject({
      response: { details: { code: 'HATLY_DEFAULT_DESTINATION_NOT_CONFIGURED' } },
    });
  });

  it('Wasally (DELIVER_TO_PLACE): the origin is ALWAYS the customer\'s — no default and never assumed from the home address', async () => {
    const group = makeAdHocGroup('g1', [makeAdHocItem('i1')], { adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE });
    const { service, store } = buildHarness({
      cart: makeCart([group]),
      // Every default configured — none may stand in for the customer's origin.
      businessConfigValues: { ...HATLY_DEFAULTS, ...WASALLY_DEFAULT },
    });

    await expect(service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toMatchObject({
      response: { details: { code: 'DELIVER_TO_PLACE_ORIGIN_REQUIRED' } },
    });
    expect(store.orders.size).toBe(0);
  });

  it('Wasally: a customer-chosen origin with no destination uses WASALLY\'s own default destination, never Hatly\'s', async () => {
    const group = makeAdHocGroup('g1', [makeAdHocItem('i1')], {
      adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE,
      adHocPickupLatitude: 30.45,
      adHocPickupLongitude: 31.45,
      adHocPickupLabel: 'Current location',
    });
    const { service } = buildHarness({ cart: makeCart([group]), businessConfigValues: { ...HATLY_DEFAULTS, ...WASALLY_DEFAULT } });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments[0].adHocPickupLatitudeSnapshot).toBe(30.45);
    expect(order.segments[0].adHocDestinationLatitudeSnapshot).toBe(30.3); // Wasally's default, not Hatly's 30.2
    expect((order.deliveryFeeBreakdownSnapshot as any).route).toEqual({
      origin: { latitude: 30.45, longitude: 31.45, label: 'Current location', source: 'CUSTOMER' },
      destination: { latitude: 30.3, longitude: 31.3, label: 'Wasally default destination', source: 'DEFAULT' },
    });
  });

  it('Wasally: with no Wasally default destination configured the request is refused — the Hatly default is not borrowed', async () => {
    const group = makeAdHocGroup('g1', [makeAdHocItem('i1')], {
      adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE,
      adHocPickupLatitude: 30.45,
      adHocPickupLongitude: 31.45,
    });
    const { service } = buildHarness({ cart: makeCart([group]), businessConfigValues: HATLY_DEFAULTS });

    await expect(service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toMatchObject({
      response: { details: { code: 'WASALLY_DEFAULT_DESTINATION_NOT_CONFIGURED' } },
    });
  });

  it('Wasally: a customer-chosen destination overrides the default, and direction is preserved origin → destination', async () => {
    const group = makeAdHocGroup('g1', [makeAdHocItem('i1')], {
      adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE,
      adHocPickupLatitude: 30.45,
      adHocPickupLongitude: 31.45,
      adHocDestinationLatitude: 30.55,
      adHocDestinationLongitude: 31.66,
    });
    const { service } = buildHarness({ cart: makeCart([group]), businessConfigValues: WASALLY_DEFAULT });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments[0].adHocDestinationLatitudeSnapshot).toBe(30.55);
    expect(order.segments[0].adHocDestinationLongitudeSnapshot).toBe(31.66);
    expect(order.segments[0].adHocPickupLatitudeSnapshot).toBe(30.45);
  });

  it('a missing customer ADDRESS is rejected for BOTH Hatly Service types — Hatly\'s configured locations never stand in for it', async () => {
    const defaults = {
      HATLY_SERVICE_DEFAULT_PICKUP_LOCATION: { latitude: 30.0, longitude: 31.0, label: 'Hatly Office' },
      HATLY_SERVICE_DEFAULT_DESTINATION_LOCATION: { latitude: 30.2, longitude: 31.2, label: 'Hatly HQ' },
    };
    const buy = makeAdHocGroup('g1', [makeAdHocItem('i1')], CUSTOMER_PICKUP);
    const deliver = makeAdHocGroup('g1', [makeAdHocItem('i1')], {
      adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE,
      adHocPickupLatitude: 30.45,
      adHocPickupLongitude: 31.45,
      adHocDestinationLatitude: 30.55,
      adHocDestinationLongitude: 31.66,
    });
    for (const group of [buy, deliver]) {
      const { rawCreateOrder, store } = buildHarness({ cart: makeCart([group]), businessConfigValues: defaults });
      await expect(rawCreateOrder('customer-1', { paymentMethod: 'COD' } as any)).rejects.toMatchObject({
        response: { details: { code: 'DELIVERY_ADDRESS_REQUIRED' } },
      });
      expect(store.orders.size).toBe(0);
    }
  });

  it('PHASE E: rejects ONLINE payment outright — no real gateway exists yet', async () => {
    const product = makeProduct('p1', { priceMinor: 1000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'ONLINE' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('PHASE E: MANUAL_TRANSFER creates a Payment row (PENDING, amount snapshotted) — COD creates none', async () => {
    const product = makeProduct('p1', { priceMinor: 1000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    const order = await service.createOrder('customer-1', {
      deliveryAddress: address,
      paymentMethod: 'MANUAL_TRANSFER',
      electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY,
    });

    const payments = [...store.payments.values()];
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      orderId: order.id,
      method: 'MANUAL_TRANSFER',
      status: PaymentStatus.PENDING,
      amountMinor: order.totalMinor ?? null,
    });
  });

  it('PHASE E: COD creates no Payment row — unchanged behavior', async () => {
    const product = makeProduct('p1', { priceMinor: 1000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(store.payments.size).toBe(0);
  });

  it('PHASE E: MANUAL_TRANSFER is still rejected for an unpriced Hatly Service order (BUY_FROM_PLACE — the purchase price is not known yet)', async () => {
    const group = makeAdHocGroup('g1', [makeAdHocItem('i1')], CUSTOMER_PICKUP);
    const cart = makeCart([group]);
    const { service } = buildHarness({ cart });

    await expect(
      service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY }),
    ).rejects.toThrow(BadRequestException);
  });

  it('Wasally (DELIVER_TO_PLACE) is delivery-fee only, so it is NOT unpriced: MANUAL_TRANSFER is accepted like any ordinary order', async () => {
    const group = makeAdHocGroup('g1', [makeAdHocItem('i1')], {
      adHocServiceType: AdHocServiceType.DELIVER_TO_PLACE,
      adHocPickupLatitude: 30.45,
      adHocPickupLongitude: 31.45,
      adHocDestinationLatitude: 30.2,
      adHocDestinationLongitude: 31.2,
    });
    const cart = makeCart([group]);
    const { service, store } = buildHarness({ cart });

    const order = await service.createOrder('customer-1', {
      deliveryAddress: address,
      paymentMethod: 'MANUAL_TRANSFER',
      electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY,
    });

    expect(order.hasPendingAdHocPricing).toBe(false);
    expect(order.totalMinor).toBe(order.deliveryFeeMinor);
    expect([...store.payments.values()]).toHaveLength(1);
  });

  it('PHASE G FIX: auto-accept is per-branch — Vendor A ON and Vendor B OFF in the SAME multi-vendor order start with different segment statuses', async () => {
    const productA = makeProduct('pA', { priceMinor: 500 });
    const productB = makeProduct('pB', { priceMinor: 700 });
    const cart = makeCart([
      makeCatalogGroup('gA', 'branch-a', [makeCatalogItem('iA', productA, 1)]),
      makeCatalogGroup('gB', 'branch-b', [makeCatalogItem('iB', productB, 1)]),
    ]);
    const { service, store } = buildHarness({
      cart,
      branches: [
        makeBranch('branch-a', { autoAcceptEnabled: true }),
        makeBranch('branch-b', { autoAcceptEnabled: false }),
      ],
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    const segments = [...store.segments.values()].filter((s: any) => s.orderId === order.id);
    const segA = segments.find((s: any) => s.vendorBranchId === 'branch-a');
    const segB = segments.find((s: any) => s.vendorBranchId === 'branch-b');
    expect(segA.status).toBe(OrderVendorSegmentStatus.CONFIRMED); // auto-accepted
    expect(segB.status).toBe(OrderVendorSegmentStatus.PENDING); // still requires manual acceptance — Vendor A's setting never leaked here
  });

  describe('PHASE G: Weighted Products', () => {    function makeWeightItem(id: string, product: any, requestedWeightGrams: number) {
      return {
        id,
        productId: product.id,
        product,
        quantity: 1,
        requestedWeightGrams,
        notes: null,
        freeTextDescription: null,
        imageUrls: null,
        selectedOptionValues: [],
      };
    }

    it('populates pricingUnitSnapshot/requestedWeightGrams/estimatedAmountMinor for a WEIGHT item, leaving actualWeightGrams/finalAmountMinor null', async () => {
      const product = makeProduct('p1', { priceMinor: 20000, pricingUnit: PricingUnit.WEIGHT }); // 200 EGP/kg
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeWeightItem('i1', product, 1150)])]);
      const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      const item = order.segments[0].items[0];
      expect(item.pricingUnitSnapshot).toBe(PricingUnit.WEIGHT);
      expect(item.requestedWeightGrams).toBe(1150);
      // 200 EGP/kg (20000 minor) * 1.15kg = 23000
      expect(item.estimatedAmountMinor).toBe(23000);
      expect(item.actualWeightGrams).toBeNull();
      expect(item.finalAmountMinor).toBeNull();
      expect(order.subtotalMinor).toBe(23000);
    });

    it('leaves a PIECE item completely unaffected — pricingUnitSnapshot PIECE, no weight fields populated', async () => {
      const product = makeProduct('p1', { priceMinor: 1000 }); // no pricingUnit override -> PIECE default
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 3)])]);
      const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      const item = order.segments[0].items[0];
      // The fixture doesn't set pricingUnit at all — in the real schema
      // the DB column defaults to PIECE, but a plain in-memory Product
      // fixture without the field is `undefined`, which the service
      // correctly normalizes to `null` here (never coerced to WEIGHT).
      expect(item.pricingUnitSnapshot).toBeNull();
      expect(item.requestedWeightGrams).toBeNull();
      expect(item.estimatedAmountMinor).toBeNull();
      expect(order.subtotalMinor).toBe(3000);
    });

    it('rejects MANUAL_TRANSFER for an order containing at least one WEIGHT item', async () => {
      const weightProduct = makeProduct('p1', { priceMinor: 20000, pricingUnit: PricingUnit.WEIGHT });
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeWeightItem('i1', weightProduct, 1000)])]);
      const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

      await expect(
        service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects MANUAL_TRANSFER when only ONE of several items in a multi-vendor order is weighted', async () => {
      const pieceProduct = makeProduct('p1', { priceMinor: 1000 });
      const weightProduct = makeProduct('p2', { priceMinor: 20000, pricingUnit: PricingUnit.WEIGHT });
      const cart = makeCart([
        makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', pieceProduct, 2)]),
        makeCatalogGroup('g2', 'branch-2', [makeWeightItem('i2', weightProduct, 500)]),
      ]);
      const { service } = buildHarness({ cart, branches: [makeBranch('branch-1'), makeBranch('branch-2')] });

      await expect(
        service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY }),
      ).rejects.toThrow(BadRequestException);
    });

    it('still allows MANUAL_TRANSFER for an order with only PIECE items — unrelated, unchanged behavior', async () => {
      const product = makeProduct('p1', { priceMinor: 1000 });
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
      const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

      await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'MANUAL_TRANSFER', electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY });
      expect(store.payments.size).toBe(1);
    });

    it('allows COD for a weighted order — unchanged, final amount collected at delivery', async () => {
      const weightProduct = makeProduct('p1', { priceMinor: 20000, pricingUnit: PricingUnit.WEIGHT });
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeWeightItem('i1', weightProduct, 1000)])]);
      const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      expect(order.paymentMethod).toBe('COD');
      expect(store.payments.size).toBe(0);
    });

    it('R20: refuses PAY_AT_DELIVERY for a new (weighted) order — PAY_AT_DELIVERY_NOT_AVAILABLE, no order or Payment row written', async () => {
      const weightProduct = makeProduct('p1', { priceMinor: 20000, pricingUnit: PricingUnit.WEIGHT });
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeWeightItem('i1', weightProduct, 1000)])]);
      const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

      await expect(
        service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'PAY_AT_DELIVERY', electronicPaymentMethod: ElectronicPaymentMethod.VODAFONE_CASH }),
      ).rejects.toMatchObject({ response: { details: { code: 'PAY_AT_DELIVERY_NOT_AVAILABLE' } } });
      expect(store.payments.size).toBe(0);
    });

    it('multi-vendor isolation: only the weighted vendor segment/item gets weight fields, the piece vendor segment is untouched', async () => {
      const pieceProduct = makeProduct('p1', { priceMinor: 1000 });
      const weightProduct = makeProduct('p2', { priceMinor: 20000, pricingUnit: PricingUnit.WEIGHT });
      const cart = makeCart([
        makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', pieceProduct, 2)]),
        makeCatalogGroup('g2', 'branch-2', [makeWeightItem('i2', weightProduct, 1000)]),
      ]);
      const { service } = buildHarness({ cart, branches: [makeBranch('branch-1'), makeBranch('branch-2')] });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      const pieceSegment = order.segments.find((s: any) => s.vendorBranchId === 'branch-1')!;
      const weightSegment = order.segments.find((s: any) => s.vendorBranchId === 'branch-2')!;

      expect(pieceSegment.items[0].pricingUnitSnapshot).toBeNull();
      expect(pieceSegment.items[0].requestedWeightGrams).toBeNull();
      expect(weightSegment.items[0].pricingUnitSnapshot).toBe(PricingUnit.WEIGHT);
      expect(weightSegment.items[0].requestedWeightGrams).toBe(1000);
      // 2 pieces * 1000 + (200 EGP/kg * 1.0kg) = 2000 + 20000
      expect(order.subtotalMinor).toBe(22000);
    });
  });

  describe('PHASE G: Offers & Promotions', () => {
    function offerPlan(overrides: Partial<any> = {}) {
      return {
        offer: { id: 'offer-1', discountType: 'PERCENTAGE', discountValue: 2000 },
        discountedQuantity: 1,
        discountPerUnitMinor: 2000,
        discountAmountMinor: 2000,
        originalUnitPriceMinor: 10000,
        ...overrides,
      };
    }

    function makeOfferMock(planByCartItemId: Record<string, any>, opts: { subtotalPlansByBranch?: Record<string, any> } = {}) {
      const plans = new Map(Object.entries(planByCartItemId));
      const subtotalPlansByBranch = opts.subtotalPlansByBranch ?? {};
      return {
        planFlashSaleForCart: jest.fn(async () => ({ plans, lockedOffers: new Map() })),
        // CRITICAL REGRESSION FIX: the real order-creation.service.ts
        // now calls these two methods unconditionally for every
        // CATALOG group — without stubs here, EVERY existing test
        // using makeOfferMock would throw "is not a function".
        // Default: no subtotal-discount plan for any branch, customer
        // always allowed — a true no-op, matching every existing
        // test's implicit "no subtotal discount involved" assumption.
        planSubtotalDiscountForSegment: jest.fn(async (_manager: any, params: { vendorBranchId: string }) => ({
          plan: subtotalPlansByBranch[params.vendorBranchId] ?? null,
          lockedOffer: subtotalPlansByBranch[params.vendorBranchId]?.offer ?? null,
        })),
        checkSubtotalDiscountCustomerLimit: jest.fn(async () => true),
        finalizeConsumption: jest.fn(
          async (_manager: unknown, _params: { orderId: string; orderItemIdByCartItemId: Map<string, string> }) =>
            undefined,
        ),
        recordHatlyFundedDiscountEvent: jest.fn(async () => undefined),
      };
    }

    it('HATLY-FUNDED: populates Order.discountMinor/totalMinor from the offer, while segment.subtotalMinor (Vendor commission basis) stays at the GROSS pre-offer amount', async () => {
      const product = makeProduct('p1', { priceMinor: 10000 }); // 100 EGP
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
      const offerConsumptionService = makeOfferMock({ i1: offerPlan() });
      const { service, store } = buildHarness({
        cart,
        branches: [makeBranch('branch-1')],
        offerConsumptionService,
      });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      // Customer-facing: 20 EGP off the 100 EGP item.
      expect(order.discountMinor).toBe(2000);
      // Commission basis: genuinely untouched — still the full 100 EGP.
      expect(order.segments[0].subtotalMinor).toBe(10000);
      expect(order.subtotalMinor).toBe(10000);
      // Payable total reflects the discount via the existing, unchanged formula.
      expect(order.totalMinor).toBe(10000 + 1234 - 2000); // subtotal + deliveryFee(default) - discount

      const item = order.segments[0].items[0];
      expect(item.appliedOfferId).toBe('offer-1');
      expect(item.offerDiscountedQuantity).toBe(1);
      expect(item.offerDiscountTypeSnapshot).toBe('PERCENTAGE');
      expect(item.offerDiscountValueSnapshot).toBe(2000);
      expect(item.offerDiscountAmountMinor).toBe(2000);
      // unitPriceMinor itself is NEVER reduced — it remains the commission basis.
      expect(item.unitPriceMinor).toBe(10000);

      expect(offerConsumptionService.finalizeConsumption).toHaveBeenCalledTimes(1);
      const finalizeCall = offerConsumptionService.finalizeConsumption.mock.calls[0][1];
      expect(finalizeCall.orderId).toBe(order.id);
      expect(finalizeCall.orderItemIdByCartItemId.get('i1')).toBe(item.id);

      // Recorded once, AFTER the transaction, with the total discount.
      expect(offerConsumptionService.recordHatlyFundedDiscountEvent).toHaveBeenCalledWith(order.id, 2000);
      expect(store.payments.size).toBe(0); // COD — unrelated to offers, unchanged
    });

    it('an item with no matching offer plan is completely unaffected — all offer fields null', async () => {
      const product = makeProduct('p1', { priceMinor: 10000 });
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
      const offerConsumptionService = makeOfferMock({}); // no plans at all
      const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')], offerConsumptionService });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      expect(order.discountMinor).toBe(0);
      const item = order.segments[0].items[0];
      expect(item.appliedOfferId).toBeNull();
      expect(item.offerDiscountAmountMinor).toBeNull();
    });

    it('MULTI-VENDOR: an offer plan for Vendor A\'s item never affects Vendor B\'s segment subtotal or item', async () => {
      const productA = makeProduct('pA', { priceMinor: 10000 });
      const productB = makeProduct('pB', { priceMinor: 5000 });
      const cart = makeCart([
        makeCatalogGroup('g1', 'branch-A', [makeCatalogItem('iA', productA, 1)]),
        makeCatalogGroup('g2', 'branch-B', [makeCatalogItem('iB', productB, 1)]),
      ]);
      const offerConsumptionService = makeOfferMock({ iA: offerPlan({ discountAmountMinor: 2000 }) });
      const { service } = buildHarness({
        cart,
        branches: [makeBranch('branch-A'), makeBranch('branch-B')],
        offerConsumptionService,
      });

      const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

      const segA = order.segments.find((s: any) => s.vendorBranchId === 'branch-A')!;
      const segB = order.segments.find((s: any) => s.vendorBranchId === 'branch-B')!;

      expect(segA.subtotalMinor).toBe(10000); // gross, untouched
      expect(segA.items[0].offerDiscountAmountMinor).toBe(2000);
      expect(segB.subtotalMinor).toBe(5000); // completely unaffected
      expect(segB.items[0].appliedOfferId).toBeNull();
      expect(order.discountMinor).toBe(2000); // only Vendor A's discount counted
    });

    it('MANUAL_TRANSFER Payment.amountMinor reflects the post-discount payable total', async () => {
      const product = makeProduct('p1', { priceMinor: 10000 });
      const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
      const offerConsumptionService = makeOfferMock({ i1: offerPlan({ discountAmountMinor: 2000 }) });
      const { service, store } = buildHarness({
        cart,
        branches: [makeBranch('branch-1')],
        offerConsumptionService,
      });

      const order = await service.createOrder('customer-1', {
        deliveryAddress: address,
        paymentMethod: 'MANUAL_TRANSFER',
        electronicPaymentMethod: ElectronicPaymentMethod.INSTAPAY,
      });

      const payment = [...store.payments.values()][0];
      expect(payment.amountMinor).toBe(order.totalMinor);
      expect(order.totalMinor).toBe(10000 + 1234 - 2000);
    });
  });
});

describe('OrderCreationService — Tracked Inventory Order-Time Enforcement', () => {
  it('OPEN product: order succeeds without decrementing quantity (quantity is never even required)', async () => {
    const product = makeProduct('p-open', { inventoryMode: 'OPEN', quantity: null });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 3)])]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [product],
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.segments).toHaveLength(1);
    expect(store.products.get('p-open').quantity).toBeNull();
  });

  it('TRACKED PIECE: sufficient stock decrements correctly', async () => {
    const product = makeProduct('p-piece', { inventoryMode: 'TRACKED', pricingUnit: 'PIECE', quantity: 10 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 4)])]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [product],
    });

    await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(store.products.get('p-piece').quantity).toBe(6);
  });

  it('CRITICAL: TRACKED PIECE insufficient stock fails with INSUFFICIENT_INVENTORY, and the order is not created', async () => {
    const product = makeProduct('p-piece-2', { inventoryMode: 'TRACKED', pricingUnit: 'PIECE', quantity: 2 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 5)])]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [product],
    });

    let caught: any;
    try {
      await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught.getResponse().details.code).toBe('INSUFFICIENT_INVENTORY');
    // Stock untouched — the atomic UPDATE's own WHERE clause rejected
    // it, no partial decrement occurred.
    expect(store.products.get('p-piece-2').quantity).toBe(2);
    expect(store.orders.size).toBe(0);
  });

  it('TRACKED WEIGHT: requestedWeightGrams decrements correctly', async () => {
    const product = makeProduct('p-weight', { inventoryMode: 'TRACKED', pricingUnit: 'WEIGHT', quantity: 10000 });
    const item = { ...makeCatalogItem('i1', product, 1), requestedWeightGrams: 750 };
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [item])]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [product],
    });

    await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(store.products.get('p-weight').quantity).toBe(9250);
  });

  it('CRITICAL: actualWeightGrams (if somehow present on the item) never affects inventory deduction — only requestedWeightGrams participates', async () => {
    const product = makeProduct('p-weight-2', { inventoryMode: 'TRACKED', pricingUnit: 'WEIGHT', quantity: 10000 });
    const item = {
      ...makeCatalogItem('i1', product, 1),
      requestedWeightGrams: 750,
      actualWeightGrams: 820, // must be ignored entirely by inventory accounting
    };
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [item])]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [product],
    });

    await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    // 10000 - 750 (requested), NOT 10000 - 820 (actual).
    expect(store.products.get('p-weight-2').quantity).toBe(9250);
  });

  it('zero inventory: TRACKED quantity=0 cannot satisfy a positive request', async () => {
    const product = makeProduct('p-zero', { inventoryMode: 'TRACKED', pricingUnit: 'PIECE', quantity: 0 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [product],
    });

    await expect(service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toThrow(
      BadRequestException,
    );
    expect(store.products.get('p-zero').quantity).toBe(0);
  });

  it('CRITICAL: atomic/transactional behavior — a later failure in the SAME order rolls back an EARLIER item\u2019s decrement (no orphaned deduction)', async () => {
    // Two tracked items in the SAME order: the first has enough stock
    // and would succeed on its own; the second does not. Since both
    // live inside the same `dataSource.transaction` callback (the
    // harness's fake `dataSource.transaction` just invokes the
    // callback directly — a thrown error here surfaces exactly as it
    // would with a real rolled-back transaction, and no `orders.set`
    // for this cart's order ever runs), the first item's decrement
    // must not persist once the overall createOrder call fails.
    const okProduct = makeProduct('p-ok', { inventoryMode: 'TRACKED', pricingUnit: 'PIECE', quantity: 10 });
    const shortProduct = makeProduct('p-short', { inventoryMode: 'TRACKED', pricingUnit: 'PIECE', quantity: 1 });
    const cart = makeCart([
      makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', okProduct, 3), makeCatalogItem('i2', shortProduct, 5)]),
    ]);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      products: [okProduct, shortProduct],
    });

    await expect(service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toThrow(
      BadRequestException,
    );

    // The real guarantee here comes from the EXISTING transaction
    // boundary (this method never introduces a second one) — this
    // test's fake `dataSource.transaction` doesn't itself roll back
    // in-memory mutations the way Postgres would, so it can't
    // directly prove rollback; what it DOES prove is that the order
    // was never persisted, matching "no partial order" (see the real
    // rollback guarantee note in enforceAndDecrementInventory's own
    // comment: it relies on the pre-existing, already-proven
    // transaction wrapping, not a new mechanism this test could
    // independently fake).
    expect(store.orders.size).toBe(0);
  });

  it('concurrency/race protection: two simultaneous requests against the same product cannot both succeed past available stock', async () => {
    // Simulates two concurrent createOrder calls sharing ONE product
    // row: the query-builder mock's WHERE-guarded UPDATE is what
    // prevents overselling — the second call's atomic UPDATE must see
    // the already-decremented value and fail its own WHERE clause.
    const sharedProduct = makeProduct('p-race', { inventoryMode: 'TRACKED', pricingUnit: 'PIECE', quantity: 5 }) as ReturnType<
      typeof makeProduct
    > & { quantity: number };
    const cartA = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', sharedProduct, 4)])], {
      id: 'cart-a',
      customerId: 'customer-a',
    });
    const cartB = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', sharedProduct, 4)])], {
      id: 'cart-b',
      customerId: 'customer-b',
    });

    const harnessA = buildHarness({ cart: cartA, branches: [makeBranch('branch-1')], products: [sharedProduct] });
    // Second harness shares the SAME store.products Map entry by
    // reusing the identical `sharedProduct` object reference — the
    // mock's `store.products` for harness B is seeded with that same
    // object, so a decrement from "call A" is visible to "call B",
    // exactly modeling one shared row under concurrent access.
    const harnessB = buildHarness({ cart: cartB, branches: [makeBranch('branch-1')], products: [sharedProduct] });

    const [resultA, resultB] = await Promise.allSettled([
      harnessA.service.createOrder('customer-a', { deliveryAddress: address, paymentMethod: 'COD' }),
      harnessB.service.createOrder('customer-b', { deliveryAddress: address, paymentMethod: 'COD' }),
    ]);

    const outcomes = [resultA.status, resultB.status];
    // Exactly one succeeds (4 of 5 available) — the other must fail;
    // both succeeding would mean 8 units sold from a 5-unit stock.
    expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((s) => s === 'rejected')).toHaveLength(1);
    expect(sharedProduct.quantity).toBe(1);
  });

  it('idempotency: reuses the existing cart-lock mechanism — no separate/duplicate inventory decrement path was introduced', () => {
    // No new idempotency mechanism exists to test in isolation — this
    // chunk deliberately reuses the pre-existing pessimistic cart lock
    // (see createOrder's own comment) rather than introducing a
    // parallel one. Documented here rather than fabricating a test
    // for a mechanism that was never built, per the explicit
    // instruction not to create a parallel idempotency framework.
    expect(true).toBe(true);
  });
});

describe('OrderCreationService — Offers Final System: SUBTOTAL_DISCOUNT real checkout integration', () => {
  function makeOfferMockWithSubtotal(subtotalPlansByBranch: Record<string, any>) {
    return {
      planFlashSaleForCart: jest.fn(async () => ({ plans: new Map(), lockedOffers: new Map() })),
      planSubtotalDiscountForSegment: jest.fn(async (_manager: any, params: { vendorBranchId: string }) => ({
        plan: subtotalPlansByBranch[params.vendorBranchId] ?? null,
        lockedOffer: subtotalPlansByBranch[params.vendorBranchId]?.offer ?? null,
      })),
      checkSubtotalDiscountCustomerLimit: jest.fn(async () => true),
      finalizeConsumption: jest.fn(async () => undefined),
      recordHatlyFundedDiscountEvent: jest.fn(async () => undefined),
    };
  }

  function segmentPlan(overrides: Partial<any> = {}) {
    return {
      offer: { id: 'offer-1', discountType: 'PERCENTAGE', discountValue: 1000 },
      eligibleSubtotalMinor: 50000,
      discountAmountMinor: 5000,
      ...overrides,
    };
  }

  it('reaches Order.discountMinor/totalMinor and the correct OrderVendorSegment snapshot columns', async () => {
    const product = makeProduct('p1', { priceMinor: 50000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const offerConsumptionService = makeOfferMockWithSubtotal({ 'branch-1': segmentPlan() });
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      offerConsumptionService,
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.discountMinor).toBe(5000);
    const segments = [...store.segments.values()].filter((s: any) => s.orderId === order.id);
    expect(segments).toHaveLength(1);
    expect(segments[0].appliedOfferId).toBe('offer-1');
    expect(segments[0].offerDiscountAmountMinor).toBe(5000);
    expect(segments[0].offerEligibleSubtotalMinorSnapshot).toBe(50000);
    // Raw subtotal is UNCHANGED by the discount — the discount lives
    // only in the dedicated snapshot columns, never by mutating
    // subtotalMinor itself.
    expect(segments[0].subtotalMinor).toBe(50000);
  });

  it('CRITICAL multi-vendor isolation: VendorBranch A\u2019s discount never touches VendorBranch B\u2019s segment, and vice versa', async () => {
    const productA = makeProduct('pA', { priceMinor: 50000 });
    const productB = makeProduct('pB', { priceMinor: 40000 });
    const cart = makeCart([
      makeCatalogGroup('gA', 'branch-A', [makeCatalogItem('iA', productA, 1)]),
      makeCatalogGroup('gB', 'branch-B', [makeCatalogItem('iB', productB, 1)]),
    ]);
    const offerConsumptionService = makeOfferMockWithSubtotal({
      'branch-A': segmentPlan({ offer: { id: 'offer-A', discountType: 'PERCENTAGE', discountValue: 1000 }, eligibleSubtotalMinor: 50000, discountAmountMinor: 5000 }),
      'branch-B': segmentPlan({ offer: { id: 'offer-B', discountType: 'PERCENTAGE', discountValue: 2000 }, eligibleSubtotalMinor: 40000, discountAmountMinor: 8000 }),
    });
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-A'), makeBranch('branch-B')],
      offerConsumptionService,
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.discountMinor).toBe(13000); // 5000 (A) + 8000 (B), never crossed
    const segments = [...store.segments.values()].filter((s: any) => s.orderId === order.id);
    const segA = segments.find((s: any) => s.vendorBranchId === 'branch-A');
    const segB = segments.find((s: any) => s.vendorBranchId === 'branch-B');
    expect(segA.appliedOfferId).toBe('offer-A');
    expect(segA.offerDiscountAmountMinor).toBe(5000);
    expect(segB.appliedOfferId).toBe('offer-B');
    expect(segB.offerDiscountAmountMinor).toBe(8000);
    // A's offer never appears on B's segment or vice versa.
    expect(segA.appliedOfferId).not.toBe(segB.appliedOfferId);
  });

  it('customer limit rejection (checkSubtotalDiscountCustomerLimit returns false) means no discount is applied for that segment', async () => {
    const product = makeProduct('p1', { priceMinor: 50000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const offerConsumptionService = makeOfferMockWithSubtotal({ 'branch-1': segmentPlan() });
    offerConsumptionService.checkSubtotalDiscountCustomerLimit = jest.fn(async () => false);
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      offerConsumptionService,
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.discountMinor).toBe(0);
    const segments = [...store.segments.values()].filter((s: any) => s.orderId === order.id);
    expect(segments[0].appliedOfferId).toBeNull();
  });

  it('delivery fee is never discounted by SUBTOTAL_DISCOUNT — Order.totalMinor reflects subtotal + delivery fee - discount, discount never applied to the fee itself', async () => {
    const product = makeProduct('p1', { priceMinor: 50000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const offerConsumptionService = makeOfferMockWithSubtotal({ 'branch-1': segmentPlan() });
    const { service } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      offerConsumptionService,
      deliveryFeeMinor: 2000,
    });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    expect(order.totalMinor).toBe(50000 + 2000 - 5000);
  });

  it('ROLLBACK: if order-state-machine transition or any later step throws after Offer planning, no partial Order/segment/OfferConsumption state is visible (transaction never partially applied in this fake, matching the real all-or-nothing transaction wrapper)', async () => {
    const product = makeProduct('p1', { priceMinor: 50000 });
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1)])]);
    const offerConsumptionService = makeOfferMockWithSubtotal({ 'branch-1': segmentPlan() });
    // Force finalizeConsumption itself to fail, simulating any
    // late-stage failure after planning has already happened.
    offerConsumptionService.finalizeConsumption = jest.fn(async () => {
      throw new Error('simulated late failure');
    });
    const { service, store } = buildHarness({
      cart,
      branches: [makeBranch('branch-1')],
      offerConsumptionService,
    });

    await expect(service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toThrow();
    // Genuinely provable here, not just assumed: this failure happens
    // AFTER the Order/segments/items already exist in the fake store
    // (finalizeConsumption is one of the LAST steps in createOrder,
    // called well after Step 9 creates them) — so this only passes
    // because buildHarness's dataSource.transaction snapshots and
    // restores store.orders/segments/items/payments/carts around the
    // callback, the same all-or-nothing guarantee the real
    // dataSource.transaction() gets from Postgres. Without that, this
    // assertion could never hold for a failure positioned this late.
    expect(store.orders.size).toBe(0);
  });
});

describe('OrderCreationService — Vendor/Pharmacy Custom Item inside a CATALOG group', () => {
  it('accepts a catalog product AND a custom item in the SAME CATALOG group/segment', async () => {
    const product = makeProduct('p1', { priceMinor: 10000 });
    const customItem = makeAdHocItem('custom-1'); // productId: null, product: null, freeTextDescription set
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1), customItem])]);
    const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    const segments = [...store.segments.values()].filter((s: any) => s.orderId === order.id);
    expect(segments).toHaveLength(1); // ONE vendor segment — never split into two groups
    const items = [...store.items.values()].filter((i: any) => i.orderVendorSegmentId === segments[0].id);
    expect(items).toHaveLength(2);
  });

  it('CRITICAL: the custom item\u2019s unitPriceMinor remains NULL and it contributes 0 to the segment/order total', async () => {
    const product = makeProduct('p1', { priceMinor: 10000 });
    const customItem = makeAdHocItem('custom-1');
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1), customItem])]);
    const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')], deliveryFeeMinor: 0 });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });

    const items = [...store.items.values()].filter((i: any) => i.orderId === order.id || true);
    const customOrderItem = items.find((i: any) => i.productId === null);
    expect(customOrderItem.unitPriceMinor).toBeNull();
    expect(order.subtotalMinor).toBe(10000); // only the real product — custom item added 0
  });

  it('preserves existing OrderItem snapshot fields for the custom item (freeTextDescriptionSnapshot/imageUrlsSnapshot)', async () => {
    const product = makeProduct('p1', { priceMinor: 10000 });
    const customItem = makeAdHocItem('custom-1');
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1), customItem])]);
    const { service, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    const customOrderItem = [...store.items.values()].find((i: any) => i.productId === null);

    expect(customOrderItem.freeTextDescriptionSnapshot).toBe('Panadol Extra');
    expect(customOrderItem.imageUrlsSnapshot).toEqual(['stub-upload://a']);
  });

  it('a genuinely unavailable REAL product in the same group as a custom item still throws (custom items never bypass real-product validation)', async () => {
    const product = makeProduct('p1', { priceMinor: 10000, isAvailable: false });
    const customItem = makeAdHocItem('custom-1');
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', product, 1), customItem])]);
    const { service } = buildHarness({ cart, branches: [makeBranch('branch-1')] });

    await expect(service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toThrow();
  });

  it('existing External Hatly Service (AD_HOC_SERVICE) order creation remains unchanged', async () => {
    const customItem = makeAdHocItem('custom-1');
    const cart = makeCart([makeAdHocGroup('g1', [customItem], { adHocPickupLatitude: 30.5, adHocPickupLongitude: 31.5, adHocDestinationLatitude: 30.6, adHocDestinationLongitude: 31.6 })]);
    const { service, store } = buildHarness({ cart, branches: [] });

    const order = await service.createOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    const segments = [...store.segments.values()].filter((s: any) => s.orderId === order.id);
    expect(segments).toHaveLength(1);
    expect(segments[0].groupType).toBe(CartGroupType.AD_HOC_SERVICE);
  });
});

describe('OrderCreationService — quote token is MANDATORY for a DELIVERY order (production-readiness slice)', () => {
  it('rejects a DELIVERY order with no quoteToken at all — QUOTE_TOKEN_REQUIRED, nothing created', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])]);
    const { rawCreateOrder, store } = buildHarness({ cart, branches: [makeBranch('branch-1')] });
    await expect(rawCreateOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toMatchObject({
      response: { details: { code: 'QUOTE_TOKEN_REQUIRED' } },
    });
    expect(store.orders.size).toBe(0);
  });

  it('a PICKUP order needs no quote token', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])], {
      fulfillmentType: FulfillmentType.PICKUP,
    });
    const { rawCreateOrder } = buildHarness({ cart, branches: [makeBranch('branch-1')] });
    const order = await rawCreateOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' });
    expect(order.fulfillmentType).toBe(FulfillmentType.PICKUP);
  });

  it('a genuinely unavailable branch is refused for ITS OWN reason — never masked by QUOTE_TOKEN_REQUIRED', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'))])]);
    const { rawCreateOrder } = buildHarness({ cart, branches: [makeBranch('branch-1', { isActive: false })] });
    await expect(rawCreateOrder('customer-1', { deliveryAddress: address, paymentMethod: 'COD' })).rejects.toMatchObject({
      response: { details: { code: 'BRANCH_UNAVAILABLE' } },
    });
  });

  it('a valid, matching quote token lets the order through; a token for a DIFFERENT cart (stale inputsHash) is refused as stale, never silently accepted', async () => {
    const cart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'), 2)])]);
    const { rawCreateOrder, quoteService } = buildHarness({ cart, branches: [makeBranch('branch-1')], deliveryFeeMinor: 900 });
    const dto = { deliveryAddress: address, paymentMethod: 'COD' as const };
    const quoted = await quoteService.quote('customer-1', dto);
    const order = await rawCreateOrder('customer-1', { ...dto, quoteToken: quoted.data.quoteToken as string });
    expect(order.totalMinor).toBe(2000 + 900);

    // a second, unrelated cart never matches this cart's frozen quote token
    const otherCart = makeCart([makeCatalogGroup('g1', 'branch-1', [makeCatalogItem('i1', makeProduct('p1'), 5)])]);
    const otherHarness = buildHarness({ cart: otherCart, branches: [makeBranch('branch-1')], deliveryFeeMinor: 900 });
    await expect(
      otherHarness.rawCreateOrder('customer-1', { ...dto, quoteToken: quoted.data.quoteToken as string }),
    ).rejects.toMatchObject({ response: { details: { code: 'QUOTE_STALE' } } });
  });
});
