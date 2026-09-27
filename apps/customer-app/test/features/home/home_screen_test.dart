import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/addresses/domain/saved_address.dart';
import 'package:hatly_customer/features/auth/presentation/phone_verification_prompt_controller.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/home/data/home_demo_content.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/data/home_address_provider.dart';
import 'package:hatly_customer/features/home/presentation/home_screen.dart';
import 'package:hatly_customer/features/home/presentation/widgets/category_card.dart';
import 'package:hatly_customer/features/home/presentation/widgets/promo_carousel.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/vendor_cover_card.dart';
import 'package:hatly_customer/shared_widgets/hatly_search_bar.dart';

import '../../support/test_app.dart';

class _EmptyCartApi implements CartApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Cart> getCart() async => const Cart(
        id: 'c',
        fulfillmentType: 'DELIVERY',
        groups: [],
        subtotalMinor: 0,
        hasUnpricedItems: false,
        readyForCheckout: false,
      );
}

final _snapshot = HomeSnapshot(
  popularVendors: demoVendors(),
  productEntries: demoProductEntries(),
  offers: demoOffers(),
  promos: demoPromos(),
);

List<Override> _overrides({
  Future<HomeSnapshot> Function()? snapshot,
  Future<List<MarketplaceSector>> Function()? categories,
  SavedAddress? address,
}) {
  return [
    homeCategoriesProvider
        .overrideWith((ref) => (categories ?? () async => demoCategories())()),
    homeSnapshotProvider
        .overrideWith((ref) => (snapshot ?? () async => _snapshot)()),
    homeActiveAddressProvider.overrideWithValue(AsyncData(address)),
    phoneVerificationStatusProvider.overrideWith((ref) async => true),
    cartApiProvider.overrideWithValue(_EmptyCartApi()),
  ];
}

void _phone(WidgetTester tester, {double width = 390, double height = 3200}) {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets(
      'renders the approved sections in the approved ORDER (RTL Arabic)',
      (tester) async {
    _phone(tester);
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(),
        overrides: _overrides(
            address: const SavedAddress(
                id: 'a',
                label: 'المنزل',
                line1: 'x',
                latitude: 1,
                longitude: 1))));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    double y(Finder f) => tester.getTopLeft(f.first).dy;
    final ordered = [
      find.text('المنزل'), // 1 location
      find.byType(HatlySearchBar), // 2 search
      find.byType(PromoCarousel), // 3 promo carousel
      find.text('تسوّق حسب الفئة'), // 4 categories
      find.text('العروض'), // 5 offers
      find.text('الأكثر طلبًا والجديد'), // 6 popular & new
    ];
    for (final f in ordered) {
      expect(f, findsWidgets);
    }
    for (var i = 1; i < ordered.length; i++) {
      expect(y(ordered[i]), greaterThan(y(ordered[i - 1])),
          reason: 'section $i must come after section ${i - 1}');
    }
    expect(find.text('بتدور على إيه؟'), findsOneWidget);
    // two "عرض الكل ←" links: offers, popular & new — categories have none (≤ 12)
    expect(find.text('عرض الكل'), findsNWidgets(2));
    // Popular Near You is gone from Home, even though the snapshot still carries vendors
    expect(find.text('الأشهر بالقرب منك'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'Offers and Popular & New show mixed content; there is no vendor section on Home',
      (tester) async {
    _phone(tester);
    await tester
        .pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides()));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));

    expect(find.byType(VendorCoverCard), findsNothing);
    // offer kinds present in the row
    expect(find.text('عرض سريع'), findsWidgets);
    expect(find.text('توصيل مجاني'), findsWidgets);
    expect(find.text('باكدج'), findsWidgets);
    // popular & new tags
    expect(find.text('جديد'), findsWidgets);
    // "Popular" is not repeated as a badge on every card — the section says it
    expect(find.text('الأكثر طلبًا'), findsNothing);
  });

  testWidgets(
      'the top area is light: location keeps ONE shortcut (Favorites); Profile is only in the bottom nav',
      (tester) async {
    _phone(tester);
    await tester
        .pumpWidget(hatlyTestApp(const HomeScreen(), overrides: _overrides()));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byIcon(Icons.favorite_border_rounded), findsOneWidget);
    expect(find.byIcon(Icons.person_outline_rounded), findsNothing);
  });

  testWidgets(
      'the category grid is data-driven: the rendered order follows the provider list',
      (tester) async {
    _phone(tester);
    final custom = [
      const MarketplaceSector(
          id: '1', name: 'B', nameAr: 'ب', slug: 'b', sortOrder: 1),
      const MarketplaceSector(
          id: '2', name: 'A', nameAr: 'أ', slug: 'a', sortOrder: 2),
    ];
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(),
        overrides: _overrides(categories: () async => custom)));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    final labels = tester
        .widgetList<CategoryCard>(find.byType(CategoryCard))
        .map((c) => c.label)
        .toList();
    expect(labels, ['ب', 'أ']);
  });

  testWidgets(
      'sections without data disappear (no empty shells): empty snapshot leaves location + search + categories only',
      (tester) async {
    _phone(tester);
    await tester.pumpWidget(hatlyTestApp(
      const HomeScreen(),
      overrides: _overrides(
          snapshot: () async => const HomeSnapshot(
              popularVendors: [], productEntries: [], offers: [], promos: [])),
    ));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byType(PromoCarousel), findsNothing);
    expect(find.text('العروض'), findsNothing);
    expect(find.text('الأكثر طلبًا والجديد'), findsNothing);
    expect(find.text('تسوّق حسب الفئة'), findsOneWidget);
  });

  testWidgets(
      'loading shows skeletons (search is already usable); an error shows a retry that reloads',
      (tester) async {
    _phone(tester);
    final completer = Completer<HomeSnapshot>();
    await tester.pumpWidget(hatlyTestApp(const HomeScreen(),
        overrides: _overrides(snapshot: () => completer.future)));
    await tester.pump();
    expect(find.byType(HatlySearchBar), findsOneWidget);
    expect(find.byType(PromoCarousel), findsNothing);
    completer.complete(_snapshot);
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.byType(PromoCarousel), findsOneWidget);

    var calls = 0;
    await tester.pumpWidget(
        const SizedBox()); // drop the previous ProviderScope so the new overrides take effect
    await tester.pumpWidget(hatlyTestApp(
      const HomeScreen(),
      overrides: _overrides(snapshot: () async {
        calls++;
        if (calls == 1) throw Exception('offline');
        return _snapshot;
      }),
    ));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(find.text('حدث خطأ ما'), findsWidgets);
    await tester.tap(find.text('إعادة المحاولة'));
    await tester.pumpAndSettle(const Duration(milliseconds: 100));
    expect(calls, 2);
    expect(find.byType(PromoCarousel), findsOneWidget);
  });

  for (final scenario in const [
    ('ar light 390', Locale('ar'), false, 390.0, 1.0),
    ('en light 390', Locale('en'), false, 390.0, 1.0),
    ('ar dark 390', Locale('ar'), true, 390.0, 1.0),
    ('ar dark 320 large text', Locale('ar'), true, 320.0, 1.6),
    ('en light 320 large text', Locale('en'), false, 320.0, 1.6),
  ]) {
    testWidgets('no overflow / exceptions: ${scenario.$1}', (tester) async {
      _phone(tester, width: scenario.$4);
      await tester.pumpWidget(hatlyTestApp(const HomeScreen(),
          overrides: _overrides(),
          locale: scenario.$2,
          dark: scenario.$3,
          textScale: scenario.$5));
      await tester.pumpAndSettle(const Duration(milliseconds: 100));
      expect(tester.takeException(), isNull);
      // dark mode really is dark
      final bg = tester
              .widget<Scaffold>(find.byType(Scaffold).first)
              .backgroundColor ??
          Theme.of(tester.element(find.byType(HomeScreen)))
              .scaffoldBackgroundColor;
      expect(bg.computeLuminance() < 0.1, scenario.$3);
    });
  }

  testWidgets(
      'demo content is what the demo provider says: HomeSnapshot only carries HomeContent types, no backend model changes needed',
      (tester) async {
    expect(_snapshot.offers.map((o) => o.kind).toSet(),
        containsAll(HomeOfferKind.values));
    expect(_snapshot.promos.map((p) => p.kind).toSet(),
        containsAll(HomePromoKind.values));
  });
}
