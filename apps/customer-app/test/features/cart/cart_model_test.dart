import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';

/// CONFIRMED (Cart & Checkout Stabilization): these are the first
/// Flutter tests in this project. Pure JSON-parsing tests — no
/// network/mocking library exists in this project's dev_dependencies
/// (only `flutter_test`), so these exercise `Cart.fromJson` /
/// `CartGroup.fromJson` / `CartItem.fromJson` directly against
/// hand-built maps shaped exactly like the real backend
/// `cart-view.interface.ts` response — the same shape the old,
/// flat-`items` model failed to parse at all.
void main() {
  group('Cart.fromJson — multi-group / multi-vendor', () {
    test('parses a cart with multiple CATALOG groups from different vendors',
        () {
      final json = {
        'id': 'cart-1',
        'fulfillmentType': 'DELIVERY',
        'orderNote': null,
        'subtotalMinor': 3000,
        'hasUnpricedItems': false,
        'readyForCheckout': true,
        'groups': [
          {
            'id': 'group-a',
            'groupType': 'CATALOG',
            'vendorBranchId': 'branch-a',
            'vendorName': 'Pizza House',
            'adHocPlaceName': null,
            'adHocServiceType': null,
            'adHocPickupLatitude': null,
            'adHocPickupLongitude': null,
            'adHocDestinationLatitude': null,
            'adHocDestinationLongitude': null,
            'vendorNote': null,
            'subtotalMinor': 1000,
            'items': [_pieceItemJson(id: 'item-a1')],
          },
          {
            'id': 'group-b',
            'groupType': 'CATALOG',
            'vendorBranchId': 'branch-b',
            'vendorName': 'Burger Place',
            'adHocPlaceName': null,
            'adHocServiceType': null,
            'adHocPickupLatitude': null,
            'adHocPickupLongitude': null,
            'adHocDestinationLatitude': null,
            'adHocDestinationLongitude': null,
            'vendorNote': null,
            'subtotalMinor': 2000,
            'items': [_pieceItemJson(id: 'item-b1')],
          },
        ],
      };

      final cart = Cart.fromJson(json);

      expect(cart.groups, hasLength(2));
      expect(cart.groups[0].vendorName, 'Pizza House');
      expect(cart.groups[1].vendorName, 'Burger Place');
      // Multi-vendor isolation: each group's items never leak into the other.
      expect(cart.groups[0].items.map((i) => i.id), ['item-a1']);
      expect(cart.groups[1].items.map((i) => i.id), ['item-b1']);
      expect(cart.subtotalMinor, 3000);
      expect(cart.readyForCheckout, true);
    });

    test(
        'parses an AD_HOC_SERVICE group with a null subtotal — never fabricated as 0',
        () {
      final json = _baseCart(groups: [
        {
          'id': 'group-adhoc',
          'groupType': 'AD_HOC_SERVICE',
          'vendorBranchId': null,
          'vendorName': null,
          'adHocPlaceName': "Ali's Pharmacy",
          'adHocServiceType': 'BUY_FROM_PLACE',
          'adHocPickupLatitude': 30.1,
          'adHocPickupLongitude': 31.2,
          'adHocDestinationLatitude': null,
          'adHocDestinationLongitude': null,
          'vendorNote': null,
          'subtotalMinor': null,
          'items': [
            {
              'id': 'item-adhoc',
              'productId': null,
              'productName': null,
              'productNameAr': null,
              'productImageUrl': null,
              'quantity': 1,
              'pricingUnit': null,
              'requestedWeightGrams': null,
              'notes': null,
              'selectedOptionValues': [],
              'unitPriceMinor': null,
              'lineTotalMinor': null,
              'isAvailable': true,
              'freeTextDescription': 'A box of tissues',
              'imageUrls': ['https://hatly-uploads.example/img1.jpg'],
              'offerId': null,
              'offerDiscountType': null,
              'offerDiscountValue': null,
              'offerDiscountedQuantity': null,
              'offerDiscountAmountMinor': null,
              'payableLineTotalMinor': null,
            },
          ],
        },
      ], hasUnpricedItems: true);

      final cart = Cart.fromJson(json);

      expect(cart.hasUnpricedItems, true);
      final group = cart.groups.single;
      expect(group.isAdHocService, true);
      expect(group.subtotalMinor, isNull); // never 0
      expect(group.adHocPlaceName, "Ali's Pharmacy");
      final item = group.items.single;
      expect(item.isAdHoc, true);
      expect(item.freeTextDescription, 'A box of tissues');
      expect(item.imageUrls, ['https://hatly-uploads.example/img1.jpg']);
    });
  });

  group('CartItem.fromJson — PIECE vs WEIGHT', () {
    test(
        'parses a PIECE item — pricingUnit and requestedWeightGrams as expected',
        () {
      final item = CartItem.fromJson(_pieceItemJson(id: 'p1'));
      expect(item.pricingUnit, 'PIECE');
      expect(item.isWeighted, false);
      expect(item.requestedWeightGrams, isNull);
    });

    test(
        'parses a WEIGHT item — requestedWeightGrams and per-kg unitPriceMinor preserved exactly',
        () {
      final item = CartItem.fromJson({
        'id': 'w1',
        'productId': 'product-1',
        'productName': 'Chicken Breast',
        'productNameAr': null,
        'productImageUrl': null,
        'quantity': 1,
        'pricingUnit': 'WEIGHT',
        'requestedWeightGrams': 1150,
        'notes': null,
        'selectedOptionValues': [],
        'unitPriceMinor': 20000, // 200 EGP/kg
        'lineTotalMinor': 23000, // 200 * 1.15kg
        'isAvailable': true,
        'freeTextDescription': null,
        'imageUrls': [],
        'offerId': null,
        'offerDiscountType': null,
        'offerDiscountValue': null,
        'offerDiscountedQuantity': null,
        'offerDiscountAmountMinor': null,
        'payableLineTotalMinor': null,
      });

      expect(item.isWeighted, true);
      expect(item.requestedWeightGrams, 1150);
      expect(item.unitPriceMinor, 20000);
      expect(item.lineTotalMinor, 23000);
      // CONFIRMED: Flutter never recomputes this — it's read verbatim.
    });
  });

  group('CartItem.fromJson — Offers preview', () {
    test('parses the complete Offer preview field set, display-only', () {
      final item = CartItem.fromJson({
        ..._pieceItemJson(id: 'offer-item'),
        'offerId': 'offer-1',
        'offerDiscountType': 'PERCENTAGE',
        'offerDiscountValue': 2000,
        'offerDiscountedQuantity': 1,
        'offerDiscountAmountMinor': 200,
        'payableLineTotalMinor': 800,
      });

      expect(item.hasOfferPreview, true);
      expect(item.offerDiscountType, 'PERCENTAGE');
      expect(item.offerDiscountAmountMinor, 200);
      expect(item.payableLineTotalMinor, 800);
      // Flutter shows these verbatim — no discount is computed here.
    });

    test('a plain item with no offer has all Offer fields null', () {
      final item = CartItem.fromJson(_pieceItemJson(id: 'plain'));
      expect(item.hasOfferPreview, false);
      expect(item.offerDiscountAmountMinor, isNull);
      expect(item.payableLineTotalMinor, isNull);
    });
  });

  group('Cart.fromJson — readiness flags', () {
    test(
        'readyForCheckout and hasUnpricedItems are read verbatim from the backend, never recomputed',
        () {
      final readyCart = Cart.fromJson(
          _baseCart(readyForCheckout: true, hasUnpricedItems: false));
      expect(readyCart.readyForCheckout, true);
      expect(readyCart.hasUnpricedItems, false);

      final notReadyCart = Cart.fromJson(
          _baseCart(readyForCheckout: false, hasUnpricedItems: true));
      expect(notReadyCart.readyForCheckout, false);
      expect(notReadyCart.hasUnpricedItems, true);
    });
  });
}

Map<String, dynamic> _pieceItemJson({required String id}) {
  return {
    'id': id,
    'productId': 'product-1',
    'productName': 'Burger',
    'productNameAr': null,
    'productImageUrl': null,
    'quantity': 2,
    'pricingUnit': 'PIECE',
    'requestedWeightGrams': null,
    'notes': null,
    'selectedOptionValues': [],
    'unitPriceMinor': 1000,
    'lineTotalMinor': 2000,
    'isAvailable': true,
    'freeTextDescription': null,
    'imageUrls': [],
    'offerId': null,
    'offerDiscountType': null,
    'offerDiscountValue': null,
    'offerDiscountedQuantity': null,
    'offerDiscountAmountMinor': null,
    'payableLineTotalMinor': null,
  };
}

Map<String, dynamic> _baseCart({
  List<Map<String, dynamic>>? groups,
  bool readyForCheckout = true,
  bool hasUnpricedItems = false,
}) {
  return {
    'id': 'cart-1',
    'fulfillmentType': 'DELIVERY',
    'orderNote': null,
    'subtotalMinor': 2000,
    'hasUnpricedItems': hasUnpricedItems,
    'readyForCheckout': readyForCheckout,
    'groups': groups ?? [],
  };
}
