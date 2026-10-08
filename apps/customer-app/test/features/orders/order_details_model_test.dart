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

  // Standalone Hatly Service (AD_HOC_SERVICE). These 6 fields are newly
  // exposed by the backend (customer-orders.service.ts) — CONFIRMED read
  // directly from the frozen OrderVendorSegment snapshot columns, never
  // re-derived from a live cart group.
  Map<String, dynamic> baseSegmentJson({
    String groupType = 'AD_HOC_SERVICE',
    String? adHocPlaceNameSnapshot,
    String? adHocServiceTypeSnapshot,
    double? pickupLat,
    double? pickupLng,
    double? destLat,
    double? destLng,
  }) {
    return {
      'id': 'segment-1',
      'groupType': groupType,
      'vendorBranchId': null,
      'vendorBranchName': null,
      'status': 'PENDING',
      'subtotalMinor': null,
      'items': <dynamic>[],
      'adHocPlaceNameSnapshot': adHocPlaceNameSnapshot,
      'adHocServiceTypeSnapshot': adHocServiceTypeSnapshot,
      'adHocPickupLatitudeSnapshot': pickupLat,
      'adHocPickupLongitudeSnapshot': pickupLng,
      'adHocDestinationLatitudeSnapshot': destLat,
      'adHocDestinationLongitudeSnapshot': destLng,
    };
  }

  group('OrderSegmentDetails.fromJson — AD_HOC_SERVICE snapshot fields', () {
    test(
        'a BUY_FROM_PLACE segment with a pickup override parses place name, type and pickup coordinates; destination stays null',
        () {
      final segment = OrderSegmentDetails.fromJson(baseSegmentJson(
        adHocPlaceNameSnapshot: "Ali's Pharmacy",
        adHocServiceTypeSnapshot: 'BUY_FROM_PLACE',
        pickupLat: 30.1,
        pickupLng: 31.2,
      ));
      expect(segment.isAdHocService, isTrue);
      expect(segment.adHocPlaceNameSnapshot, "Ali's Pharmacy");
      expect(segment.adHocServiceTypeSnapshot, 'BUY_FROM_PLACE');
      expect(segment.adHocPickupLatitudeSnapshot, 30.1);
      expect(segment.adHocPickupLongitudeSnapshot, 31.2);
      expect(segment.adHocDestinationLatitudeSnapshot, isNull);
      expect(segment.adHocDestinationLongitudeSnapshot, isNull);
    });

    test(
        'a DELIVER_TO_PLACE segment with a destination override parses destination coordinates; pickup stays null',
        () {
      final segment = OrderSegmentDetails.fromJson(baseSegmentJson(
        adHocPlaceNameSnapshot: "Mom's house",
        adHocServiceTypeSnapshot: 'DELIVER_TO_PLACE',
        destLat: 30.3,
        destLng: 31.4,
      ));
      expect(segment.adHocServiceTypeSnapshot, 'DELIVER_TO_PLACE');
      expect(segment.adHocPickupLatitudeSnapshot, isNull);
      expect(segment.adHocPickupLongitudeSnapshot, isNull);
      expect(segment.adHocDestinationLatitudeSnapshot, 30.3);
      expect(segment.adHocDestinationLongitudeSnapshot, 31.4);
    });

    test('a CATALOG segment leaves every ad-hoc field null; isAdHocService is false',
        () {
      final segment = OrderSegmentDetails.fromJson(
          baseSegmentJson(groupType: 'CATALOG'));
      expect(segment.isAdHocService, isFalse);
      expect(segment.adHocPlaceNameSnapshot, isNull);
      expect(segment.adHocServiceTypeSnapshot, isNull);
      expect(segment.adHocPickupLatitudeSnapshot, isNull);
      expect(segment.adHocDestinationLatitudeSnapshot, isNull);
    });

    test(
        'no override supplied at all (defaults will apply server-side): every coordinate field is null, place name and type still parse',
        () {
      final segment = OrderSegmentDetails.fromJson(baseSegmentJson(
        adHocPlaceNameSnapshot: 'Carrefour',
        adHocServiceTypeSnapshot: 'BUY_FROM_PLACE',
      ));
      expect(segment.adHocPlaceNameSnapshot, 'Carrefour');
      expect(segment.adHocPickupLatitudeSnapshot, isNull);
      expect(segment.adHocPickupLongitudeSnapshot, isNull);
      expect(segment.adHocDestinationLatitudeSnapshot, isNull);
      expect(segment.adHocDestinationLongitudeSnapshot, isNull);
    });
  });
}
