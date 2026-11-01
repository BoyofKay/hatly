import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/sectors/data/sectors_api.dart';
import 'package:hatly_customer/features/sectors/data/sectors_providers.dart';
import 'package:hatly_customer/features/sectors/domain/subcategory.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';
import 'package:hatly_customer/features/vendors/data/vendor_repository.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_details.dart';
import 'package:hatly_customer/features/vendors/presentation/vendor_list_screen.dart';

import '../../support/test_app.dart';

/// Filters V1 — the Vendor List screen's own filter-sheet integration:
/// opening it, Apply triggering the correct real query, Cancel leaving
/// the active query untouched, the active-count badge, and
/// interaction with the pre-existing subcategory/search/sort state.
class _FakeSectorsApi implements SectorsApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<MarketplaceSubcategory>> getSubcategories(
          String sectorId) async =>
      const [];
}

class _FakeVendorRepository implements VendorRepository {
  final calls =
      <({bool? openNow, bool? hasOffers, double? minRating, String? sort})>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Vendor>> getVendors({String? category}) async => const [];

  @override
  Future<VendorDetails> getVendorDetails(String vendorId) =>
      throw UnimplementedError();

  @override
  Future<VendorListPage> getVendorsPage(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
    String? deliveryZoneId,
    String? subcategoryId,
    bool? openNow,
    bool? hasOffers,
    double? minRating,
  }) async {
    calls.add((
      openNow: openNow,
      hasOffers: hasOffers,
      minRating: minRating,
      sort: sort
    ));
    final data = [_vendor('v1')];
    return VendorListPage(
        data: data, page: 1, limit: limit, total: data.length);
  }
}

Vendor _vendor(String id) => Vendor(
    id: id,
    name: id,
    category: '',
    ratingAverage: 0,
    ratingCount: 0,
    etaMinMinutes: 0,
    etaMaxMinutes: 0,
    deliveryFeeMinor: 0,
    isOpen: true);

Future<_FakeVendorRepository> _pump(WidgetTester tester) async {
  final repo = _FakeVendorRepository();
  await tester.pumpWidget(hatlyTestApp(
    const VendorListScreen(category: 'sector-1', categoryName: 'Restaurants'),
    locale: const Locale('en'),
    overrides: [
      vendorRepositoryProvider.overrideWithValue(repo),
      sectorsApiProvider.overrideWithValue(_FakeSectorsApi()),
      homeActiveAddressProvider.overrideWithValue(const AsyncValue.data(null)),
    ],
  ));
  await tester.pumpAndSettle();
  return repo;
}

void main() {
  testWidgets('the filter button starts with no active-count badge',
      (tester) async {
    await _pump(tester);
    expect(
        find.text('1'), findsNothing); // no badge digit rendered anywhere yet
  });

  testWidgets(
      'applying Open Now + Offers + Rating re-queries with all three params and shows the badge count',
      (tester) async {
    final repo = await _pump(tester);
    expect(repo.calls, hasLength(1)); // initial unfiltered load

    await tester.tap(find.byKey(const Key('vendor-filter-action')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-open-now')));
    await tester.tap(find.byKey(const Key('vendor-filter-has-offers')));
    await tester.tap(find.byKey(const Key('vendor-filter-rating-4')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();

    expect(repo.calls.last.openNow, isTrue);
    expect(repo.calls.last.hasOffers, isTrue);
    expect(repo.calls.last.minRating, 4);
    expect(find.text('3'),
        findsOneWidget); // real active-filter count, not decorative
  });

  testWidgets(
      'Cancel never re-queries and never changes the active filter state',
      (tester) async {
    final repo = await _pump(tester);
    final callsBefore = repo.calls.length;

    await tester.tap(find.byKey(const Key('vendor-filter-action')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-open-now')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-cancel')));
    await tester.pumpAndSettle();

    expect(repo.calls.length, callsBefore); // no new query fired
    expect(find.text('1'), findsNothing); // badge still shows nothing active
  });

  testWidgets(
      'clearing filters after applying restores the default unfiltered listing',
      (tester) async {
    final repo = await _pump(tester);

    await tester.tap(find.byKey(const Key('vendor-filter-action')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-open-now')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(repo.calls.last.openNow, isTrue);

    await tester.tap(find.byKey(const Key('vendor-filter-action')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('vendor-filter-clear-all')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();

    expect(repo.calls.last.openNow, isFalse);
    expect(repo.calls.last.hasOffers, isFalse);
    expect(repo.calls.last.minRating, isNull);
  });

  testWidgets('selecting sort=Offers sends sort=offers to the real query',
      (tester) async {
    final repo = await _pump(tester);

    await tester.tap(find.byIcon(Icons.sort_rounded));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Offers').last);
    await tester.pumpAndSettle();

    expect(repo.calls.last.sort, 'offers');
  });
}
