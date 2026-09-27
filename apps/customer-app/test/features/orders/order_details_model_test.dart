import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';

/// Vendor/Driver Deferred Pricing (Chunk 6 wiring). Pure JSON-parsing
/// tests for `OrderItemDetails.actualAmountMinor`, mirroring
/// cart_model_test.dart's own established convention (no
/// network/mocking library exists in this project — hand-built maps
/// shaped like the real backend response, parsed directly).
void main() {
  Map<String, dynamic> baseItemJson(
      {int? actualAmountMinor, String? productId, int? unitPriceMinor}) {
    return {
      'id': 'item-1',
      'productId': productId,
      'productNameSnapshot': productId != null ? 'Burger' : null,
      'productImageUrlSnapshot': null,
      'quantity': 1,
      'unitPriceMinor': unitPriceMinor,
      'optionsSnapshot': [],
      'notes': null,
      'pricingUnitSnapshot': null,
      'requestedWeightGrams': null,
      'actualWeightGrams': null,
      'estimatedAmountMinor': null,
      'finalAmountMinor': null,
      'freeTextDescriptionSnapshot':
          productId == null ? 'Panadol Extra 500mg' : null,
      'imageUrlsSnapshot': null,
      'offerMechanismSnapshot': null,
      'offerSpecialPriceMinorSnapshot': null,
      'actualAmountMinor': actualAmountMinor,
    };
  }

  group('OrderItemDetails.fromJson — actualAmountMinor', () {
    test(
        'A: JSON with actualAmountMinor: 12500 parses to model.actualAmountMinor == 12500',
        () {
      final item = OrderItemDetails.fromJson(
          baseItemJson(productId: null, actualAmountMinor: 12500));
      expect(item.actualAmountMinor, 12500);
    });

    test(
        'B: JSON with actualAmountMinor: null parses to model.actualAmountMinor == null',
        () {
      final item = OrderItemDetails.fromJson(
          baseItemJson(productId: null, actualAmountMinor: null));
      expect(item.actualAmountMinor, isNull);
    });

    test(
        'C (model-level): a priced Custom Request (productId null, actualAmountMinor set) has displayAmountMinor null but actualAmountMinor set — the screen\'s own gate (productId == null && actualAmountMinor != null) is exactly what makes the final amount show instead of "pending"',
        () {
      final item = OrderItemDetails.fromJson(baseItemJson(
          productId: null, unitPriceMinor: null, actualAmountMinor: 12500));
      expect(item.productId, isNull);
      expect(item.displayAmountMinor,
          isNull); // unchanged — never derived from unitPriceMinor
      expect(item.actualAmountMinor, 12500);
    });

    test(
        'D (model-level): an unpriced Custom Request (productId null, actualAmountMinor null) keeps both null, so the screen falls through to the pending-price branch',
        () {
      final item = OrderItemDetails.fromJson(baseItemJson(
          productId: null, unitPriceMinor: null, actualAmountMinor: null));
      expect(item.productId, isNull);
      expect(item.displayAmountMinor, isNull);
      expect(item.actualAmountMinor, isNull);
    });

    test(
        'a normal catalog item is unaffected: displayAmountMinor still comes from unitPriceMinor, actualAmountMinor is null',
        () {
      final item = OrderItemDetails.fromJson(baseItemJson(
          productId: 'product-1',
          unitPriceMinor: 1000,
          actualAmountMinor: null));
      expect(item.displayAmountMinor, 1000); // unitPriceMinor * quantity(1)
      expect(item.actualAmountMinor, isNull);
    });
  });
}
