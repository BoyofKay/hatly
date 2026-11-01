import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/auth/presentation/phone_verification_prompt_controller.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/data/home_banners_api.dart';
import 'package:hatly_customer/features/home/data/home_banners_providers.dart';
import 'package:hatly_customer/features/home/data/home_product_sections_api.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_banner.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/presentation/home_screen.dart';
import 'package:hatly_customer/features/products/data/product_providers.dart';
import 'package:hatly_customer/features/products/data/product_repository.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/vendors/data/vendor_repository.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/sectors/data/sectors_api.dart';
import 'package:hatly_customer/features/sectors/data/sectors_providers.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';
import 'package:hatly_customer/features/vendors/data/vendor_providers.dart';

import '../../support/test_app.dart';

/// The Home product rows now come from ONE request (`GET /home/product-sections`). These tests pin: the wire format and its parsing, the
/// composition into the snapshot (same tags, same offers derivation), per-section failure / empty / retry behaviour, that the old
/// multi-request path is NOT used, banner/category independence, and that Home stays loaded while the shell switches tabs.
Map<String, dynamic> productJson(String id, String name, {int ordered = 0, Map<String, dynamic>? offer, String branch = 'branch-1'}) => {
      'id': id,
      'vendorBranchId': branch,
      'categoryId': 'cat-1',
      'name': name,
      'nameAr': null,
      'description': null,
      'descriptionAr': null,
      'imageUrl': null,
      'priceMinor': 12000,
      'isAvailable': true,
      'pricingUnit': 'PIECE',
      'inventoryMode': 'OPEN',
      'quantity': null,
      'deliveredQuantityCount': ordered,
      'deliveredWeightGramsCount': 0,
      'createdAt': DateTime.now().subtract(const Duration(days: 2)).toUtc().toIso8601String(),
      'activeOffer': offer,
    };

Map<String, dynamic> vendorJson(String id, {bool hasOffer = false}) => {
      'id': id,
      'name': 'Vendor $id',
      'nameAr': null,
      'logoUrl': null,
      'isOpen': true,
      'ratingAverage': 4.5,
      'ratingCount': 12,
      'hasOffer': hasOffer,
    };

Map<String, dynamic> sectionJson(String id, {List<Map<String, dynamic>> products = const [], bool failed = false}) =>
    failed ? {'id': id, 'status': 'ERROR', 'code': 'SECTION_UNAVAILABLE', 'products': []} : {'id': id, 'status': 'OK', 'products': products};

Map<String, dynamic> responseJson({List<Map<String, dynamic>>? sections, List<Map<String, dynamic>>? vendors}) => {
      'data': {
        'contractVersion': 1,
        'generatedAt': '2026-10-30T10:00:00.000Z',
        'scope': {'deliveryZoneId': null},
        'vendors': vendors ?? [vendorJson('branch-1', hasOffer: true)],
        'sections': sections ??
            [
              sectionJson('OFFERS', products: [productJson('p-offer', 'Offer burger', offer: {'mechanism': 'FLASH_SALE', 'specialPriceMinor': 9000})]),
              sectionJson('MOST_ORDERED', products: [productJson('p-pop', 'Popular pizza', ordered: 7)]),
              sectionJson('NEW', products: [productJson('p-new', 'Fresh salad')]),
            ],
      },
    };

class _FakeSectionsApi implements HomeProductSectionsApi {
  _FakeSectionsApi(this.handler);
  final Future<HomeProductSectionsResult> Function(int call, Set<HomeSectionKind>? sections) handler;
  int calls = 0;
  final requested = <Set<HomeSectionKind>?>[];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<HomeProductSectionsResult> fetch({Set<HomeSectionKind>? sections}) {
    calls++;
    requested.add(sections);
    return handler(calls, sections);
  }
}

HomeProductSectionsResult parsed([Map<String, dynamic>? json]) => HomeProductSectionsApi.parse(json ?? responseJson());

class _CountingSectorsApi implements SectorsApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<List<MarketplaceSector>> getSectors() async => const [MarketplaceSector(id: 's1', name: 'Restaurants', nameAr: 'مطاعم ووجبات', slug: 'restaurants', sortOrder: 0)];
}

class _Banners implements HomeBannersApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<List<HomeBanner>> getBanners() async => const [HomeBanner(id: 'b1', title: 'Banner', imageUrl: '/uploads/files/x.webp')];
}

class _EmptyCartApi implements CartApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<Cart> getCart() async => const Cart(id: 'c', fulfillmentType: 'DELIVERY', groups: [], subtotalMinor: 0, hasUnpricedItems: false, readyForCheckout: false);
}

/// Any use of the OLD request pattern fails the test: the per-sector vendor lists and per-vendor product lists must not be called.
class _ForbiddenRepos {
  static final overrides = <Override>[
    vendorRepositoryProvider.overrideWith((ref) => throw StateError('the old vendor-list requests must not be made')),
    productRepositoryProvider.overrideWith((ref) => throw StateError('the old per-vendor product requests must not be made')),
  ];
}

List<Override> _overrides(_FakeSectionsApi api) => [
      homeDemoEnabledProvider.overrideWithValue(false),
      homeProductSectionsApiProvider.overrideWithValue(api),
      sectorsApiProvider.overrideWithValue(_CountingSectorsApi()),
      homeBannersApiProvider.overrideWithValue(_Banners()),
      homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
      phoneVerificationStatusProvider.overrideWith((ref) async => true),
      cartApiProvider.overrideWithValue(_EmptyCartApi()),
      ..._ForbiddenRepos.overrides,
    ];

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 4200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _pumpHome(WidgetTester tester, _FakeSectionsApi api) async {
  _phone(tester);
  await tester.pumpWidget(hatlyTestApp(const HomeScreen(), locale: const Locale('en'), overrides: _overrides(api)));
  await tester.pumpAndSettle(const Duration(milliseconds: 100));
}

Future<void> _dispose(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  await tester.pumpAndSettle(const Duration(seconds: 1));
}

void main() {
  group('parsing the aggregation response', () {
    test('three sections, their products (every card field) and the ranked vendors with their offer flags', () {
      final result = parsed();
      expect(result.sections.keys, containsAll(HomeSectionKind.values));
      expect(result.sections[HomeSectionKind.offers]!.products.single.activeOffer, isNotNull);
      expect(result.sections[HomeSectionKind.mostOrdered]!.products.single.hasBeenOrdered, isTrue);
      expect(result.sections[HomeSectionKind.newest]!.products.single.name, 'Fresh salad');
      expect(result.sections[HomeSectionKind.newest]!.products.single.priceMinor, 12000);
      expect(result.vendors.single.hasPromotion, isTrue);
      expect(result.vendors.single.ratingCount, 12);
    });

    test('an ERROR section is failed for that section only; an unknown section id is ignored; a missing section is simply absent', () {
      final result = parsed(responseJson(sections: [
        sectionJson('OFFERS', failed: true),
        sectionJson('MOST_ORDERED', products: [productJson('a', 'A', ordered: 1)]),
        sectionJson('SOMETHING_NEW_IN_V2', products: [productJson('x', 'X')]),
      ]));
      expect(result.sections[HomeSectionKind.offers]!.failed, isTrue);
      expect(result.sections[HomeSectionKind.mostOrdered]!.failed, isFalse);
      expect(result.sections[HomeSectionKind.mostOrdered]!.products, hasLength(1));
      expect(result.sections.containsKey(HomeSectionKind.newest), isFalse);
    });

    test('a product the app cannot read is dropped, never thrown — the rest of the row survives', () {
      final broken = productJson('bad', 'Broken')..remove('priceMinor');
      final result = parsed(responseJson(sections: [
        sectionJson('NEW', products: [productJson('ok', 'Fine'), broken, productJson('ok2', 'Also fine')]),
      ]));
      expect(result.sections[HomeSectionKind.newest]!.products.map((p) => p.id), ['ok', 'ok2']);
    });

    test('an empty section is OK and empty (not failed)', () {
      final result = parsed(responseJson(sections: [sectionJson('NEW')]));
      expect(result.sections[HomeSectionKind.newest]!.failed, isFalse);
      expect(result.sections[HomeSectionKind.newest]!.products, isEmpty);
    });
  });

  group('the snapshot built from it', () {
    Future<HomeSnapshot> snapshotFor(_FakeSectionsApi api) {
      final c = ProviderContainer(overrides: [
        homeDemoEnabledProvider.overrideWithValue(false),
        homeProductSectionsApiProvider.overrideWithValue(api),
        ..._ForbiddenRepos.overrides,
      ]);
      addTearDown(c.dispose);
      c.listen(homeSnapshotProvider, (_, __) {});
      return c.read(homeSnapshotProvider.future);
    }

    test('product entries carry the same tags as before (Most ordered → popular, New → newItem), the offers row is derived from the Offers section + vendor promotions, promos from the offers', () async {
      final api = _FakeSectionsApi((_, __) async => parsed());
      final snapshot = await snapshotFor(api);
      expect(snapshot.productEntries.map((e) => (e.product.id, e.tag)), [('p-pop', HomeProductTag.popular), ('p-new', HomeProductTag.newItem)]);
      expect(snapshot.offers.map((o) => o.id), ['offer-p-offer', 'offer-vendor-branch-1']);
      expect(snapshot.offers.first.kind, HomeOfferKind.flash);
      expect(snapshot.promos.map((p) => p.id), ['promo-offer-p-offer', 'promo-offer-vendor-branch-1']);
      expect(snapshot.failedSections, isEmpty);
      expect(api.calls, 1);
    });

    test('a failed section is listed and contributes nothing; the others are intact', () async {
      final api = _FakeSectionsApi((_, __) async => parsed(responseJson(sections: [
            sectionJson('OFFERS', failed: true),
            sectionJson('MOST_ORDERED', products: [productJson('p-pop', 'Popular pizza', ordered: 7)]),
            sectionJson('NEW', products: [productJson('p-new', 'Fresh salad')]),
          ])));
      final snapshot = await snapshotFor(api);
      expect(snapshot.failedSections, {HomeSectionKind.offers});
      expect(snapshot.productEntries, hasLength(2));
    });

    test('a request that fails as a whole is the snapshot\'s error (Home then shows ONE retry for the rows)', () async {
      final api = _FakeSectionsApi((_, __) async => throw const ApiException(code: 'NETWORK_ERROR', message: 'offline'));
      await expectLater(snapshotFor(api), throwsA(isA<ApiException>()));
    });

    test('Most ordered and New are capped at 10 each', () async {
      final many = [for (var i = 0; i < 14; i++) productJson('m$i', 'M$i', ordered: 3)];
      final api = _FakeSectionsApi((_, __) async => parsed(responseJson(sections: [sectionJson('MOST_ORDERED', products: many), sectionJson('NEW', products: many.map((m) => {...m, 'id': 'n${m['id']}'}).toList())])));
      final snapshot = await snapshotFor(api);
      expect(snapshot.productEntries.where((e) => e.tag == HomeProductTag.popular), hasLength(10));
      expect(snapshot.productEntries.where((e) => e.tag == HomeProductTag.newItem), hasLength(10));
    });
  });

  group('Home screen', () {
    testWidgets('ONE aggregation request fills all three rows (and the old vendor/product requests are never made)', (tester) async {
      final api = _FakeSectionsApi((_, __) async => parsed());
      await _pumpHome(tester, api);
      expect(api.calls, 1);
      expect(find.text('Offers'), findsWidgets);
      expect(find.text('Most ordered'), findsOneWidget);
      expect(find.text('New'), findsWidgets);
      expect(find.textContaining('Popular pizza'), findsOneWidget);
      expect(find.textContaining('Fresh salad'), findsOneWidget);
      await _dispose(tester);
    });

    testWidgets('banner and categories do not wait for the rows (the aggregation is still pending)', (tester) async {
      final pending = Completer<HomeProductSectionsResult>();
      final api = _FakeSectionsApi((_, __) => pending.future);
      _phone(tester);
      await tester.pumpWidget(hatlyTestApp(const HomeScreen(), locale: const Locale('en'), overrides: _overrides(api)));
      await tester.pump(const Duration(milliseconds: 100));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.byKey(const Key('home-banner-b1')), findsOneWidget);
      expect(find.text('Restaurants'), findsWidgets);
      expect(find.textContaining('Popular pizza'), findsNothing);
      pending.complete(parsed());
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.textContaining('Popular pizza'), findsOneWidget);
      expect(api.calls, 1);
      await _dispose(tester);
    });

    testWidgets('ONE failed section is its own retry card while the other two render; retrying fills it, and no other row disappears', (tester) async {
      final api = _FakeSectionsApi((call, _) async => call == 1
          ? parsed(responseJson(sections: [
              sectionJson('OFFERS', products: [productJson('p-offer', 'Offer burger', offer: {'mechanism': 'FLASH_SALE', 'specialPriceMinor': 9000})]),
              sectionJson('MOST_ORDERED', failed: true),
              sectionJson('NEW', products: [productJson('p-new', 'Fresh salad')]),
            ]))
          : parsed());
      await _pumpHome(tester, api);
      expect(find.byKey(const Key('home-section-error-mostOrdered')), findsOneWidget);
      expect(find.byKey(const Key('home-section-error-offers')), findsNothing);
      expect(find.byKey(const Key('home-section-error-newest')), findsNothing);
      expect(find.textContaining('Fresh salad'), findsOneWidget);
      expect(find.textContaining('Offer burger'), findsWidgets);

      await tester.tap(find.byKey(const Key('home-section-retry-mostOrdered')));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(api.calls, 2);
      expect(find.byKey(const Key('home-section-error-mostOrdered')), findsNothing);
      expect(find.textContaining('Popular pizza'), findsOneWidget);
      expect(find.textContaining('Fresh salad'), findsOneWidget);
      await _dispose(tester);
    });

    testWidgets('while a retry is in flight the OTHER rows stay on screen (only the failed row shows a skeleton)', (tester) async {
      final retry = Completer<HomeProductSectionsResult>();
      final api = _FakeSectionsApi((call, _) => call == 1
          ? Future.value(parsed(responseJson(sections: [
              sectionJson('OFFERS', failed: true),
              sectionJson('MOST_ORDERED', products: [productJson('p-pop', 'Popular pizza', ordered: 7)]),
              sectionJson('NEW', products: [productJson('p-new', 'Fresh salad')]),
            ])))
          : retry.future);
      await _pumpHome(tester, api);
      await tester.tap(find.byKey(const Key('home-section-retry-offers')));
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.textContaining('Popular pizza'), findsOneWidget);
      expect(find.textContaining('Fresh salad'), findsOneWidget);
      expect(find.byKey(const Key('home-section-retry-offers')), findsNothing); // replaced by the row's own skeleton
      retry.complete(parsed());
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      await _dispose(tester);
    });

    testWidgets('an EMPTY section disappears quietly and never hides the others', (tester) async {
      final api = _FakeSectionsApi((_, __) async => parsed(responseJson(sections: [
            sectionJson('OFFERS'),
            sectionJson('MOST_ORDERED'),
            sectionJson('NEW', products: [productJson('p-new', 'Fresh salad')]),
          ], vendors: [vendorJson('branch-1')])));
      await _pumpHome(tester, api);
      expect(find.text('Most ordered'), findsNothing);
      expect(find.byKey(const Key('home-section-error-mostOrdered')), findsNothing);
      expect(find.text('New'), findsWidgets);
      expect(find.textContaining('Fresh salad'), findsOneWidget);
      await _dispose(tester);
    });

    testWidgets('a whole-request failure shows ONE retry for the rows (banner and categories stay), and retrying recovers', (tester) async {
      final api = _FakeSectionsApi((call, _) async => call == 1 ? throw const ApiException(code: 'NETWORK_ERROR', message: 'offline') : parsed());
      await _pumpHome(tester, api);
      expect(find.byKey(const Key('home-banner-b1')), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.textContaining('Popular pizza'), findsOneWidget);
      expect(find.text('Retry'), findsNothing);
      await _dispose(tester);
    });

    testWidgets('Home stays loaded while the shell switches tabs and back (IndexedStack): no second aggregation request', (tester) async {
      final api = _FakeSectionsApi((_, __) async => parsed());
      _phone(tester);
      final tab = ValueNotifier<int>(0);
      await tester.pumpWidget(hatlyTestApp(
        ValueListenableBuilder<int>(valueListenable: tab, builder: (_, i, __) => IndexedStack(index: i, children: const [HomeScreen(), SizedBox()])),
        locale: const Locale('en'),
        overrides: _overrides(api),
      ));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(api.calls, 1);
      tab.value = 1;
      await tester.pump(const Duration(seconds: 1));
      tab.value = 0;
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(api.calls, 1);
      expect(find.textContaining('Popular pizza'), findsOneWidget);
      await _dispose(tester);
    });

    testWidgets('pull-to-refresh re-requests the rows once (and the banners/categories are re-read independently)', (tester) async {
      final api = _FakeSectionsApi((_, __) async => parsed());
      await _pumpHome(tester, api);
      tester.view.physicalSize = const Size(390, 800); // shorter than the content, so the list scrolls and can be pulled down
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      await tester.fling(find.byType(ListView).first, const Offset(0, 500), 1000);
      await tester.pumpAndSettle(const Duration(seconds: 1));
      expect(api.calls, 2);
      await _dispose(tester);
    });
  });

  group('a backend that predates the endpoint (404)', () {
    test('Home still loads through the previous multi-request composition, and any OTHER failure is not swallowed into it', () async {
      final legacyProduct = Product(
        id: 'legacy-1',
        vendorBranchId: 'b',
        categoryId: 'c',
        name: 'Legacy popular',
        priceMinor: 1000,
        isAvailable: true,
        deliveredQuantityCount: 4,
        createdAt: DateTime.now().subtract(const Duration(days: 1)),
      );
      final container = ProviderContainer(overrides: [
        homeDemoEnabledProvider.overrideWithValue(false),
        homeProductSectionsApiProvider.overrideWithValue(_FakeSectionsApi((_, __) async => throw const ApiException(code: 'NOT_FOUND', message: 'Cannot GET /home/product-sections', statusCode: 404))),
        sectorsApiProvider.overrideWithValue(_CountingSectorsApi()),
        vendorRepositoryProvider.overrideWithValue(_LegacyVendors()),
        productRepositoryProvider.overrideWithValue(_LegacyProducts([legacyProduct])),
      ]);
      addTearDown(container.dispose);
      container.listen(homeSnapshotProvider, (_, __) {});
      final snapshot = await container.read(homeSnapshotProvider.future);
      expect(snapshot.productEntries.map((e) => e.product.id), contains('legacy-1'));
      expect(snapshot.failedSections, isEmpty);

      final failing = ProviderContainer(overrides: [
        homeDemoEnabledProvider.overrideWithValue(false),
        homeProductSectionsApiProvider.overrideWithValue(_FakeSectionsApi((_, __) async => throw const ApiException(code: 'INTERNAL', message: 'boom', statusCode: 500))),
        ..._ForbiddenRepos.overrides,
      ]);
      addTearDown(failing.dispose);
      failing.listen(homeSnapshotProvider, (_, __) {});
      await expectLater(failing.read(homeSnapshotProvider.future), throwsA(isA<ApiException>()));
    });
  });
}

class _LegacyVendors implements VendorRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<List<Vendor>> getVendors({String? category}) async => const [
        Vendor(id: 'b', name: 'V', category: '', ratingAverage: 4, ratingCount: 3, etaMinMinutes: 0, etaMaxMinutes: 0, deliveryFeeMinor: 0, isOpen: true),
      ];
}

class _LegacyProducts implements ProductRepository {
  _LegacyProducts(this.products);
  final List<Product> products;
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<List<Product>> getProducts(String vendorBranchId, {String? categoryId, String? sort, String? search, int? page, int? limit, bool? availableOnly, bool? hasOffers, int? minPriceMinor, int? maxPriceMinor}) async => products;
}
