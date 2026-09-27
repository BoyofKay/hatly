import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/search/data/explore_logic.dart';
import 'package:hatly_customer/features/search/data/explore_providers.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';
import 'package:hatly_customer/features/vendors/data/vendor_repository.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/domain/vendor_details.dart';

MarketplaceSector _s(String id, String name, String nameAr, String slug,
        [int order = 0]) =>
    MarketplaceSector(
        id: id, name: name, nameAr: nameAr, slug: slug, sortOrder: order);

Vendor _v(String id) => Vendor(
    id: id,
    name: 'V$id',
    category: '',
    ratingAverage: 0,
    ratingCount: 0,
    etaMinMinutes: 0,
    etaMaxMinutes: 0,
    deliveryFeeMinor: 0,
    isOpen: true);

class _Repo implements VendorRepository {
  final calls = <({String sectorId, String? sort, int limit, double? lat})>[];
  final Map<String, List<Vendor>> bySector;
  final Set<String> failing;
  _Repo(this.bySector, {this.failing = const {}});

  @override
  Future<VendorListPage> getVendorsPage(String sectorId,
      {String? sort,
      String? search,
      int page = 1,
      int limit = 20,
      double? latitude,
      double? longitude}) async {
    calls.add((sectorId: sectorId, sort: sort, limit: limit, lat: latitude));
    if (failing.contains(sectorId)) throw Exception('boom');
    final data = bySector[sectorId] ?? const <Vendor>[];
    return VendorListPage(
        data: data, page: 1, limit: limit, total: data.length);
  }

  @override
  Future<List<Vendor>> getVendors({String? category}) async => const [];

  @override
  Future<VendorDetails> getVendorDetails(String vendorId) =>
      throw UnimplementedError();
}

void main() {
  group('matchCategories (local category search)', () {
    final cats = [
      _s('1', 'Restaurants', 'مطاعم', 'restaurants'),
      _s('2', 'Groceries', 'بقالة', 'groceries'),
      _s('3', 'Pharmacy', 'صيدليات', 'pharmacy'),
    ];

    test('matches the Arabic name, case-insensitively for English', () {
      expect(matchCategories('مطا', cats).map((c) => c.id), ['1']);
      expect(matchCategories('GROC', cats).map((c) => c.id), ['2']);
      expect(matchCategories('  pharm ', cats).map((c) => c.id), ['3']);
    });

    test('needs the same 2-character minimum as the backend search', () {
      expect(matchCategories('م', cats), isEmpty);
      expect(matchCategories('', cats), isEmpty);
    });

    test(
        'keeps the existing order (both contain "es"); no match → empty; never fabricates',
        () {
      expect(matchCategories('e', cats), isEmpty); // 1 char
      expect(matchCategories('es', cats).map((c) => c.id), ['1', '2']);
      expect(matchCategories('zzzz', cats), isEmpty);
    });
  });

  group('featuredCategories (no popularity metric — existing order only)', () {
    List<MarketplaceSector> many(int n) =>
        [for (var i = 0; i < n; i++) _s('$i', 'C$i', 'ف$i', 's$i', i)];

    test('is the first N of the existing order', () {
      expect(featuredCategories(many(12)).map((c) => c.id),
          ['0', '1', '2', '3', '4', '5']);
    });

    test('pinned slugs come first, then existing order, capped', () {
      final out = featuredCategories(many(12),
          pinnedSlugs: const ['s9', 's3'], count: 4);
      expect(out.map((c) => c.id), ['9', '3', '0', '1']);
    });

    test('an unknown pinned slug is ignored', () {
      expect(
          featuredCategories(many(8), pinnedSlugs: const ['nope'], count: 2)
              .map((c) => c.id),
          ['0', '1']);
    });

    test('hidden when Shop by Category already fits in one short row', () {
      expect(featuredCategories(many(3)), isEmpty);
      expect(featuredCategories(many(4)), isNotEmpty);
    });
  });

  group('interleaveNewestVendors', () {
    test('takes each sector\'s newest in turn, keeps per-sector order', () {
      final out = interleaveNewestVendors([
        [_v('a1'), _v('a2'), _v('a3')],
        [_v('b1'), _v('b2')],
      ], max: 5);
      expect(out.map((v) => v.id), ['a1', 'b1', 'a2', 'b2', 'a3']);
    });

    test('drops duplicates, respects max, tolerates empty sectors', () {
      final out = interleaveNewestVendors([
        [_v('x'), _v('y')],
        <Vendor>[],
        [_v('x'), _v('z')],
      ], max: 3);
      expect(out.map((v) => v.id), ['x', 'y', 'z']);
      expect(interleaveNewestVendors(const []), isEmpty);
    });
  });

  group('exploreNewVendorsProvider (existing newest listing + fan-out)', () {
    ProviderContainer make(_Repo repo, List<MarketplaceSector> sectors) {
      final c = ProviderContainer(overrides: [
        vendorRepositoryProvider.overrideWithValue(repo),
        homeCategoriesProvider.overrideWith((ref) async => sectors),
        homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
        homeDemoEnabledProvider.overrideWithValue(false),
      ]);
      addTearDown(c.dispose);
      return c;
    }

    final sectors = [
      for (var i = 0; i < 5; i++) _s('s$i', 'S$i', 'ق$i', 'slug$i', i)
    ];

    test(
        'asks the existing listing for sort=newest on the first 3 sectors only',
        () async {
      final repo = _Repo({
        's0': [_v('a')],
        's1': [_v('b')],
        's2': [_v('c')],
        's3': [_v('never')],
      });
      final out =
          await make(repo, sectors).read(exploreNewVendorsProvider.future);
      expect(out.map((v) => v.id), ['a', 'b', 'c']);
      expect(repo.calls.map((c) => c.sectorId), ['s0', 's1', 's2']);
      expect(repo.calls.every((c) => c.sort == 'newest'), isTrue);
    });

    test('one failing sector only removes its own vendors', () async {
      final repo = _Repo({
        's0': [_v('a')],
        's2': [_v('c')],
      }, failing: {
        's1'
      });
      final out =
          await make(repo, sectors).read(exploreNewVendorsProvider.future);
      expect(out.map((v) => v.id), ['a', 'c']);
    });

    test('real data empty and demo OFF → empty (nothing is invented)',
        () async {
      final out =
          await make(_Repo({}), sectors).read(exploreNewVendorsProvider.future);
      expect(out, isEmpty);
    });
  });
}
