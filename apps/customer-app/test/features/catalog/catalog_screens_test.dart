import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/catalog/data/catalog_providers.dart';
import 'package:hatly_customer/features/catalog/data/catalog_repository.dart';
import 'package:hatly_customer/features/catalog/domain/catalog_product.dart';
import 'package:hatly_customer/features/catalog/presentation/catalog_product_details_screen.dart';
import 'package:hatly_customer/features/catalog/presentation/category_products_screen.dart';
import 'package:hatly_customer/features/catalog/presentation/widgets/marketplace_product_card.dart';
import 'package:hatly_customer/features/catalog/presentation/widgets/vendor_listing_card.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/shared_widgets/hatly_quick_add_button.dart';

import '../../support/router_test_app.dart';

class _Call {
  _Call(this.sectorId, this.sort, this.search, this.page, this.lat);
  final String sectorId;
  final String? sort;
  final String? search;
  final int page;
  final double? lat;
}

class _FakeCatalogRepo implements CatalogRepository {
  _FakeCatalogRepo(
      {this.pages = const [], this.details, this.failFirst = false});

  final List<List<CatalogProductSummary>> pages;
  final CatalogProductDetails? details;
  bool failFirst;
  int total = 0;
  final calls = <_Call>[];

  @override
  Future<CatalogProductPage> getSectorProducts(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
  }) async {
    calls.add(_Call(sectorId, sort, search, page, latitude));
    if (failFirst) {
      failFirst = false;
      throw Exception('offline');
    }
    final data =
        page <= pages.length ? pages[page - 1] : <CatalogProductSummary>[];
    return CatalogProductPage(
        data: data,
        page: page,
        limit: limit,
        total: total == 0 ? pages.fold<int>(0, (n, p) => n + p.length) : total);
  }

  @override
  Future<CatalogProductDetails> getCatalogProduct(String catalogProductId,
      {double? latitude, double? longitude}) async {
    return details!;
  }
}

CatalogProductSummary _grouped({bool offer = false, int stores = 3}) =>
    CatalogProductSummary(
      catalogProductId: 'cat-1',
      name: 'Cola 1.25L',
      nameAr: 'كولا 1.25 لتر',
      pricingUnit: 'PIECE',
      fromPriceMinor: 2500,
      storeCount: stores,
      hasOffer: offer,
    );

const _single = CatalogProductSummary(
  listingId: 'listing-9',
  name: 'Rice 1kg',
  nameAr: 'أرز 1 كجم',
  pricingUnit: 'PIECE',
  fromPriceMinor: 6000,
  storeCount: 1,
  hasOffer: false,
);

CatalogProductSummary _fill(int i) => CatalogProductSummary(
      listingId: 'l$i',
      name: 'Item $i',
      nameAr: 'منتج $i',
      pricingUnit: 'PIECE',
      fromPriceMinor: 1000 + i,
      storeCount: 1,
      hasOffer: false,
    );

VendorListing _listing(String id, String name, int price,
        {double rating = 0,
        int ratingCount = 0,
        bool open = true,
        ActiveOffer? offer,
        String inventoryMode = 'OPEN',
        int? quantity}) =>
    VendorListing(
      listingId: id,
      vendorBranchId: 'b-$id',
      vendor: ListingVendor(id: 'v-$id', name: name, nameAr: name),
      branchName: '$name Main',
      isOpen: open,
      ratingAverage: rating,
      ratingCount: ratingCount,
      priceMinor: price,
      pricingUnit: 'PIECE',
      activeOffer: offer,
      isAvailable: true,
      inventoryMode: inventoryMode,
      quantity: quantity,
    );

CatalogProductDetails _details(List<VendorListing> listings,
        {String? description}) =>
    CatalogProductDetails(
      id: 'cat-1',
      name: 'Cola 1.25L',
      nameAr: 'كولا 1.25 لتر',
      description: description,
      descriptionAr: description,
      pricingUnit: 'PIECE',
      storeCount: listings.length,
      listings: listings,
    );

List<Override> _overrides(_FakeCatalogRepo repo) => [
      catalogRepositoryProvider.overrideWithValue(repo),
      homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
    ];

Widget _listingApp(_FakeCatalogRepo repo,
        {List<String>? visited,
        bool dark = false,
        double textScale = 1.0,
        Locale locale = const Locale('ar')}) =>
    hatlyRouterApp(
      initialLocation: '/category-products?sectorId=sec1&sectorName=مشروبات',
      overrides: _overrides(repo),
      dark: dark,
      textScale: textScale,
      locale: locale,
      routes: [
        GoRoute(
          path: '/category-products',
          builder: (c, s) => CategoryProductsScreen(
              sectorId: s.uri.queryParameters['sectorId']!,
              sectorName: s.uri.queryParameters['sectorName']),
        ),
        probeRoute('/catalog-products/:id', visited: visited),
        probeRoute('/products/:id', visited: visited),
      ],
    );

Widget _detailsApp(_FakeCatalogRepo repo,
        {List<String>? visited,
        bool dark = false,
        double textScale = 1.0,
        Locale locale = const Locale('ar')}) =>
    hatlyRouterApp(
      initialLocation: '/catalog-products/cat-1',
      overrides: _overrides(repo),
      dark: dark,
      textScale: textScale,
      locale: locale,
      routes: [
        GoRoute(
          path: '/catalog-products/:id',
          builder: (c, s) => CatalogProductDetailsScreen(
              catalogProductId: s.pathParameters['id']!),
        ),
        probeRoute('/products/:id', visited: visited),
      ],
    );

void _phone(WidgetTester tester, {double width = 390, double height = 1600}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _open(WidgetTester tester, Widget app) async {
  await tester.pumpWidget(app);
  await tester.pumpAndSettle(const Duration(milliseconds: 100));
}

void main() {
  group('Category → product-first listing', () {
    testWidgets(
        'loads GET /products for the tapped sector and shows grouped + unlinked cards',
        (tester) async {
      _phone(tester);
      final repo = _FakeCatalogRepo(pages: [
        [_grouped(offer: true), _single]
      ]);
      await _open(tester, _listingApp(repo));

      expect(repo.calls.single.sectorId, 'sec1');
      expect(repo.calls.single.sort, isNull);
      expect(
          find.text('مشروبات'), findsOneWidget); // sector name in the app bar
      expect(find.byType(MarketplaceProductCard), findsNWidgets(2));
      // grouped: "starts from" + store count + real offer badge
      expect(find.text('كولا 1.25 لتر'), findsOneWidget);
      expect(find.text('25 ج.م'), findsOneWidget);
      expect(find.textContaining('يبدأ من'), findsOneWidget);
      expect(find.text('3 متاجر'), findsOneWidget);
      expect(find.text('عرض'), findsOneWidget);
      // unlinked/single store: plain price, no "starts from", no store count, no offer
      expect(find.text('أرز 1 كجم'), findsOneWidget);
      expect(find.text('60 ج.م'), findsOneWidget);
      expect(find.textContaining('متاجر'),
          findsOneWidget); // only the grouped card's count
      // nothing invented: no rating / ETA / delivery fee
      expect(find.byIcon(Icons.star_rounded), findsNothing);
      expect(find.textContaining('توصيل'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'grouped card → catalog details; unlinked card → Product Details with the listing id; "+" never picks a vendor',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      final repo = _FakeCatalogRepo(pages: [
        [_grouped(), _single]
      ]);
      await _open(tester, _listingApp(repo, visited: visited));

      await tester.tap(find.text('كولا 1.25 لتر'));
      await tester.pumpAndSettle();
      expect(visited.last, '/catalog-products/cat-1');
      Navigator.of(tester.element(find.byType(Scaffold).last)).pop();
      await tester.pumpAndSettle();

      await tester.tap(find.text('أرز 1 كجم'));
      await tester.pumpAndSettle();
      expect(visited.last, '/products/listing-9');
      Navigator.of(tester.element(find.byType(Scaffold).last)).pop();
      await tester.pumpAndSettle();

      // the floating "+" of the grouped card goes to the same selection, never straight to the cart
      await tester.tap(find.byType(HatlyQuickAddButton).first);
      await tester.pumpAndSettle();
      expect(visited.last, '/catalog-products/cat-1');
      Navigator.of(tester.element(find.byType(Scaffold).last)).pop();
      await tester.pumpAndSettle();
      // and the unlinked card's "+" opens its configuration screen
      await tester.tap(find.byType(HatlyQuickAddButton).last);
      await tester.pumpAndSettle();
      expect(visited.last, '/products/listing-9');
    });

    testWidgets(
        'the quieter "+" is a 36px white circle but keeps a 44px touch target and its label',
        (tester) async {
      _phone(tester);
      final repo = _FakeCatalogRepo(pages: [
        [_grouped(), _single]
      ]);
      final handle = tester.ensureSemantics();
      await _open(tester, _listingApp(repo));
      final plus = find.byType(HatlyQuickAddButton).first;
      expect(tester.widget<HatlyQuickAddButton>(plus).quiet, isTrue);
      expect(tester.getSize(plus).width, greaterThanOrEqualTo(44));
      expect(tester.getSize(plus).height, greaterThanOrEqualTo(44));
      final circle = find.descendant(
          of: plus,
          matching: find.byWidgetPredicate((w) =>
              w is SizedBox &&
              w.width == HatlyQuickAddButton.quietVisualSize &&
              w.height == HatlyQuickAddButton.quietVisualSize));
      expect(circle, findsOneWidget);
      expect(find.bySemanticsLabel('متوفر من 3 متاجر'), findsOneWidget);
      handle.dispose();
    });

    testWidgets(
        'sort options are the backend\'s five; picking one reloads from page 1 with that sort',
        (tester) async {
      _phone(tester);
      final repo = _FakeCatalogRepo(pages: [
        [_single]
      ]);
      await _open(tester, _listingApp(repo));
      await tester.tap(find.byTooltip('الترتيب'));
      await tester.pumpAndSettle();
      for (final label in [
        'الأحدث',
        'الأعلى تقييمًا',
        'الأكثر مبيعًا',
        'السعر: من الأقل إلى الأعلى',
        'السعر: من الأعلى إلى الأقل',
      ]) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      await tester.tap(find.text('السعر: من الأقل إلى الأعلى'));
      await tester.pumpAndSettle();
      expect(repo.calls.last.sort, 'price_asc');
      expect(repo.calls.last.page, 1);
    });

    testWidgets('search is debounced (400 ms) and sent to the API',
        (tester) async {
      _phone(tester);
      final repo = _FakeCatalogRepo(pages: [
        [_single]
      ]);
      await _open(tester, _listingApp(repo));
      final before = repo.calls.length;
      await tester.enterText(find.byType(TextField), 'أرز');
      await tester.pump(const Duration(milliseconds: 200));
      expect(repo.calls.length, before, reason: 'still debouncing');
      await tester.pump(const Duration(milliseconds: 300));
      await tester.pumpAndSettle();
      expect(repo.calls.last.search, 'أرز');
    });

    testWidgets(
        'paginates: the next page loads when scrolling near the bottom, not all at once',
        (tester) async {
      _phone(tester, height: 800);
      final repo = _FakeCatalogRepo(pages: [
        [for (var i = 0; i < 20; i++) _fill(i)],
        [for (var i = 20; i < 30; i++) _fill(i)],
      ])
        ..total = 30;
      await _open(tester, _listingApp(repo));
      expect(repo.calls.map((c) => c.page), [1],
          reason: 'only the first page up front');
      await tester.drag(find.byType(ListView).last, const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(repo.calls.map((c) => c.page), [1, 2]);
      await tester.drag(find.byType(ListView).last, const Offset(0, -9000));
      await tester.pumpAndSettle();
      expect(find.text('منتج 29'), findsOneWidget);
      expect(repo.calls.map((c) => c.page), [1, 2],
          reason: 'no third page: total reached');
    });

    testWidgets(
        'empty state, and an error with a working retry (design-system states)',
        (tester) async {
      _phone(tester);
      await _open(tester, _listingApp(_FakeCatalogRepo(pages: const [[]])));
      expect(find.text('لا توجد منتجات في هذا القسم'), findsOneWidget);
      expect(find.byType(MarketplaceProductCard), findsNothing);

      await tester.pumpWidget(const SizedBox());
      final repo = _FakeCatalogRepo(pages: [
        [_single]
      ], failFirst: true);
      await _open(tester, _listingApp(repo));
      expect(find.text('حدث خطأ ما'), findsOneWidget);
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(find.text('أرز 1 كجم'), findsOneWidget);
    });

    for (final s in const [
      ('ar light 390', Locale('ar'), false, 390.0, 1.0),
      ('en dark 390', Locale('en'), true, 390.0, 1.0),
      ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
      ('ar light 320 2x text', Locale('ar'), false, 320.0, 2.0),
    ]) {
      testWidgets('no overflow: ${s.$1}', (tester) async {
        _phone(tester, width: s.$4, height: 2200);
        final repo = _FakeCatalogRepo(pages: [
          [_grouped(offer: true), _single, _fill(1), _fill(2)]
        ]);
        await _open(tester,
            _listingApp(repo, locale: s.$2, dark: s.$3, textScale: s.$5));
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('Catalog product details → available stores', () {
    testWidgets(
        'shows "available from X stores" with one card per real listing in the backend order, nothing pre-selected',
        (tester) async {
      _phone(tester);
      final repo = _FakeCatalogRepo(
        details: _details([
          _listing('l-2', 'Market Two', 2600, rating: 4.5, ratingCount: 4),
          _listing('l-3', 'Market Three', 2900, open: false),
          _listing('l-1', 'Market One', 3100,
              offer: const ActiveOffer(
                  mechanism: 'FLASH_SALE', specialPriceMinor: 2400)),
        ], description: 'مشروب غازي'),
      );
      await _open(tester, _detailsApp(repo));

      expect(find.text('كولا 1.25 لتر'), findsOneWidget);
      expect(find.text('متوفر من 3 متاجر'), findsOneWidget);
      expect(find.textContaining('يبدأ من'), findsOneWidget);
      expect(find.text('مشروب غازي'), findsOneWidget);
      final cards = tester
          .widgetList<VendorListingCard>(find.byType(VendorListingCard))
          .toList();
      expect(cards.map((c) => c.listing.listingId), ['l-2', 'l-3', 'l-1']);
      // real rating only where there is one
      expect(find.text('4.5'), findsOneWidget);
      expect(find.text('(4)'), findsOneWidget);
      expect(find.byIcon(Icons.star_rounded), findsOneWidget);
      // open / closed, offer (never by colour alone: words)
      expect(find.text('مغلق'), findsOneWidget);
      expect(find.text('مفتوح الآن'), findsNWidgets(2));
      expect(find.text('عرض سريع'), findsOneWidget);
      expect(find.text('24 ج.م'), findsOneWidget);
      // no ETA / delivery fee, no "best / recommended" winner, no selection yet
      expect(find.textContaining('دقيقة'), findsNothing);
      expect(find.textContaining('توصيل'), findsNothing);
      expect(find.textContaining('الأفضل'), findsNothing);
      expect(find.text('اختيار'), findsNWidgets(3));
    });

    testWidgets(
        'choosing a store opens Product Details for THAT listing id (the cart identity), keeping the catalog context',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      final repo = _FakeCatalogRepo(
        details: _details([
          _listing('l-2', 'Market Two', 2600),
          _listing('l-1', 'Market One', 3100),
        ]),
      );
      await _open(tester, _detailsApp(repo, visited: visited));
      await tester.tap(find.text('اختيار').last);
      await tester.pumpAndSettle();
      expect(visited, ['/products/l-1?from=catalog']);
    });

    testWidgets(
        'a single store is still shown clearly and can be chosen directly',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      final repo = _FakeCatalogRepo(
          details: _details([_listing('only', 'Only Store', 2600)]));
      await _open(tester, _detailsApp(repo, visited: visited));
      expect(find.text('متوفر من متجر واحد'), findsOneWidget);
      expect(find.textContaining('يبدأ من'), findsNothing,
          reason: 'one price, not a "starts from"');
      expect(find.text('Only Store'), findsOneWidget);
      await tester.tap(find.byType(VendorListingCard));
      await tester.pumpAndSettle();
      expect(visited, ['/products/only?from=catalog']);
    });

    testWidgets(
        'an out-of-stock tracked listing is labelled in words and cannot be selected',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      final repo = _FakeCatalogRepo(
        details: _details([
          _listing('gone', 'Empty Store', 2600,
              inventoryMode: 'TRACKED', quantity: 0),
          _listing('ok', 'Stocked Store', 2700,
              inventoryMode: 'TRACKED', quantity: 5),
        ]),
      );
      await _open(tester, _detailsApp(repo, visited: visited));
      expect(find.text('غير متوفر حاليًا'), findsOneWidget);
      await tester.tap(find.byType(VendorListingCard).first,
          warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(visited, isEmpty);
      await tester.tap(find.byType(VendorListingCard).last);
      await tester.pumpAndSettle();
      expect(visited, ['/products/ok?from=catalog']);
    });

    testWidgets('a long description collapses with "عرض المزيد"',
        (tester) async {
      _phone(tester);
      final repo = _FakeCatalogRepo(
        details: _details([_listing('a', 'A', 100)],
            description: List.filled(40, 'مشروب غازي بارد ومنعش').join(' ')),
      );
      await _open(tester, _detailsApp(repo));
      expect(find.text('عرض المزيد'), findsOneWidget);
      await tester.tap(find.text('عرض المزيد'));
      await tester.pumpAndSettle();
      expect(find.text('عرض أقل'), findsOneWidget);
    });

    testWidgets(
        'no orderable stores → a clear message instead of an empty list',
        (tester) async {
      _phone(tester);
      await _open(
          tester, _detailsApp(_FakeCatalogRepo(details: _details(const []))));
      expect(find.text('غير متوفر حاليًا'), findsOneWidget);
      expect(find.byType(VendorListingCard), findsNothing);
    });

    for (final s in const [
      ('ar light 390', Locale('ar'), false, 390.0, 1.0),
      ('en dark 390', Locale('en'), true, 390.0, 1.0),
      ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
      ('ar light 320 2x text', Locale('ar'), false, 320.0, 2.0),
    ]) {
      testWidgets('no overflow: ${s.$1}', (tester) async {
        _phone(tester, width: s.$4, height: 2600);
        final repo = _FakeCatalogRepo(
          details: _details([
            _listing('l-2', 'A rather long store name here', 2600,
                rating: 4.5,
                ratingCount: 120,
                offer: const ActiveOffer(
                    mechanism: 'FLASH_SALE', specialPriceMinor: 2000)),
            _listing('l-1', 'Market One', 3100,
                open: false, inventoryMode: 'TRACKED', quantity: 0),
          ], description: List.filled(20, 'وصف طويل').join(' ')),
        );
        await _open(tester,
            _detailsApp(repo, locale: s.$2, dark: s.$3, textScale: s.$5));
        expect(tester.takeException(), isNull);
      });
    }
  });

  test(
      'catalogItemRoute: grouped → catalog details, unlinked → listing product details',
      () {
    expect(catalogItemRoute(_grouped()), '/catalog-products/cat-1');
    expect(catalogItemRoute(_single), '/products/listing-9');
  });
}
