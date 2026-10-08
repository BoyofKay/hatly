import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_filters.dart';

void main() {
  group('VendorFilters', () {
    test('empty has zero active count and isEmpty true', () {
      expect(VendorFilters.empty.activeCount, 0);
      expect(VendorFilters.empty.isEmpty, isTrue);
    });

    test('activeCount counts each independently active filter', () {
      const filters = VendorFilters(openNow: true, hasOffers: true, minRating: 4);
      expect(filters.activeCount, 3);
      expect(filters.isEmpty, isFalse);
    });

    test('copyWith updates only the given fields', () {
      const base = VendorFilters(openNow: true);
      final updated = base.copyWith(hasOffers: true);
      expect(updated.openNow, isTrue);
      expect(updated.hasOffers, isTrue);
      expect(updated.minRating, isNull);
    });

    test('copyWith accepts a plain int literal for minRating without crashing (real UI call shape)', () {
      // Regression: `copyWith` used to do a bare `minRating as double?`, which
      // throws at runtime for an int literal like `copyWith(minRating: 4)` —
      // exactly how the filter sheet's rating chips call it.
      const base = VendorFilters.empty;
      final updated = base.copyWith(minRating: 4);
      expect(updated.minRating, 4.0);
    });

    test('copyWith can explicitly clear minRating back to null', () {
      const base = VendorFilters(minRating: 4);
      final cleared = base.copyWith(minRating: null);
      expect(cleared.minRating, isNull);
    });

    test('copyWith without touching minRating preserves it', () {
      const base = VendorFilters(minRating: 3);
      final updated = base.copyWith(openNow: true);
      expect(updated.minRating, 3);
    });

    test('equality is value-based', () {
      const a = VendorFilters(openNow: true, minRating: 4);
      const b = VendorFilters(openNow: true, minRating: 4);
      expect(a, equals(b));
    });
  });
}
