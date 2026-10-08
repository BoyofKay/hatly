import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product_filters.dart';

void main() {
  group('ProductFilters', () {
    test('empty has zero active count and isEmpty true', () {
      expect(ProductFilters.empty.activeCount, 0);
      expect(ProductFilters.empty.isEmpty, isTrue);
    });

    test('a price range (min and/or max) counts as ONE active filter, not two', () {
      const filters = ProductFilters(minPriceMinor: 1000, maxPriceMinor: 5000);
      expect(filters.activeCount, 1);
    });

    test('activeCount counts availableOnly/hasOffers/price range independently', () {
      const filters = ProductFilters(availableOnly: true, hasOffers: true, minPriceMinor: 1000);
      expect(filters.activeCount, 3);
    });

    test('copyWith can explicitly clear a price bound back to null', () {
      const base = ProductFilters(minPriceMinor: 1000, maxPriceMinor: 5000);
      final cleared = base.copyWith(maxPriceMinor: null);
      expect(cleared.minPriceMinor, 1000);
      expect(cleared.maxPriceMinor, isNull);
    });

    test('copyWith without touching price bounds preserves them', () {
      const base = ProductFilters(minPriceMinor: 1000, maxPriceMinor: 5000);
      final updated = base.copyWith(availableOnly: true);
      expect(updated.minPriceMinor, 1000);
      expect(updated.maxPriceMinor, 5000);
    });

    test('equality is value-based', () {
      const a = ProductFilters(availableOnly: true, minPriceMinor: 500);
      const b = ProductFilters(availableOnly: true, minPriceMinor: 500);
      expect(a, equals(b));
    });
  });
}
