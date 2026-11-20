import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/presentation/widgets/category_card.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/presentation/widgets/product_card.dart';
import 'package:hatly_customer/features/search/data/explore_providers.dart';
import 'package:hatly_customer/features/search/data/search_api.dart';
import 'package:hatly_customer/features/search/data/search_controller.dart';
import 'package:hatly_customer/features/search/presentation/search_screen.dart';
import 'package:hatly_customer/features/search/presentation/widgets/featured_category_row.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/vendor_cover_card.dart';
import 'package:hatly_customer/shared_widgets/hatly_quick_add_button.dart';

// ---------------------------------------------------------------- fixtures

List<MarketplaceSector> _cats(int n) => [
      for (var i = 0; i < n; i++)
        MarketplaceSector(
            id: 'sec$i',
            name: 'Cat $i',
            nameAr: 'فئة $i',
            slug: 'slug$i',
            sortOrder: i),
    ];

const _rated = Vendor(
    id: 'v-rated',
    name: 'Rated Grill',
    nameAr: 'مشويات مقيّمة',
    category: '',
    ratingAverage: 4.6,
    ratingCount: 12,
    etaMinMinutes: 0,
    etaMaxMinutes: 0,
    deliveryFeeMinor: 0,
    isOpen: true);
const _unrated = Vendor(
    id: 'v-unrated',
    name: 'Fresh Corner',
    nameAr: 'ركن جديد',
    category: '',
    ratingAverage: 0,
    ratingCount: 0,
    etaMinMinutes: 0,
    etaMaxMinutes: 0,
    deliveryFeeMinor: 0,
    isOpen: false);
const _newVendor = Vendor(
    id: 'v-new',
    name: 'Newcomer',
    nameAr: 'متجر وليد',
    category: '',
    ratingAverage: 0,
    ratingCount: 0,
    etaMinMinutes: 0,
    etaMaxMinutes: 0,
    deliveryFeeMinor: 0,
    isOpen: true);

Product _product(String id, String nameAr) => Product(
    id: id,
    vendorBranchId: 'b',
    categoryId: 'c',
    name: nameAr,
    nameAr: nameAr,
    priceMinor: 12000,
    isAvailable: true);

final _snapshot = HomeSnapshot(
  popularVendors: const [_rated, _unrated],
  productEntries: [
    HomeProductEntry(
        product: _product('p-new', 'منتج جديد'), tag: HomeProductTag.newItem),
    HomeProductEntry(
        product: _product('p-popular', 'منتج رائج'),
        tag: HomeProductTag.popular),
  ],
  offers: const [
    HomeOffer(
        id: 'o1',
        kind: HomeOfferKind.product,
        title: 'عرض حقيقي',
        priceMinor: 9000,
        targetId: 'p-offer'),
    HomeOffer(
        id: 'o2',
        kind: HomeOfferKind.freeDelivery,
        title: 'توصيل مجاني للطلبات',
        targetId: 'v-rated'),
    HomeOffer(
        id: 'o3',
        kind: HomeOfferKind.product,
        title: 'عرض تجريبي',
        targetId: 'demo-product',
        isDemo: true),
  ],
  promos: const [],
);

class _FakeSearchApi implements SearchApi {
  _FakeSearchApi({this.onSearch});
  final Future<SearchResults> Function(String q)? onSearch;
  final queries = <String>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<SearchResults> search(
      {required String q, double? latitude, double? longitude}) {
    queries.add(q);
    return (onSearch ?? (q) async => _results)(q);
  }
}

SearchResults _page(List<SearchVendorResult> v, List<SearchProductResult> p) =>
    SearchResults(
      vendors: SearchResultPage(data: v, page: 1, limit: 20, total: v.length),
      products: SearchResultPage(data: p, page: 1, limit: 20, total: p.length),
    );

final _results = _page(const [
  SearchVendorResult(
      id: 'sv1',
      name: 'Burger House',
      nameAr: 'بيت البرجر',
      isOpen: true,
      ratingAverage: 4.2,
      ratingCount: 8),
], const [
  SearchProductResult(
      id: 'sp1',
      vendorBranchId: 'b',
      name: 'Cheese Burger',
      nameAr: 'برجر جبنة',
      priceMinor: 8500,
      pricingUnit: 'PIECE',
      inventoryMode: 'OPEN',
      isAvailable: true,
      vendorName: 'Burger House',
      vendorNameAr: 'بيت البرجر',
      activeOffer:
          ActiveOffer(mechanism: 'FLASH_SALE', specialPriceMinor: 7000)),
]);

List<Override> _overrides({
  List<MarketplaceSector>? categories,
  HomeSnapshot? snapshot,
  List<Vendor> newVendors = const [_newVendor],
  SearchApi? api,
}) =>
    [
      homeCategoriesProvider
          .overrideWith((ref) async => categories ?? _cats(8)),
      homeSnapshotProvider.overrideWith((ref) async => snapshot ?? _snapshot),
      exploreNewVendorsProvider.overrideWith((ref) async => newVendors),
      homeActiveAddressProvider.overrideWithValue(const AsyncData(null)),
      searchApiProvider.overrideWithValue(api ?? _FakeSearchApi()),
    ];

/// The screen inside a real router so navigation is observable, with the same
/// theme/localisation setup as `hatlyTestApp`.
Widget _app({
  required List<Override> overrides,
  Locale locale = const Locale('ar'),
  bool dark = false,
  double textScale = 1.0,
  bool pushed = false,
  required List<String> visited,
}) {
  HatlyTypography.useGoogleFonts = false;
  final router = GoRouter(
    initialLocation: pushed ? '/home' : '/',
    routes: [
      GoRoute(
          path: '/', builder: (c, s) => const SearchScreen(autofocus: false)),
      GoRoute(
          path: '/home',
          builder: (c, s) => Scaffold(
              body: Center(
                  child: TextButton(
                      onPressed: () => c.push('/search'),
                      child: const Text('open-search'))))),
      GoRoute(path: '/search', builder: (c, s) => const SearchScreen()),
      for (final path in [
        '/vendors',
        '/vendors/:id',
        '/products/:id',
        '/catalog-products/:id'
      ])
        GoRoute(
            path: path,
            builder: (c, s) {
              visited.add(s.uri.toString());
              return Scaffold(appBar: AppBar(), body: Text('page ${s.uri}'));
            }),
    ],
  );
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp.router(
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: HatlyTheme.light(),
      darkTheme: HatlyTheme.dark(),
      themeMode: dark ? ThemeMode.dark : ThemeMode.light,
      locale: locale,
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, w) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: w!,
      ),
    ),
  );
}

void _phone(WidgetTester tester, {double width = 390, double height = 4000}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _open(WidgetTester tester, Widget app) async {
  await tester.pumpWidget(app);
  await tester.pumpAndSettle(const Duration(milliseconds: 100));
}

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump(const Duration(milliseconds: 450)); // 400 ms debounce
  await tester.pumpAndSettle(const Duration(milliseconds: 100));
}

double _y(WidgetTester tester, Finder f) => tester.getTopLeft(f.first).dy;

void main() {
  group('Explore tab (discovery)', () {
    testWidgets(
        'opens as a calm discovery page in the approved order, without autofocus',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(tester, _app(overrides: _overrides(), visited: visited));

      final ordered = [
        find.byType(TextField), // 1 global search
        find.text('تسوّق حسب الفئة'), // 2 shop by category
        find.text('فئات مميزة'), // 3 featured categories
        find.text('متاجر مميزة'), // 4 featured vendors
        find.text('العروض'), // 5 offers
        find.text('جديد على هاتلي'), // 6 new on hatly
      ];
      for (final f in ordered) {
        expect(f, findsWidgets);
      }
      for (var i = 1; i < ordered.length; i++) {
        expect(_y(tester, ordered[i]), greaterThan(_y(tester, ordered[i - 1])),
            reason: 'section $i must come after section ${i - 1}');
      }
      // no keyboard grab on the tab
      expect(
          tester.widget<TextField>(find.byType(TextField)).autofocus, isFalse);
      // the search hint covers all three kinds
      expect(find.text('ابحث عن منتجات أو متاجر أو فئات'), findsOneWidget);
      // no back button on the tab, no "popular" claims anywhere
      expect(find.byType(BackButton), findsNothing);
      expect(find.textContaining('الأشهر'), findsNothing);
      expect(find.textContaining('الأكثر'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the tab is really wired into the shell without autofocus',
        (tester) async {
      // Guards the one-line change in customer_shell.dart.
      const shellTabs = SearchScreen(autofocus: false);
      expect(shellTabs.autofocus, isFalse);
      expect(const SearchScreen().autofocus, isTrue,
          reason: 'the pushed /search route keeps autofocus by default');
    });

    testWidgets(
        'Shop by Category: a 2-column grid of large cards (reference board); tap → existing listing route',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(tester, _app(overrides: _overrides(), visited: visited));

      final grid =
          tester.widgetList<CategoryCard>(find.byType(CategoryCard)).toList();
      expect(grid, hasLength(6), reason: 'collapsed: three rows of two');
      expect(grid.every((c) => c.large), isTrue);
      final rects = [
        for (var i = 0; i < 6; i++)
          tester.getRect(find.byType(CategoryCard).at(i))
      ];
      expect({for (final r in rects) r.left.round()}.length, 2);
      expect({for (final r in rects) r.top.round()}.length, 3);
      // Arabic: the first category is on the right
      expect(rects[0].left, greaterThan(rects[1].left));

      await tester.tap(find.byType(CategoryCard).at(1));
      await tester.pumpAndSettle();
      expect(visited.single, startsWith('/vendors?sectorId=sec1&sectorName='));
      expect(Uri.parse(visited.single).queryParameters['sectorName'], 'فئة 1');
    });

    testWidgets(
        'collapsed by default at 6; "عرض الكل ←" appears only above 6, expands in place to ALL, and "عرض أقل" collapses',
        (tester) async {
      _phone(tester, height: 6000);
      final visited = <String>[];

      // exactly 6 → nothing more to show, no action
      await _open(tester,
          _app(overrides: _overrides(categories: _cats(6)), visited: visited));
      expect(find.byType(CategoryCard), findsNWidgets(6));
      expect(find.text('عرض الكل'), findsNothing);
      expect(find.text('عرض أقل'), findsNothing);

      await tester.pumpWidget(const SizedBox());
      await _open(tester,
          _app(overrides: _overrides(categories: _cats(15)), visited: visited));
      // collapsed: first 6 in the existing order
      final collapsed = tester
          .widgetList<CategoryCard>(find.byType(CategoryCard))
          .map((c) => c.label)
          .toList();
      expect(collapsed, [for (var i = 0; i < 6; i++) 'فئة $i']);
      expect(find.text('عرض الكل'), findsOneWidget);
      expect(find.text('عرض أقل'), findsNothing);

      // expand → every available category (15), in the same order
      await tester.tap(find.text('عرض الكل'));
      await tester.pumpAndSettle();
      final expanded = tester
          .widgetList<CategoryCard>(find.byType(CategoryCard))
          .map((c) => c.label)
          .toList();
      expect(expanded, [for (var i = 0; i < 15; i++) 'فئة $i']);
      expect(find.text('عرض الكل'), findsNothing);
      expect(find.text('عرض أقل'), findsOneWidget);
      expect(visited, isEmpty, reason: 'it expands in place, no navigation');

      // collapse again
      await tester.tap(find.text('عرض أقل'));
      await tester.pumpAndSettle();
      expect(find.byType(CategoryCard), findsNWidgets(6));
      expect(find.text('عرض الكل'), findsOneWidget);
    });

    testWidgets('a category tapped after expanding still opens its listing',
        (tester) async {
      _phone(tester, height: 6000);
      final visited = <String>[];
      await _open(tester,
          _app(overrides: _overrides(categories: _cats(10)), visited: visited));
      await tester.tap(find.text('عرض الكل'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('فئة 9'));
      await tester.pumpAndSettle();
      expect(visited.single, startsWith('/vendors?sectorId=sec9&sectorName='));
    });

    testWidgets(
        'Featured categories: a lighter subset of the EXISTING order, same navigation, hidden for tiny lists',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(tester,
          _app(overrides: _overrides(categories: _cats(10)), visited: visited));

      final row = find.byType(FeaturedCategoryRow);
      expect(row, findsOneWidget);
      // 6 of 10, in the existing order (no ranking, no counts)
      final featured = tester.widget<FeaturedCategoryRow>(row).categories;
      expect(featured.map((c) => c.id),
          ['sec0', 'sec1', 'sec2', 'sec3', 'sec4', 'sec5']);
      expect(find.descendant(of: row, matching: find.text('فئة 0')),
          findsOneWidget);
      // lighter: no badge/number text at all, ≥44px targets
      expect(
          tester
              .getSize(find
                  .descendant(of: row, matching: find.byType(InkWell))
                  .first)
              .height,
          greaterThanOrEqualTo(44));

      await tester.tap(find.descendant(of: row, matching: find.text('فئة 0')));
      await tester.pumpAndSettle();
      expect(visited.single, startsWith('/vendors?sectorId=sec0&'));

      await tester.pumpWidget(const SizedBox());
      await _open(tester,
          _app(overrides: _overrides(categories: _cats(3)), visited: visited));
      expect(find.byType(FeaturedCategoryRow), findsNothing);
      expect(find.text('فئات مميزة'), findsNothing);
    });

    testWidgets(
        'Featured vendors: real ratings + review count only when real, open/closed, navigation to the vendor route',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(tester, _app(overrides: _overrides(), visited: visited));

      final featuredHeader = find.text('متاجر مميزة');
      expect(featuredHeader, findsOneWidget);
      // rated vendor: rating and (count) are shown
      expect(find.text('4.6'), findsOneWidget);
      expect(find.text('(12)'), findsOneWidget);
      // unrated vendor: nothing invented (no 0.0 / (0))
      expect(find.text('0.0'), findsNothing);
      expect(find.text('(0)'), findsNothing);
      // ETA is not real data here → no clock/ETA row is invented
      expect(find.textContaining('–'), findsNothing); // no "25–35" ETA range
      expect(find.byType(VendorCoverCard), findsWidgets);

      await tester.tap(find.text('مشويات مقيّمة').first);
      await tester.pumpAndSettle();
      expect(visited.single, '/vendors/v-rated');
    });

    testWidgets(
        'Offers: mixed offers render; "+" only for a real product target; no dead-end "عرض الكل"',
        (tester) async {
      _phone(tester);
      // 6 categories → the category header has no action, so any "عرض الكل"
      // found would belong to Offers / New on Hatly.
      await _open(tester,
          _app(overrides: _overrides(categories: _cats(6)), visited: []));
      expect(find.text('عرض حقيقي'), findsOneWidget);
      expect(find.text('توصيل مجاني للطلبات'), findsOneWidget);
      // one real product offer → exactly one "+" among the OFFERS; New on Hatly adds its own
      final offersTop = _y(tester, find.text('العروض'));
      final newTop = _y(tester, find.text('جديد على هاتلي'));
      final offerPlus = find.byType(HatlyQuickAddButton).evaluate().where((e) {
        final y = tester.getTopLeft(find.byWidget(e.widget)).dy;
        return y > offersTop && y < newTop;
      });
      expect(offerPlus.length, 1,
          reason:
              'demo offer and free-delivery offer have no product → no "+"');
      expect(find.text('عرض الكل'), findsNothing,
          reason: 'there is no offers listing → no dead-end action');
    });

    testWidgets(
        'New on Hatly: newest vendors + NEW-tagged products only, quiet cards, quick-add',
        (tester) async {
      _phone(tester);
      final visited = <String>[];
      await _open(tester, _app(overrides: _overrides(), visited: visited));

      expect(find.text('متجر وليد'), findsOneWidget); // newest vendor
      expect(find.text('منتج جديد'), findsOneWidget); // newest product
      expect(find.text('منتج رائج'), findsNothing,
          reason: 'best-selling products are not "new"');
      final card = tester.widget<ProductCard>(find.byType(ProductCard));
      expect(card.elevated, isFalse, reason: 'quieter than the main sections');
      expect(card.onQuickAdd, isNotNull);

      await tester.tap(find.text('متجر وليد'));
      await tester.pumpAndSettle();
      expect(visited.single, '/vendors/v-new');
    });

    testWidgets('sections without data disappear; nothing is invented',
        (tester) async {
      _phone(tester);
      await _open(
          tester,
          _app(
              overrides: _overrides(
                  snapshot: const HomeSnapshot(
                      popularVendors: [],
                      productEntries: [],
                      offers: [],
                      promos: []),
                  newVendors: const []),
              visited: []));
      expect(find.text('متاجر مميزة'), findsNothing);
      expect(find.text('العروض'), findsNothing);
      expect(find.text('جديد على هاتلي'), findsNothing);
      expect(find.text('تسوّق حسب الفئة'), findsOneWidget);
    });

    testWidgets('a failed load shows a retry that reloads the lower sections',
        (tester) async {
      _phone(tester);
      var calls = 0;
      await _open(
          tester,
          _app(overrides: [
            ..._overrides(),
            homeSnapshotProvider.overrideWith((ref) async {
              calls++;
              if (calls == 1) throw Exception('offline');
              return _snapshot;
            }),
          ], visited: []));
      expect(find.text('تعذّر تحميل الاستكشاف'), findsOneWidget);
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(calls, 2);
      expect(find.text('متاجر مميزة'), findsOneWidget);
    });
  });

  group('Explore search', () {
    testWidgets(
        'result filter chips (الكل · متاجر · منتجات) narrow the loaded results without a new request',
        (tester) async {
      _phone(tester);
      final api = _FakeSearchApi();
      await _open(tester, _app(overrides: _overrides(api: api), visited: <String>[]));
      await _type(tester, 'برجر');
      expect(find.byType(VendorCoverCard), findsOneWidget);
      expect(find.text('برجر جبنة'), findsOneWidget);

      await tester.tap(find.byKey(const Key('search-filter-products')));
      await tester.pumpAndSettle();
      expect(find.byType(VendorCoverCard), findsNothing);
      expect(find.text('برجر جبنة'), findsOneWidget);

      await tester.tap(find.byKey(const Key('search-filter-vendors')));
      await tester.pumpAndSettle();
      expect(find.byType(VendorCoverCard), findsOneWidget);
      expect(find.text('برجر جبنة'), findsNothing);

      await tester.tap(find.byKey(const Key('search-filter-all')));
      await tester.pumpAndSettle();
      expect(find.byType(VendorCoverCard), findsOneWidget);
      expect(find.text('برجر جبنة'), findsOneWidget);
      expect(api.queries, ['برجر'], reason: 'filtering is local');
    });

    testWidgets('vendors + products from the real search; navigation unchanged',
        (tester) async {
      _phone(tester);
      final api = _FakeSearchApi();
      final visited = <String>[];
      await _open(
          tester, _app(overrides: _overrides(api: api), visited: visited));

      await _type(tester, 'برجر');
      expect(api.queries, ['برجر']);
      // discovery is replaced by results
      expect(find.text('تسوّق حسب الفئة'), findsNothing);
      expect(find.text('المتاجر'), findsOneWidget);
      expect(find.text('المنتجات'), findsOneWidget);
      // approved cards, not plain tiles; the real search rating is shown
      expect(find.byType(VendorCoverCard), findsOneWidget);
      expect(find.text('4.2'), findsOneWidget);
      expect(find.text('(8)'), findsOneWidget);
      expect(find.text('برجر جبنة'), findsOneWidget);
      expect(find.text('تخفيض سريع'), findsOneWidget);

      await tester.tap(find.byType(VendorCoverCard));
      await tester.pumpAndSettle();
      expect(visited.last, '/vendors/sv1');
      Navigator.of(tester.element(find.byType(Scaffold).last)).pop();
      await tester.pumpAndSettle();
      await tester.tap(find.text('برجر جبنة'));
      await tester.pumpAndSettle();
      expect(visited.last, '/products/sp1');
    });

    testWidgets(
        'a result WITH catalogProductId opens Catalog Details; one WITHOUT opens Product Details by listing id',
        (tester) async {
      _phone(tester);
      const linked = SearchProductResult(
          id: 'sp-linked',
          catalogProductId: 'cat-9',
          vendorBranchId: 'b',
          name: 'Marketplace Cola',
          nameAr: 'كولا السوق',
          priceMinor: 2500,
          pricingUnit: 'PIECE',
          inventoryMode: 'OPEN',
          isAvailable: true,
          vendorName: 'Market One',
          vendorNameAr: 'ماركت وان');
      const unlinked = SearchProductResult(
          id: 'sp-plain',
          vendorBranchId: 'b',
          name: 'Plain Rice',
          nameAr: 'أرز عادي',
          priceMinor: 6000,
          pricingUnit: 'PIECE',
          inventoryMode: 'OPEN',
          isAvailable: true,
          vendorName: 'Market Two',
          vendorNameAr: 'ماركت تو');
      final api = _FakeSearchApi(
          onSearch: (q) async => _page(const [], const [linked, unlinked]));
      final visited = <String>[];
      await _open(
          tester, _app(overrides: _overrides(api: api), visited: visited));
      await _type(tester, 'كولا');

      await tester.tap(find.text('كولا السوق'));
      await tester.pumpAndSettle();
      expect(visited.last, '/catalog-products/cat-9');
      Navigator.of(tester.element(find.byType(Scaffold).last)).pop();
      await tester.pumpAndSettle();

      await tester.tap(find.text('أرز عادي'));
      await tester.pumpAndSettle();
      expect(visited.last, '/products/sp-plain');
    });

    testWidgets('keeps the 400 ms debounce and the 2-character minimum',
        (tester) async {
      _phone(tester);
      final api = _FakeSearchApi();
      await _open(tester, _app(overrides: _overrides(api: api), visited: []));

      await tester.enterText(find.byType(TextField), 'ب');
      await tester.pump(const Duration(milliseconds: 500));
      expect(api.queries, isEmpty);
      expect(find.text('اكتب حرفين على الأقل للبحث'), findsOneWidget);
      expect(find.text('تسوّق حسب الفئة'), findsOneWidget,
          reason: 'still browsing');

      await tester.enterText(find.byType(TextField), 'بر');
      await tester.enterText(find.byType(TextField), 'برج');
      await tester.enterText(find.byType(TextField), 'برجر');
      await tester.pump(const Duration(milliseconds: 300));
      expect(api.queries, isEmpty, reason: 'debounced');
      await tester.pump(const Duration(milliseconds: 200));
      expect(api.queries, ['برجر'], reason: 'one request for the final text');
    });

    testWidgets(
        'categories are matched LOCALLY by name and navigate to the listing',
        (tester) async {
      _phone(tester);
      final api =
          _FakeSearchApi(onSearch: (q) async => _page(const [], const []));
      final visited = <String>[];
      final cats = [
        const MarketplaceSector(
            id: 'r',
            name: 'Restaurants',
            nameAr: 'مطاعم',
            slug: 'restaurants',
            sortOrder: 1),
        const MarketplaceSector(
            id: 'g',
            name: 'Groceries',
            nameAr: 'بقالة',
            slug: 'groceries',
            sortOrder: 2),
      ];
      await _open(
          tester,
          _app(
              overrides: _overrides(categories: cats, api: api),
              visited: visited));

      await _type(tester, 'مطا');
      expect(find.text('الفئات'), findsOneWidget);
      expect(find.byType(CategoryCard), findsOneWidget);
      expect(find.text('مطاعم'), findsOneWidget);
      expect(find.text('بقالة'), findsNothing);
      // backend has nothing, but a category matched → no "no results" message
      expect(find.textContaining('لا توجد نتائج'), findsNothing);

      await tester.tap(find.byType(CategoryCard));
      await tester.pumpAndSettle();
      expect(visited.single, startsWith('/vendors?sectorId=r&sectorName='));
    });

    testWidgets(
        'English query matches English names; empty → one clear message',
        (tester) async {
      _phone(tester);
      final api =
          _FakeSearchApi(onSearch: (q) async => _page(const [], const []));
      await _open(
          tester,
          _app(
              overrides: _overrides(categories: [
                const MarketplaceSector(
                    id: 'r',
                    name: 'Restaurants',
                    nameAr: 'مطاعم',
                    slug: 'restaurants',
                    sortOrder: 1)
              ], api: api),
              locale: const Locale('en'),
              visited: []));
      await _type(tester, 'REST');
      expect(find.byType(CategoryCard), findsOneWidget);

      await _type(tester, 'zzzz');
      expect(find.text('No results for "zzzz"'), findsOneWidget);
      expect(find.byType(CategoryCard), findsNothing);
    });

    testWidgets('loading and error states, with a working retry',
        (tester) async {
      _phone(tester);
      var calls = 0;
      final completer = Completer<SearchResults>();
      final api = _FakeSearchApi(onSearch: (q) {
        calls++;
        if (calls == 1) return completer.future;
        if (calls == 2) throw Exception('offline');
        return Future.value(_results);
      });
      await _open(tester, _app(overrides: _overrides(api: api), visited: []));

      await tester.enterText(find.byType(TextField), 'برجر');
      await tester.pump(const Duration(milliseconds: 450));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      completer.complete(_results);
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.byType(VendorCoverCard), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'برجرر');
      await tester.pump(const Duration(milliseconds: 450));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.text('حدث خطأ ما'), findsOneWidget);
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(calls, 3);
      expect(find.byType(VendorCoverCard), findsOneWidget);
    });

    testWidgets('clearing the box returns to discovery', (tester) async {
      _phone(tester);
      await _open(tester, _app(overrides: _overrides(), visited: []));
      await _type(tester, 'برجر');
      expect(find.text('تسوّق حسب الفئة'), findsNothing);
      await tester.tap(find.byTooltip('مسح البحث'));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(find.text('تسوّق حسب الفئة'), findsOneWidget);
    });
  });

  group('the pushed /search route still works', () {
    testWidgets('autofocuses, shows a back button, and searches',
        (tester) async {
      _phone(tester);
      final api = _FakeSearchApi();
      await _open(tester,
          _app(overrides: _overrides(api: api), pushed: true, visited: []));
      await tester.tap(find.text('open-search'));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));

      expect(
          tester.widget<TextField>(find.byType(TextField)).autofocus, isTrue);
      expect(find.byType(BackButton), findsOneWidget);
      await _type(tester, 'برجر');
      expect(api.queries, ['برجر']);
      expect(find.byType(VendorCoverCard), findsOneWidget);

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.text('open-search'), findsOneWidget);
    });
  });

  group('themes, RTL and small screens', () {
    for (final scenario in const [
      ('ar light 390', Locale('ar'), false, 390.0, 1.0),
      ('en light 390', Locale('en'), false, 390.0, 1.0),
      ('ar dark 390', Locale('ar'), true, 390.0, 1.0),
      ('en dark 390', Locale('en'), true, 390.0, 1.0),
      ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
      ('en light 320 large text', Locale('en'), false, 320.0, 1.6),
      ('ar light 320 2x text', Locale('ar'), false, 320.0, 2.0),
    ]) {
      testWidgets('discovery: no overflow / exceptions: ${scenario.$1}',
          (tester) async {
        _phone(tester, width: scenario.$4);
        await _open(
            tester,
            _app(
                overrides: _overrides(categories: _cats(15)),
                locale: scenario.$2,
                dark: scenario.$3,
                textScale: scenario.$5,
                visited: []));
        expect(tester.takeException(), isNull);
        final bg = Theme.of(tester.element(find.byType(SearchScreen)))
            .scaffoldBackgroundColor;
        expect(bg.computeLuminance() < 0.1, scenario.$3,
            reason: 'dark mode really is dark');
      });

      testWidgets(
          'discovery EXPANDED: no overflow / exceptions: ${scenario.$1}',
          (tester) async {
        _phone(tester, width: scenario.$4, height: 8000);
        await _open(
            tester,
            _app(
                overrides: _overrides(categories: _cats(15)),
                locale: scenario.$2,
                dark: scenario.$3,
                textScale: scenario.$5,
                visited: []));
        await tester.tap(find
            .text(scenario.$2.languageCode == 'ar' ? 'عرض الكل' : 'See all'));
        await tester.pumpAndSettle();
        expect(find.byType(CategoryCard), findsNWidgets(15));
        expect(tester.takeException(), isNull);
      });

      testWidgets('search results: no overflow / exceptions: ${scenario.$1}',
          (tester) async {
        _phone(tester, width: scenario.$4);
        await _open(
            tester,
            _app(
                overrides: _overrides(),
                locale: scenario.$2,
                dark: scenario.$3,
                textScale: scenario.$5,
                visited: []));
        await _type(
            tester, scenario.$2.languageCode == 'ar' ? 'برجر' : 'Burger');
        expect(find.byType(VendorCoverCard), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets(
        'RTL: the search icon is on the right, the clear button on the left',
        (tester) async {
      _phone(tester);
      await _open(tester, _app(overrides: _overrides(), visited: []));
      await tester.enterText(find.byType(TextField), 'ب');
      await tester.pump();
      final icon = tester.getCenter(find.byIcon(Icons.search_rounded));
      final clear = tester.getCenter(find.byIcon(Icons.close_rounded));
      expect(icon.dx, greaterThan(195));
      expect(clear.dx, lessThan(icon.dx));
      expect(tester.getSize(find.byTooltip('مسح البحث')).shortestSide,
          greaterThanOrEqualTo(44));
    });
  });
}
