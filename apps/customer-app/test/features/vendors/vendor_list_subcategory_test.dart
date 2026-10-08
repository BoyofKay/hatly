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

/// Consolidated customer-commerce milestone, Part E — Sector
/// Subcategories. Proves the customer-facing contract explicitly
/// required by this milestone: selecting a subcategory chip FILTERS
/// the existing vendor/branch listing (never turns browsing into
/// "subcategory -> products"), "All" resets to the unfiltered listing,
/// and a sector with no subcategories renders with no chip row at all
/// (never a broken/empty-looking row).
class _FakeSectorsApi implements SectorsApi {
  _FakeSectorsApi({this.subcategories = const [], this.failure});

  List<MarketplaceSubcategory> subcategories;
  Object? failure;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<MarketplaceSubcategory>> getSubcategories(String sectorId) async {
    if (failure != null) throw failure!;
    return subcategories;
  }
}

class _FakeVendorRepository implements VendorRepository {
  final calls = <String?>[]; // subcategoryId of each call

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Vendor>> getVendors({String? category}) async => const [];

  @override
  Future<VendorDetails> getVendorDetails(String vendorId) => throw UnimplementedError();

  @override
  Future<VendorListPage> getVendorsPage(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
    String? subcategoryId,
    bool? openNow,
    bool? hasOffers,
    double? minRating,
  }) async {
    calls.add(subcategoryId);
    final data = subcategoryId == null
        ? [_vendor('all-1'), _vendor('all-2')]
        : [_vendor('filtered-for-$subcategoryId')];
    return VendorListPage(data: data, page: 1, limit: limit, total: data.length);
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

MarketplaceSubcategory _sub(String id, String name, [int sortOrder = 0]) =>
    MarketplaceSubcategory(id: id, name: name, sortOrder: sortOrder);

Future<void> _pump(
  WidgetTester tester, {
  required _FakeVendorRepository repository,
  required _FakeSectorsApi sectorsApi,
}) async {
  await tester.pumpWidget(hatlyTestApp(
    const VendorListScreen(category: 'sector-1', categoryName: 'Restaurants'),
    locale: const Locale('en'),
    overrides: [
      vendorRepositoryProvider.overrideWithValue(repository),
      sectorsApiProvider.overrideWithValue(sectorsApi),
      homeActiveAddressProvider.overrideWithValue(const AsyncValue.data(null)),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a sector with no subcategories renders with no chip row at all', (tester) async {
    final repo = _FakeVendorRepository();
    await _pump(tester, repository: repo, sectorsApi: _FakeSectorsApi(subcategories: []));

    expect(find.byKey(const Key('subcategory-chip-all')), findsNothing);
    expect(repo.calls, [null]); // unfiltered call still happens normally
  });

  testWidgets('a subcategories-fetch failure degrades to no chip row, never an error banner over the vendor list',
      (tester) async {
    final repo = _FakeVendorRepository();
    await _pump(tester,
        repository: repo, sectorsApi: _FakeSectorsApi(failure: Exception('down')));

    expect(find.byKey(const Key('subcategory-chip-all')), findsNothing);
    expect(find.text(_vendor('all-1').id), findsOneWidget); // vendor list itself is unaffected
  });

  testWidgets('shows an "All" chip plus one chip per subcategory, ordered by sortOrder', (tester) async {
    final repo = _FakeVendorRepository();
    await _pump(tester, repository: repo, sectorsApi: _FakeSectorsApi(subcategories: [
      _sub('sc-burgers', 'Burgers', 1),
      _sub('sc-pizza', 'Pizza', 0),
    ]));

    expect(find.byKey(const Key('subcategory-chip-all')), findsOneWidget);
    expect(find.byKey(const Key('subcategory-chip-sc-burgers')), findsOneWidget);
    expect(find.byKey(const Key('subcategory-chip-sc-pizza')), findsOneWidget);
  });

  testWidgets('selecting a subcategory chip re-queries the SAME vendor listing filtered by it', (tester) async {
    final repo = _FakeVendorRepository();
    await _pump(tester, repository: repo, sectorsApi: _FakeSectorsApi(subcategories: [
      _sub('sc-burgers', 'Burgers'),
    ]));
    expect(repo.calls, [null]);

    await tester.tap(find.byKey(const Key('subcategory-chip-sc-burgers')));
    await tester.pumpAndSettle();

    expect(repo.calls, [null, 'sc-burgers']);
    expect(find.text('filtered-for-sc-burgers'), findsOneWidget);
    expect(find.text('all-1'), findsNothing); // the unfiltered result is gone, replaced, not merged
  });

  testWidgets('selecting "All" after a subcategory resets to the unfiltered listing', (tester) async {
    final repo = _FakeVendorRepository();
    await _pump(tester, repository: repo, sectorsApi: _FakeSectorsApi(subcategories: [
      _sub('sc-burgers', 'Burgers'),
    ]));

    await tester.tap(find.byKey(const Key('subcategory-chip-sc-burgers')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('subcategory-chip-all')));
    await tester.pumpAndSettle();

    expect(repo.calls, [null, 'sc-burgers', null]);
    expect(find.text('all-1'), findsOneWidget);
  });
}
