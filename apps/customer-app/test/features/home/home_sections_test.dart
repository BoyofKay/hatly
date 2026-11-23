import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/presentation/home_section_products_screen.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_promo_actions.dart';
import 'package:hatly_customer/features/home/presentation/widgets/promo_carousel.dart';
import 'package:hatly_customer/features/products/data/product_repository.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_category.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';

import '../../support/router_test_app.dart';

final _now = DateTime.utc(2026, 10, 14, 12);

Product _p(String id,
        {int delivered = 0,
        int deliveredGrams = 0,
        DateTime? created,
        ActiveOffer? offer,
        String name = ''}) =>
    Product(
      id: id,
      vendorBranchId: 'b',
      categoryId: 'c',
      name: name.isEmpty ? 'P $id' : name,
      nameAr: name.isEmpty ? 'منتج $id' : name,
      priceMinor: 11000,
      isAvailable: true,
      activeOffer: offer,
      deliveredQuantityCount: delivered,
      deliveredWeightGramsCount: deliveredGrams,
      createdAt: created,
    );

Vendor _v(String id) => Vendor(
      id: id,
      name: 'V $id',
      category: '',
      ratingAverage: 4,
      ratingCount: 1,
      etaMinMinutes: 0,
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
      isOpen: true,
    );

const _flash = ActiveOffer(mechanism: 'FLASH_SALE', specialPriceMinor: 9000);

/// Records exactly what each section asks the backend for, and answers per vendor.
class _Repo implements ProductRepository {
  _Repo(this.byVendor);

  final Map<String, List<Product>> byVendor;
  final calls = <Map<String, Object?>>[];

  @override
  Future<List<Product>> getProducts(String vendorBranchId,
      {String? categoryId,
      String? sort,
      String? search,
      int? page,
      int? limit,
      bool? availableOnly,
      bool? hasOffers,
      int? minPriceMinor,
      int? maxPriceMinor}) async {
    calls.add({
      'vendor': vendorBranchId,
      'sort': sort,
      'hasOffers': hasOffers,
      'limit': limit
    });
    return byVendor[vendorBranchId] ?? const [];
  }

  @override
  Future<List<ProductCategoryInfo>> getCategories(
          String vendorBranchId) async =>
      const [];

  @override
  Future<Product> getProductDetails(String productId) =>
      throw UnimplementedError();
}

void main() {
  group('what each Home section MEANS', () {
    test(
        '"Most ordered" = really delivered at least once — a product that merely sorts first with 0 deliveries is NOT most ordered',
        () {
      expect(isMostOrderedProduct(_p('a', delivered: 3)), isTrue);
      expect(isMostOrderedProduct(_p('b', deliveredGrams: 2500)), isTrue);
      expect(isMostOrderedProduct(_p('c')), isFalse);
    });

    test(
        '"New" = created inside the 30-day window; older, undated and future-dated products are never new',
        () {
      expect(
          isNewProduct(
              _p('a', created: _now.subtract(const Duration(days: 3))), _now),
          isTrue);
      expect(
          isNewProduct(
              _p('b', created: _now.subtract(const Duration(days: 29))), _now),
          isTrue);
      expect(
          isNewProduct(
              _p('c', created: _now.subtract(const Duration(days: 31))), _now),
          isFalse);
      expect(isNewProduct(_p('d'), _now), isFalse);
      expect(
          isNewProduct(
              _p('e', created: _now.add(const Duration(days: 1))), _now),
          isFalse);
      expect(
          isNewProduct(
              _p('f', created: _now.subtract(const Duration(days: 10))), _now,
              days: 7),
          isFalse);
    });

    test(
        '"Offers" = the product carries a valid offer (the backend only reports offers checkout would honour)',
        () {
      expect(isOfferProduct(_p('a', offer: _flash)), isTrue);
      expect(isOfferProduct(_p('b')), isFalse);
    });

    test(
        'composeSectionEntries interleaves vendors, de-duplicates, filters and caps',
        () {
      final out = composeSectionEntries(
        [
          [
            _p('a1', delivered: 5),
            _p('a2', delivered: 0),
            _p('a3', delivered: 1)
          ],
          [
            _p('b1', delivered: 2),
            _p('a1', delivered: 5),
            _p('b3', delivered: 9)
          ],
        ],
        qualifies: isMostOrderedProduct,
        tag: HomeProductTag.popular,
      );
      expect(out.map((e) => e.product.id),
          ['a1', 'b1', 'a3', 'b3']); // a1 once, a2 excluded (never ordered)
      expect(out.every((e) => e.tag == HomeProductTag.popular), isTrue);
      expect(
          composeSectionEntries([
            [_p('x', delivered: 1), _p('y', delivered: 1)]
          ],
                  qualifies: isMostOrderedProduct,
                  tag: HomeProductTag.popular,
                  max: 1)
              .length,
          1);
    });
  });

  group(
      'loadHomeSection asks the backend for the right thing and applies the definition',
      () {
    final vendors = [_v('v1'), _v('v2')];

    test(
        'Most ordered: sort=bestSelling; products with no deliveries are dropped (nothing arbitrary is substituted)',
        () async {
      final repo = _Repo({
        'v1': [_p('kefta', delivered: 0), _p('rice', delivered: 4)],
        'v2': [_p('tea', delivered: 0)],
      });
      final out = await loadHomeSection(
          repo, vendors, HomeSectionKind.mostOrdered,
          perVendor: 3, now: _now);
      expect(out.map((e) => e.product.id), ['rice']);
      expect(
          repo.calls.every((c) =>
              c['sort'] == 'bestSelling' &&
              c['hasOffers'] == null &&
              c['limit'] == 3),
          isTrue);
    });

    test(
        'with NOTHING ever ordered the section is simply empty (it is hidden on Home), never padded with a random product',
        () async {
      final repo = _Repo({
        'v1': [_p('kefta'), _p('rice')]
      });
      expect(
          await loadHomeSection(repo, vendors, HomeSectionKind.mostOrdered,
              perVendor: 3, now: _now),
          isEmpty);
    });

    test('New: sort=newest and only products created inside the window',
        () async {
      final repo = _Repo({
        'v1': [
          _p('fresh', created: _now.subtract(const Duration(days: 2))),
          _p('stale', created: _now.subtract(const Duration(days: 90)))
        ],
        'v2': [_p('undated')],
      });
      final out = await loadHomeSection(repo, vendors, HomeSectionKind.newest,
          perVendor: 3, now: _now);
      expect(out.map((e) => e.product.id), ['fresh']);
      expect(repo.calls.every((c) => c['sort'] == 'newest'), isTrue);
    });

    test(
        'Offers: hasOffers=true is requested per vendor (so offers are not limited to products that happen to be in other rows) and only offer products are kept',
        () async {
      final repo = _Repo({
        'v1': [_p('kefta', offer: _flash)],
        'v2': [
          _p('plain'),
          _p('cola', offer: const ActiveOffer(mechanism: 'SUBTOTAL_DISCOUNT'))
        ],
      });
      final out = await loadHomeSection(repo, vendors, HomeSectionKind.offers,
          perVendor: 3, now: _now);
      expect(out.map((e) => e.product.id), ['kefta', 'cola']);
      expect(
          repo.calls.every((c) => c['hasOffers'] == true && c['sort'] == null),
          isTrue);
    });

    test(
        'one failing vendor degrades to nothing for that vendor; the others still show',
        () async {
      final repo = _FailingFirst({
        'v2': [_p('ok', delivered: 1)]
      });
      final out = await loadHomeSection(
          repo, vendors, HomeSectionKind.mostOrdered,
          perVendor: 3, now: _now);
      expect(out.map((e) => e.product.id), ['ok']);
    });
  });

  group('hero banner proportions', () {
    test(
        'about 1.6:1 on a normal phone (was a ~2:1 strip of 176), clamped for small and large screens',
        () {
      expect(promoBannerHeight(390), inInclusiveRange(170, 182));
      expect(promoBannerHeight(390), lessThan(210));
      expect(promoBannerHeight(320), kPromoBannerMinHeight);
      expect(promoBannerHeight(1200), kPromoBannerMaxHeight);
    });
  });

  group('routes', () {
    test(
        'each section has its own "See all" route, and unknown slugs are not a section',
        () {
      expect(homeSectionRoute(HomeSectionKind.mostOrdered),
          '/home/products/most-ordered');
      expect(homeSectionRoute(HomeSectionKind.newest), '/home/products/new');
      expect(homeSectionRoute(HomeSectionKind.offers), '/home/products/offers');
      for (final kind in HomeSectionKind.values) {
        expect(homeSectionKindFromSlug(homeSectionRoute(kind).split('/').last),
            kind);
      }
      expect(homeSectionKindFromSlug('nonsense'), isNull);
      expect(homeSectionKindFromSlug(null), isNull);
    });
  });

  group(
      'the "See all" screen lists the SAME products as the section definition says',
      () {
    Future<List<String>> pump(WidgetTester tester, HomeSectionKind kind,
        AsyncValue<List<HomeProductEntry>> Function() value,
        {List<String>? visited}) async {
      tester.view.physicalSize = const Size(390, 2400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final seen = visited ?? <String>[];
      await tester.pumpWidget(hatlyRouterApp(
        initialLocation: homeSectionRoute(kind),
        overrides: [
          homeSectionProductsProvider(kind).overrideWith((ref) async {
            final v = value();
            if (v.hasError) throw v.error!;
            return v.requireValue;
          }),
        ],
        routes: [
          GoRoute(
              path: '/home/products/:kind',
              builder: (c, s) => HomeSectionProductsScreen(
                  kind: homeSectionKindFromSlug(s.pathParameters['kind'])!)),
          probeRoute('/products/:id', visited: seen),
        ],
      ));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      return seen;
    }

    testWidgets(
        'Most ordered: titled "الأكثر طلبًا", shows each product, and tapping one opens ITS details',
        (tester) async {
      final seen = await pump(
          tester,
          HomeSectionKind.mostOrdered,
          () => AsyncData([
                HomeProductEntry(
                    product: _p('rice', delivered: 4, name: 'أرز'),
                    tag: HomeProductTag.popular),
                HomeProductEntry(
                    product: _p('tea', delivered: 2, name: 'شاي'),
                    tag: HomeProductTag.popular),
              ]));
      expect(find.text('الأكثر طلبًا'), findsOneWidget);
      expect(find.text('أرز'), findsOneWidget);
      expect(find.text('شاي'), findsOneWidget);
      await tester.tap(find.byKey(const Key('home-section-product-tea')));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(seen, ['/products/tea']);
    });

    testWidgets('New and Offers have their own titles', (tester) async {
      await pump(tester, HomeSectionKind.newest,
          () => const AsyncData(<HomeProductEntry>[]));
      expect(find.text('الجديد'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      await pump(tester, HomeSectionKind.offers,
          () => const AsyncData(<HomeProductEntry>[]));
      expect(find.text('العروض'), findsOneWidget);
    });

    testWidgets('an empty section says so (no filler product)', (tester) async {
      await pump(tester, HomeSectionKind.mostOrdered,
          () => const AsyncData(<HomeProductEntry>[]));
      expect(find.byKey(const Key('home-section-empty')), findsOneWidget);
      expect(find.byKey(const Key('home-section-product-rice')), findsNothing);
    });

    testWidgets('a failed load shows the retry state, not a blank page',
        (tester) async {
      await pump(tester, HomeSectionKind.offers,
          () => AsyncError(Exception('down'), StackTrace.empty));
      expect(find.text('إعادة المحاولة'), findsOneWidget);
    });
  });
}

class _FailingFirst extends _Repo {
  _FailingFirst(super.byVendor);
  var _first = true;

  @override
  Future<List<Product>> getProducts(String vendorBranchId,
      {String? categoryId,
      String? sort,
      String? search,
      int? page,
      int? limit,
      bool? availableOnly,
      bool? hasOffers,
      int? minPriceMinor,
      int? maxPriceMinor}) async {
    if (_first) {
      _first = false;
      throw Exception('vendor down');
    }
    return await super.getProducts(vendorBranchId,
        sort: sort, hasOffers: hasOffers, limit: limit);
  }
}
