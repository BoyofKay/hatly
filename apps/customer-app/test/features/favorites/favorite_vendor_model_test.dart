import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/favorites/domain/favorite_vendor.dart';

/// Favorites Chunk 2. Pure-function/model tests only — CONFIRMED
/// (mirroring checkout_payment_method_test.dart's own established
/// precedent): no mocking library exists in this project, so
/// FavoritesApi's network calls and FavoritesController's
/// mutation/duplicate-call/error-propagation logic are not
/// independently unit-tested here — that would require either adding
/// a mocking dependency or hand-subclassing a concrete API class,
/// neither of which this project's existing Flutter test suite does
/// anywhere else. This is the same accepted limitation already
/// documented in checkout_payment_method_test.dart, not a new gap
/// introduced by this chunk.
void main() {
  group('FavoriteVendor.fromJson', () {
    test('CRITICAL: parses an active favorited Vendor correctly', () {
      final favorite = FavoriteVendor.fromJson({
        'vendorId': 'vendor-1',
        'name': 'Test Vendor',
        'nameAr': 'تست فيندور',
        'logoUrl': 'https://example.com/logo.png',
        'isActive': true,
        'favoritedAt': '2026-02-01T14:30:00.000Z',
      });

      expect(favorite.vendorId, 'vendor-1');
      expect(favorite.name, 'Test Vendor');
      expect(favorite.nameAr, 'تست فيندور');
      expect(favorite.logoUrl, 'https://example.com/logo.png');
      expect(favorite.isActive, true);
      expect(favorite.favoritedAt, DateTime.parse('2026-02-01T14:30:00.000Z'));
    });

    test(
        'CRITICAL: an inactive favorited Vendor is parsed as isActive: false, never hidden or fabricated as active',
        () {
      final favorite = FavoriteVendor.fromJson({
        'vendorId': 'vendor-2',
        'name': 'Closed Vendor',
        'nameAr': null,
        'logoUrl': null,
        'isActive': false,
        'favoritedAt': '2026-01-15T09:00:00.000Z',
      });

      expect(favorite.isActive, false);
      expect(favorite.nameAr, isNull);
      expect(favorite.logoUrl, isNull);
    });

    test(
        'nullable nameAr/logoUrl parse correctly when absent from the JSON entirely',
        () {
      final favorite = FavoriteVendor.fromJson({
        'vendorId': 'vendor-3',
        'name': 'Minimal Vendor',
        'isActive': true,
        'favoritedAt': '2026-03-01T00:00:00.000Z',
      });

      expect(favorite.nameAr, isNull);
      expect(favorite.logoUrl, isNull);
    });
  });
}
