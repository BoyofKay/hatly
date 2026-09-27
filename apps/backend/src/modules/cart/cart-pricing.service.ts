import { Injectable } from '@nestjs/common';
import { Cart } from './entities/cart.entity';
import { CartVendorGroup } from './entities/cart-vendor-group.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartGroupType } from './cart-group-type.enum';
import { CartView, CartGroupView, CartItemView, SelectedOptionValueView } from './cart-view.interface';
import { PricingUnit } from '../products/pricing-unit.enum';

/**
 * Pure computation from a fully-loaded Cart (groups -> items ->
 * product/selectedOptionValues already populated by the caller — see
 * CartService.loadCartWithRelations). Every catalog price is derived
 * here from `product.priceMinor`/`optionValue.priceDeltaMinor` —
 * unchanged principle from Phase 2D. An AD_HOC_SERVICE group/item is
 * never assigned a number here — see cart-view.interface.ts.
 */
@Injectable()
export class CartPricingService {
  buildCartView(cart: Cart, vendorNameByBranchId: Map<string, string>): CartView {
    const groups: CartGroupView[] = cart.groups.map((group) =>
      this.buildGroupView(group, vendorNameByBranchId),
    );

    const catalogGroups = groups.filter((g) => g.groupType === CartGroupType.CATALOG);
    const subtotalMinor = catalogGroups.reduce((sum, g) => sum + (g.subtotalMinor ?? 0), 0);
    const hasUnpricedItems = groups.some((g) => g.groupType === CartGroupType.AD_HOC_SERVICE);

    const totalItemCount = groups.reduce((sum, g) => sum + g.items.length, 0);
    const allCatalogItemsAvailable = groups
      .flatMap((g) => g.items)
      .filter((item) => item.productId !== null)
      .every((item) => item.isAvailable);

    // CONFIRMED BUSINESS DECISION: Hatly has no minimum-order
    // requirement — removed entirely, not just relaxed. readyForCheckout
    // no longer depends on any minimum-order term.
    const readyForCheckout = totalItemCount > 0 && allCatalogItemsAvailable && !hasUnpricedItems;

    return {
      id: cart.id,
      fulfillmentType: cart.fulfillmentType,
      orderNote: cart.orderNote ?? null,
      groups,
      subtotalMinor,
      hasUnpricedItems,
      readyForCheckout,
    };
  }

  private buildGroupView(group: CartVendorGroup, vendorNameByBranchId: Map<string, string>): CartGroupView {
    const items = group.items.map((item) => this.buildItemView(item));

    if (group.groupType === CartGroupType.AD_HOC_SERVICE) {
      return {
        id: group.id,
        groupType: group.groupType,
        vendorBranchId: null,
        vendorName: null,
        adHocPlaceName: group.adHocPlaceName ?? null,
        adHocServiceType: group.adHocServiceType ?? null,
        adHocPickupLatitude: group.adHocPickupLatitude ?? null,
        adHocPickupLongitude: group.adHocPickupLongitude ?? null,
        adHocDestinationLatitude: group.adHocDestinationLatitude ?? null,
        adHocDestinationLongitude: group.adHocDestinationLongitude ?? null,
        vendorNote: group.vendorNote ?? null,
        items,
        subtotalMinor: null,
        hasSubtotalDiscountOffer: false,
      };
    }

    const subtotalMinor = items.reduce((sum, item) => sum + (item.lineTotalMinor ?? 0), 0);

    return {
      id: group.id,
      groupType: group.groupType,
      vendorBranchId: group.vendorBranchId ?? null,
      vendorName: group.vendorBranchId ? vendorNameByBranchId.get(group.vendorBranchId) ?? null : null,
      adHocPlaceName: null,
      adHocServiceType: null,
      adHocPickupLatitude: null,
      adHocPickupLongitude: null,
      adHocDestinationLatitude: null,
      adHocDestinationLongitude: null,
      vendorNote: group.vendorNote ?? null,
      items,
      subtotalMinor,
      hasSubtotalDiscountOffer: false,
    };
  }

  private buildItemView(item: CartItem): CartItemView {
    // AD_HOC_SERVICE item: no product, no price, ever.
    if (!item.product) {
      return {
        id: item.id,
        productId: null,
        productName: null,
        productNameAr: null,
        productImageUrl: null,
        quantity: item.quantity,
        pricingUnit: null,
        requestedWeightGrams: null,
        inventoryMode: null,
        availableQuantity: null,
        notes: item.notes ?? null,
        selectedOptionValues: [],
        unitPriceMinor: null,
        lineTotalMinor: null,
        isAvailable: true,
        freeTextDescription: item.freeTextDescription ?? null,
        imageUrls: item.imageUrls ?? [],
        offerId: null,
        offerDiscountType: null,
        offerDiscountValue: null,
        offerDiscountedQuantity: null,
        offerDiscountAmountMinor: null,
        payableLineTotalMinor: null,
        offerMechanism: null,
        specialPriceMinor: null,
      };
    }

    const selectedOptionValues: SelectedOptionValueView[] = (item.selectedOptionValues ?? []).map(
      (sov) => ({
        id: sov.optionValue.id,
        name: sov.optionValue.name,
        nameAr: sov.optionValue.nameAr ?? null,
        priceDeltaMinor: sov.optionValue.priceDeltaMinor,
      }),
    );

    const optionDeltaSum = selectedOptionValues.reduce((sum, v) => sum + v.priceDeltaMinor, 0);
    const unitPriceMinor = item.product.priceMinor + optionDeltaSum;

    // PHASE G addition (Weighted Products). CONFIRMED: never overload
    // `quantity` to mean grams. For a WEIGHT product, `unitPriceMinor`
    // is the price PER KILOGRAM and the line total is derived from
    // `requestedWeightGrams` instead of `quantity` (which CartService
    // fixes at 1 for a WEIGHT item — see its own comment). For PIECE,
    // unchanged: quantity * unitPrice.
    const isWeighted = item.product.pricingUnit === PricingUnit.WEIGHT;
    const lineTotalMinor = isWeighted
      ? Math.round((unitPriceMinor * (item.requestedWeightGrams ?? 0)) / 1000)
      : unitPriceMinor * item.quantity;

    return {
      id: item.id,
      productId: item.productId ?? null,
      productName: item.product.name,
      productNameAr: item.product.nameAr ?? null,
      productImageUrl: item.product.imageUrl ?? null,
      quantity: item.quantity,
      pricingUnit: item.product.pricingUnit,
      requestedWeightGrams: isWeighted ? item.requestedWeightGrams ?? null : null,
      inventoryMode: item.product.inventoryMode,
      availableQuantity: item.product.quantity ?? null,
      notes: item.notes ?? null,
      selectedOptionValues,
      unitPriceMinor,
      lineTotalMinor,
      isAvailable: item.product.isAvailable && !item.product.deletedAt,
      freeTextDescription: null,
      imageUrls: [],
      // PHASE G addition (Offers & Promotions). Populated afterward by
      // CartService.buildView's offer-preview step, never computed
      // here — CartPricingService.buildCartView stays a pure, DB-free
      // function (OrderCreationService also calls it directly and must
      // never trigger an Offer lookup as a side effect of pricing).
      offerId: null,
      offerDiscountType: null,
      offerDiscountValue: null,
      offerDiscountedQuantity: null,
      offerDiscountAmountMinor: null,
      payableLineTotalMinor: isWeighted ? null : lineTotalMinor,
      offerMechanism: null,
      specialPriceMinor: null,
    };
  }
}
