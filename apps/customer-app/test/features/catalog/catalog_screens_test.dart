import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/catalog/data/catalog_providers.dart';
import 'package:hatly_customer/features/catalog/data/catalog_repository.dart';
import 'package:hatly_customer/features/catalog/domain/catalog_product.dart';
import 'package:hatly_customer/features/catalog/presentation/catalog_product_details_screen.dart';
import 'package:hatly_customer/features/catalog/presentation/widgets/vendor_listing_card.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/products/domain/product.dart';

import '../../support/router_test_app.dart';

class _FakeCatalogRepo implements CatalogRepository {
  _FakeCatalogRepo({this.details});

  final CatalogProductDetails? details;

  @override
  Future<CatalogProductDetails> getCatalogProduct(String catalogProductId,
      {double? latitude, double? longitude}) async {
    return details!;
  }
}

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
}
