import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/sectors/data/sectors_api.dart';
import 'package:hatly_customer/features/sectors/data/sectors_providers.dart';
import 'package:hatly_customer/features/sectors/domain/subcategory.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';
import 'package:hatly_customer/features/vendors/data/vendor_repository.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/presentation/vendor_list_screen.dart';

import '../../support/test_app.dart';

/// A MANUAL address has no coordinates, only a delivery zone: the vendor listing must be narrowed by that zone (the server filters by the
/// zone's service area). A GPS address keeps sending its coordinates; no address sends neither.
class _FakeSectorsApi implements SectorsApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<MarketplaceSubcategory>> getSubcategories(String sectorId) async => const [];
}

class _Repo implements VendorRepository {
  final calls = <({double? lat, double? lng, String? zone})>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

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
    calls.add((lat: latitude, lng: longitude, zone: deliveryZoneId));
    return VendorListPage(data: const <Vendor>[], page: 1, limit: limit, total: 0);
  }
}

Future<_Repo> _pump(WidgetTester tester, SavedAddress? address) async {
  final repo = _Repo();
  await tester.pumpWidget(hatlyTestApp(
    const VendorListScreen(category: 'sector-1', categoryName: 'Restaurants'),
    locale: const Locale('en'),
    overrides: [
      vendorRepositoryProvider.overrideWithValue(repo),
      sectorsApiProvider.overrideWithValue(_FakeSectorsApi()),
      homeActiveAddressProvider.overrideWithValue(AsyncValue.data(address)),
    ],
  ));
  await tester.pumpAndSettle();
  return repo;
}

void main() {
  testWidgets('sector page keeps Hatly Service visible even when no stores exist', (tester) async {
    await _pump(tester, null); // Fake sector contains zero vendors.
    expect(find.byKey(const Key('sector-hatly-service-entry')), findsOneWidget);
    expect(find.text('Hatly Service'), findsOneWidget);
  });

  testWidgets('a manual address (zone, no coordinates) sends its delivery zone and no coordinates', (tester) async {
    final repo = await _pump(
      tester,
      const SavedAddress(id: 'a1', mode: AddressMode.manual, line1: 'شارع الجمهورية', deliveryZoneId: 'zone-7'),
    );
    expect(repo.calls.first, (lat: null, lng: null, zone: 'zone-7'));
  });

  testWidgets('a GPS address keeps sending its coordinates', (tester) async {
    final repo = await _pump(
      tester,
      const SavedAddress(id: 'a2', mode: AddressMode.gps, line1: '30.4,31.5', latitude: 30.4, longitude: 31.5),
    );
    expect(repo.calls.first.lat, 30.4);
    expect(repo.calls.first.lng, 31.5);
    expect(repo.calls.first.zone, isNull);
  });

  testWidgets('no address sends neither (the unfiltered pre-existing listing)', (tester) async {
    final repo = await _pump(tester, null);
    expect(repo.calls.first, (lat: null, lng: null, zone: null));
  });
}
