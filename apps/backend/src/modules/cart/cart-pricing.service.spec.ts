import { CartPricingService } from './cart-pricing.service';
import { CartGroupType } from './cart-group-type.enum';
import { FulfillmentType } from './fulfillment-type.enum';
import { Cart, CartStatus } from './entities/cart.entity';
import { CartVendorGroup } from './entities/cart-vendor-group.entity';
import { CartItem } from './entities/cart-item.entity';
import { PricingUnit } from '../products/pricing-unit.enum';

function buildCatalogItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-1',
    productId: 'product-1',
    quantity: 2,
    notes: null,
    freeTextDescription: null,
    imageUrls: null,
    selectedOptionValues: [],
    product: {
      id: 'product-1',
      name: 'Burger',
      nameAr: null,
      imageUrl: null,
      priceMinor: 1000,
      isAvailable: true,
      deletedAt: null,
    },
    ...overrides,
  } as unknown as CartItem;
}

function buildAdHocItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-2',
    productId: null,
    quantity: 1,
    notes: null,
    freeTextDescription: 'Panadol Extra',
    imageUrls: ['stub-upload://abc/rx.png'],
    selectedOptionValues: [],
    product: null,
    ...overrides,
  } as unknown as CartItem;
}

function buildCart(groups: CartVendorGroup[]): Cart {
  return {
    id: 'cart-1',
    customerId: 'customer-1',
    status: CartStatus.ACTIVE,
    fulfillmentType: FulfillmentType.DELIVERY,
    orderNote: null,
    groups,
  } as Cart;
}

describe('CartPricingService', () => {
  const service = new CartPricingService();

  it('computes a CATALOG group subtotal from product price + option deltas', () => {
    const group = {
      id: 'group-1',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-1',
      adHocPlaceName: null,
      vendorNote: 'less spicy',
      items: [buildCatalogItem()],
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([group]), new Map([['branch-1', 'Test Vendor']]));

    expect(view.groups[0].subtotalMinor).toBe(2000); // 1000 * 2
    expect(view.groups[0].vendorNote).toBe('less spicy');
    expect(view.subtotalMinor).toBe(2000);
    expect(view.hasUnpricedItems).toBe(false);
  });

  it('AD_HOC_SERVICE group and item never get a numeric price — null, not 0', () => {
    const group = {
      id: 'group-2',
      groupType: CartGroupType.AD_HOC_SERVICE,
      vendorBranchId: null,
      adHocPlaceName: 'Corner Pharmacy',
      vendorNote: null,
      items: [buildAdHocItem()],
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([group]), new Map());

    expect(view.groups[0].subtotalMinor).toBeNull();
    expect(view.groups[0].items[0].unitPriceMinor).toBeNull();
    expect(view.groups[0].items[0].lineTotalMinor).toBeNull();
    expect(view.groups[0].items[0].freeTextDescription).toBe('Panadol Extra');
    expect(view.groups[0].items[0].imageUrls).toEqual(['stub-upload://abc/rx.png']);
    expect(view.subtotalMinor).toBe(0); // nothing numeric to add from this group
    expect(view.hasUnpricedItems).toBe(true);
  });

  it('a cart with only a Hatly Service request whose price is pending IS readyForCheckout (pending is an explicit state, not a blocker); hasUnpricedItems stays true as information', () => {
    const group = {
      id: 'group-2',
      groupType: CartGroupType.AD_HOC_SERVICE,
      vendorBranchId: null,
      adHocPlaceName: 'Corner Pharmacy',
      vendorNote: null,
      items: [buildAdHocItem()],
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([group]), new Map());
    expect(view.hasUnpricedItems).toBe(true);
    expect(view.readyForCheckout).toBe(true);
    expect(view.groups[0].subtotalMinor).toBeNull(); // still never a fabricated 0
  });

  it('an EMPTY Hatly Service group is not ready — there is nothing to order', () => {
    const group = { id: 'group-2', groupType: CartGroupType.AD_HOC_SERVICE, vendorBranchId: null, adHocPlaceName: 'Corner Pharmacy', vendorNote: null, items: [] } as unknown as CartVendorGroup;
    expect(service.buildCartView(buildCart([group]), new Map()).readyForCheckout).toBe(false);
  });

  it("multi-vendor: computes each CATALOG group's subtotal independently and sums them at the cart level (Multi-Vendor preserved — no minimum-order gate of any kind)", () => {
    const groupA = {
      id: 'group-a',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-a',
      adHocPlaceName: null,
      vendorNote: null,
      items: [
        buildCatalogItem({ id: 'a1', product: { ...buildCatalogItem().product, priceMinor: 500 } as any, quantity: 1 }),
      ],
    } as unknown as CartVendorGroup;
    const groupB = {
      id: 'group-b',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-b',
      adHocPlaceName: null,
      vendorNote: null,
      items: [
        buildCatalogItem({ id: 'b1', product: { ...buildCatalogItem().product, priceMinor: 5000 } as any, quantity: 1 }),
      ],
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([groupA, groupB]), new Map());

    // A tiny 500-minor-unit order is fully valid on its own — no minimum-order concept exists.
    expect(view.groups[0].subtotalMinor).toBe(500);
    expect(view.groups[1].subtotalMinor).toBe(5000);
    expect(view.subtotalMinor).toBe(5500); // sum across both vendor groups
    expect(view.readyForCheckout).toBe(true); // nothing blocks checkout — no minimum-order gate anywhere
  });

  it('an unavailable catalog product is surfaced, not silently dropped', () => {
    const group = {
      id: 'group-1',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-1',
      adHocPlaceName: null,
      vendorNote: null,
      items: [buildCatalogItem({ product: { ...buildCatalogItem().product, isAvailable: false } as any })],
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([group]), new Map());
    expect(view.groups[0].items[0].isAvailable).toBe(false);
    expect(view.readyForCheckout).toBe(false);
  });
});

describe('CartPricingService — Weighted Products (Phase G)', () => {
  const service = new CartPricingService();

  function buildWeightItem(overrides: Partial<CartItem> = {}): CartItem {
    return {
      id: 'item-1',
      productId: 'product-1',
      quantity: 1,
      requestedWeightGrams: 1150,
      notes: null,
      freeTextDescription: null,
      imageUrls: null,
      selectedOptionValues: [],
      product: {
        id: 'product-1',
        name: 'Chicken Breast',
        nameAr: null,
        imageUrl: null,
        priceMinor: 20000, // 200 EGP/kg
        pricingUnit: PricingUnit.WEIGHT,
        isAvailable: true,
        deletedAt: null,
      },
      ...overrides,
    } as unknown as CartItem;
  }

  it('computes lineTotalMinor from requestedWeightGrams, never from quantity', () => {
    const group = {
      id: 'group-1',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-1',
      adHocPlaceName: null,
      vendorNote: null,
      items: [buildWeightItem()],
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([group]), new Map());
    const item = view.groups[0].items[0];

    expect(item.pricingUnit).toBe(PricingUnit.WEIGHT);
    expect(item.requestedWeightGrams).toBe(1150);
    // 200 EGP/kg (20000 minor) * 1.15kg = 23000 — quantity (1) plays no role
    expect(item.lineTotalMinor).toBe(23000);
    expect(view.subtotalMinor).toBe(23000);
  });

  it('a PIECE item in the same cart is priced by the unchanged quantity formula', () => {
    const weightGroup = {
      id: 'group-1',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-1',
      adHocPlaceName: null,
      vendorNote: null,
      items: [buildWeightItem()],
    } as unknown as CartVendorGroup;
    const pieceGroup = {
      id: 'group-2',
      groupType: CartGroupType.CATALOG,
      vendorBranchId: 'branch-2',
      adHocPlaceName: null,
      vendorNote: null,
      items: [buildCatalogItem({ id: 'item-2' })], // quantity 2, priceMinor 1000
    } as unknown as CartVendorGroup;

    const view = service.buildCartView(buildCart([weightGroup, pieceGroup]), new Map());

    expect(view.groups[1].items[0].lineTotalMinor).toBe(2000); // unchanged: 1000 * 2
    expect(view.subtotalMinor).toBe(23000 + 2000);
  });
});
