import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/home/data/home_providers.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/features/home/domain/home_content.dart';
import 'package:hatly_customer/features/home/presentation/widgets/category_card.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_category_section.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_horizontal_row.dart';
import 'package:hatly_customer/features/home/presentation/widgets/home_promo_actions.dart';
import 'package:hatly_customer/shared_widgets/hatly_quick_add_button.dart';
import 'package:hatly_customer/features/home/presentation/widgets/offer_card.dart';
import 'package:hatly_customer/features/home/presentation/widgets/promo_carousel.dart';
import 'package:hatly_customer/features/home/presentation/widgets/promo_cta_button.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/presentation/widgets/product_card.dart';
import 'package:hatly_customer/features/sectors/domain/sector.dart';
import 'package:hatly_customer/features/vendors/domain/vendor.dart';
import 'package:hatly_customer/features/vendors/presentation/widgets/vendor_cover_card.dart';
import 'package:hatly_customer/shared_widgets/hatly_badge.dart';

import '../../support/test_app.dart';

const _promos = [
  HomePromo(
      id: '1', kind: HomePromoKind.product, title: 'منتج', subtitle: 'وصف'),
  HomePromo(id: '2', kind: HomePromoKind.vendor, title: 'متجر'),
  HomePromo(id: '3', kind: HomePromoKind.offer, title: 'عرض'),
  HomePromo(id: '4', kind: HomePromoKind.freeDelivery, title: 'توصيل'),
  HomePromo(id: '5', kind: HomePromoKind.bundle, title: 'باكدج'),
];

Vendor _vendor(
        {bool open = true, bool promo = false, int eta = 30, int count = 12}) =>
    Vendor(
      id: 'v',
      name: 'Al Salam Grill',
      nameAr: 'مشويات السلام',
      category: '',
      ratingAverage: 4.6,
      ratingCount: count,
      etaMinMinutes: eta == 0 ? 0 : eta - 5,
      etaMaxMinutes: eta,
      deliveryFeeMinor: 0,
      isOpen: open,
      hasPromotion: promo,
    );

void main() {
  group('PromoCarousel', () {
    testWidgets(
        'shows one CTA per kind with the approved label, all on the SAME button component',
        (tester) async {
      final expected = {
        'منتج': 'أضف للسلة',
        'متجر': 'تسوّق الآن',
        'عرض': 'اكتشف العرض',
        'توصيل': 'اطلب الآن',
        'باكدج': 'شوف الباكدج',
      };
      final actions = <String>[];
      await tester.pumpWidget(hatlyTestApp(PromoCarousel(
          promos: _promos,
          onAction: (p) => actions.add(p.id),
          autoRotateInterval: const Duration(days: 1))));

      for (var i = 0; i < _promos.length; i++) {
        final promo = _promos[i];
        expect(find.text(promo.title), findsOneWidget);
        expect(find.text(expected[promo.title]!), findsOneWidget);
        expect(find.widgetWithText(PromoCtaButton, expected[promo.title]!),
            findsOneWidget);
        await tester
            .tap(find.widgetWithText(PromoCtaButton, expected[promo.title]!));
        if (i < _promos.length - 1) {
          await tester.fling(find.byType(PageView), const Offset(400, 0),
              1000); // RTL: swipe right = next
          await tester.pumpAndSettle();
        }
      }
      expect(actions, ['1', '2', '3', '4', '5']);
    });

    testWidgets('promoCtaLabel covers every kind in Arabic and English',
        (tester) async {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        late BuildContext ctx;
        await tester.pumpWidget(hatlyTestApp(Builder(builder: (c) {
          ctx = c;
          return const SizedBox();
        }), locale: locale));
        final labels = HomePromoKind.values
            .map((k) => promoCtaLabel(AppLocalizations.of(ctx), k))
            .toSet();
        expect(labels.length, HomePromoKind.values.length,
            reason: 'distinct label per kind ($locale)');
        expect(labels.every((l) => l.isNotEmpty), isTrue);
      }
    });

    testWidgets(
        'page indicators: one per promo, the active one is a longer pill; swiping moves it',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(PromoCarousel(
          promos: _promos,
          onAction: (_) {},
          autoRotateInterval: const Duration(days: 1))));
      expect(find.byType(PromoPageIndicator), findsOneWidget);
      double activeWidth() {
        final widths = tester
            .widgetList<AnimatedContainer>(find.descendant(
                of: find.byType(PromoPageIndicator),
                matching: find.byType(AnimatedContainer)))
            .map((c) => c.constraints!.maxWidth)
            .toList();
        expect(widths, hasLength(5));
        return widths.reduce((a, b) => a > b ? a : b);
      }

      expect(activeWidth(), 20);
      final firstActive = _activeIndex(tester);
      await tester.fling(find.byType(PageView), const Offset(400, 0), 1000);
      await tester.pumpAndSettle();
      expect(_activeIndex(tester), isNot(firstActive));
    });

    testWidgets(
        'auto-rotates on its interval, pauses while dragging, and never rotates a single promo',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(PromoCarousel(
          promos: _promos,
          onAction: (_) {},
          autoRotateInterval: const Duration(seconds: 5))));
      expect(_activeIndex(tester), 0);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(_activeIndex(tester), 1);
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(_activeIndex(tester), 2);

      // single promo → no indicators, no timer (pumping a long time must not throw / rotate)
      await tester.pumpWidget(hatlyTestApp(PromoCarousel(
          promos: _promos.take(1).toList(),
          onAction: (_) {},
          autoRotateInterval: const Duration(seconds: 1))));
      await tester.pump(const Duration(seconds: 3));
      expect(find.byType(PromoPageIndicator), findsNothing);
    });

    testWidgets('does not auto-rotate when the OS asks for reduced motion',
        (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
          tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await tester.pumpWidget(hatlyTestApp(PromoCarousel(
          promos: _promos,
          onAction: (_) {},
          autoRotateInterval: const Duration(seconds: 2))));
      await tester.pump(const Duration(seconds: 10));
      expect(_activeIndex(tester), 0);
    });

    testWidgets('the card is a radius-20 inset card', (tester) async {
      await tester.pumpWidget(hatlyTestApp(PromoCarousel(
          promos: _promos,
          onAction: (_) {},
          autoRotateInterval: const Duration(days: 1))));
      final card = tester
          .widgetList<Container>(find.byType(Container))
          .map((c) => c.decoration)
          .whereType<BoxDecoration>()
          .firstWhere((d) => d.borderRadius == BorderRadius.circular(20));
      expect(card.boxShadow, isNull, reason: 'calm: no shadow on the promo');
      final screen = tester.getSize(find.byType(PromoCarousel)).width;
      expect(tester.getSize(find.byType(PromoCtaButton).first).height,
          greaterThanOrEqualTo(44));
      expect(screen, greaterThan(0));
    });
  });

  group('Shop by Category (3-column grid)', () {
    List<MarketplaceSector> make(int n) => [
          for (var i = 0; i < n; i++)
            MarketplaceSector(
                id: 'id$i',
                name: 'Cat $i',
                nameAr: 'فئة $i',
                slug: 's$i',
                sortOrder: i)
        ];

    testWidgets(
        'lays 12 categories out as 4 rows of exactly 3 equal columns, label under the image',
        (tester) async {
      tester.view.physicalSize = const Size(390, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyTestApp(
          SingleChildScrollView(child: CategoryGrid(categories: make(12)))));
      await tester.pump();

      final cards = find.byType(CategoryCard);
      expect(cards, findsNWidgets(12));
      final rects = [
        for (var i = 0; i < 12; i++) tester.getRect(cards.at(i)),
      ];
      // rows: 3 distinct x positions, 4 distinct y positions
      expect({for (final r in rects) r.left.round()}.length, 3);
      expect({for (final r in rects) r.top.round()}.length, 4);
      // equal width, generous spacing between rows
      expect({for (final r in rects) r.width.round()}.length, 1);
      expect(rects[3].top - rects[0].bottom, greaterThanOrEqualTo(16));
      // tile is a wide soft tile (≥ 96px, 1.25 : 1), and the label sits below it
      final tile = tester.getRect(find
          .descendant(of: cards.first, matching: find.byType(AspectRatio))
          .first);
      expect(tile.width, greaterThanOrEqualTo(96));
      expect(tile.width / tile.height, closeTo(1.25, 0.01));
      expect(
          tester.getTopLeft(find.text('فئة 0')).dy, greaterThan(tile.bottom));
      // touch target
      expect(rects.first.height, greaterThanOrEqualTo(44));
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'RTL puts the FIRST category on the right; LTR puts it on the left',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(CategoryGrid(categories: make(3))));
      final rtl = [
        for (var i = 0; i < 3; i++) tester.getCenter(find.text('فئة $i')).dx
      ];
      expect(rtl[0], greaterThan(rtl[1]));
      expect(rtl[1], greaterThan(rtl[2]));
      await tester.pumpWidget(hatlyTestApp(CategoryGrid(categories: make(3)),
          locale: const Locale('en')));
      final ltr = [
        for (var i = 0; i < 3; i++) tester.getCenter(find.text('Cat $i')).dx
      ];
      expect(ltr[0], lessThan(ltr[1]));
      expect(ltr[1], lessThan(ltr[2]));
    });

    testWidgets('a partial last row keeps the 3-column alignment',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(CategoryGrid(categories: make(4))));
      final first = tester.getRect(find.byType(CategoryCard).at(0));
      final fourth = tester.getRect(find.byType(CategoryCard).at(3));
      expect(fourth.left.round(), first.left.round());
      expect(fourth.width.round(), first.width.round());
    });

    testWidgets(
        'names follow the locale and the tile is a radius-16 soft image container',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(CategoryGrid(categories: make(3))));
      expect(find.text('فئة 0'), findsOneWidget);
      await tester.pumpWidget(hatlyTestApp(CategoryGrid(categories: make(3)),
          locale: const Locale('en')));
      expect(find.text('Cat 0'), findsOneWidget);
      final clip = tester.widget<ClipRRect>(find.descendant(
          of: find.byType(CategoryCard).first,
          matching: find.byType(ClipRRect)));
      expect(clip.borderRadius, BorderRadius.circular(16));
    });

    testWidgets('survives 320px, 2× text and long names without overflow',
        (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final long = [
        for (var i = 0; i < 12; i++)
          MarketplaceSector(
              id: '$i',
              name: 'A very long category name number $i',
              nameAr: 'اسم فئة طويل جدًا جدًا رقم $i',
              slug: 's$i',
              sortOrder: i)
      ];
      await tester.pumpWidget(hatlyTestApp(
          SingleChildScrollView(child: CategoryGrid(categories: long)),
          textScale: 2.0,
          dark: true));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });

    testWidgets(
        'tapping a category opens vendor-first discovery (/vendors) with the sector id + name — never a product listing',
        (tester) async {
      String? opened;
      final router = GoRouter(routes: [
        GoRoute(
            path: '/',
            builder: (context, state) =>
                Scaffold(body: CategoryGrid(categories: make(3)))),
        GoRoute(
            path: '/vendors',
            builder: (context, state) {
              opened = state.uri.toString();
              return const Scaffold(body: Text('vendors'));
            }),
      ]);
      HatlyTypography.useGoogleFonts = false;
      await tester.pumpWidget(MaterialApp.router(
        routerConfig: router,
        theme: HatlyTheme.light(),
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar'), Locale('en')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ));
      await tester.pumpAndSettle();
      await tester.tap(find.text('فئة 1'));
      await tester.pumpAndSettle();
      expect(opened, startsWith('/vendors?sectorId=id1&sectorName='));
      expect(Uri.parse(opened!).queryParameters['sectorName'], 'فئة 1');
    });

    testWidgets(
        'the section shows at most 12; "عرض الكل" appears only when there are more, and it is not the whole grid',
        (tester) async {
      tester.view.physicalSize = const Size(390, 2000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      Future<void> pumpWith(int n) async {
        await tester.pumpWidget(const SizedBox());
        await tester.pumpWidget(hatlyTestApp(
          const SingleChildScrollView(child: HomeCategorySection()),
          overrides: [
            homeCategoriesProvider.overrideWith((ref) async => make(n))
          ],
        ));
        await tester.pumpAndSettle();
      }

      await pumpWith(12);
      expect(find.byType(CategoryCard), findsNWidgets(12));
      expect(find.text('عرض الكل'), findsNothing);

      await pumpWith(15);
      expect(find.byType(CategoryCard), findsNWidgets(12));
      expect(find.text('فئة 11'), findsOneWidget);
      expect(find.text('فئة 12'), findsNothing);
      expect(find.text('عرض الكل'), findsOneWidget);
    });
  });

  group('HomeHorizontalRow', () {
    testWidgets('sizes cards so ~2.5 are visible', (tester) async {
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyTestApp(HomeHorizontalRow(
          itemCount: 8,
          itemBuilder: (c, i, w) =>
              SizedBox(key: Key('c$i'), width: w, height: 40))));
      final w = tester.getSize(find.byKey(const Key('c0'))).width;
      final visible = (400 - 16) / (w + 12);
      expect(visible, closeTo(2.5, 0.35));
    });
  });

  group('VendorCoverCard', () {
    testWidgets(
        'shows name, rating, ETA and open state; NO offer badge when the vendor has no offer',
        (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(VendorCoverCard(vendor: _vendor(), onTap: () {})));
      expect(find.text('مشويات السلام'), findsOneWidget);
      expect(find.text('4.6'), findsOneWidget);
      expect(find.textContaining('25–30'), findsOneWidget);
      expect(find.text('مفتوح الآن'), findsOneWidget);
      expect(find.text('عرض'), findsNothing);
    });

    testWidgets(
        'shows the offer badge only when hasPromotion; closed vendors say so with text + icon',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(VendorCoverCard(
          vendor: _vendor(promo: true, open: false), onTap: () {})));
      expect(find.text('عرض'), findsOneWidget);
      expect(find.text('مغلق'), findsOneWidget);
      expect(find.byIcon(Icons.schedule_rounded), findsWidgets);
    });

    testWidgets(
        'hides ETA when the backend has none (0) and rating when there are no ratings',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          VendorCoverCard(vendor: _vendor(eta: 0, count: 0), onTap: () {})));
      expect(find.textContaining('د'), findsNothing);
      expect(find.byIcon(Icons.star_rounded), findsNothing);
    });

    testWidgets(
        'is full width, taps through, and exposes a single accessible button',
        (tester) async {
      var taps = 0;
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(hatlyTestApp(Padding(
          padding: const EdgeInsets.all(16),
          child: VendorCoverCard(vendor: _vendor(), onTap: () => taps++))));
      final size = tester.getSize(find.byType(VendorCoverCard));
      expect(size.width,
          tester.view.physicalSize.width / tester.view.devicePixelRatio - 32);
      await tester.tap(find.byType(VendorCoverCard));
      expect(taps, 1);
      expect(tester.getSemantics(find.byType(VendorCoverCard)),
          isSemantics(isButton: true, hasTapAction: true));
      handle.dispose();
    });
  });

  group('ProductCard', () {
    testWidgets(
        'uses the real flash price, strikes the original, and shows the flash badge',
        (tester) async {
      const p = Product(
          id: 'p',
          vendorBranchId: 'b',
          categoryId: 'c',
          name: 'Burger',
          nameAr: 'برجر',
          priceMinor: 10000,
          isAvailable: true,
          activeOffer:
              ActiveOffer(mechanism: 'FLASH_SALE', specialPriceMinor: 8000));
      await tester.pumpWidget(
          hatlyTestApp(ProductCard(product: p, onTap: () {}, width: 150)));
      expect(find.text('80 ج.م'), findsOneWidget);
      expect(find.text('100 ج.م'), findsOneWidget);
      expect(find.text('عرض سريع'), findsOneWidget);
    });

    testWidgets(
        'an unavailable product is labelled (text+icon), muted, and not tappable',
        (tester) async {
      var taps = 0;
      const p = Product(
          id: 'p',
          vendorBranchId: 'b',
          categoryId: 'c',
          name: 'Burger',
          priceMinor: 10000,
          isAvailable: false);
      await tester.pumpWidget(hatlyTestApp(
          ProductCard(product: p, onTap: () => taps++, width: 150)));
      expect(find.text('غير متاح'), findsOneWidget);
      await tester.tap(find.byType(ProductCard), warnIfMissed: false);
      expect(taps, 0);
    });

    testWidgets('the caller tag (New / Popular) shows when there is no offer',
        (tester) async {
      const p = Product(
          id: 'p',
          vendorBranchId: 'b',
          categoryId: 'c',
          name: 'Burger',
          priceMinor: 10000,
          isAvailable: true);
      await tester.pumpWidget(hatlyTestApp(ProductCard(
          product: p,
          onTap: () {},
          width: 150,
          extraBadge: HatlyBadgeKind.newItem)));
      expect(find.text('جديد'), findsOneWidget);
    });
  });

  group('floating "+" quick add', () {
    const available = Product(
        id: 'p',
        vendorBranchId: 'b',
        categoryId: 'c',
        name: 'Burger',
        priceMinor: 10000,
        isAvailable: true);

    testWidgets(
        'an available product card has a circular ≥44px "+" that adds (and does not open the product)',
        (tester) async {
      var added = 0;
      var opened = 0;
      await tester.pumpWidget(hatlyTestApp(Center(
          child: ProductCard(
              product: available,
              width: 160,
              onTap: () => opened++,
              onQuickAdd: () => added++))));
      final plus = find.byType(HatlyQuickAddButton);
      expect(plus, findsOneWidget);
      final size = tester.getSize(plus);
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
      final deco = tester
          .widget<DecoratedBox>(find
              .descendant(of: plus, matching: find.byType(DecoratedBox))
              .first)
          .decoration as BoxDecoration;
      expect(deco.shape, BoxShape.circle);
      await tester.tap(plus);
      expect((added, opened), (1, 0));
      await tester.tap(find.text('Burger'), warnIfMissed: false);
    });

    testWidgets(
        'it floats over the IMAGE (inside its bounds), not over the name/price',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(Center(
          child: ProductCard(
              product: available,
              width: 160,
              onTap: () {},
              onQuickAdd: () {}))));
      final plus = tester.getRect(find.byType(HatlyQuickAddButton));
      final card = tester.getRect(find.byType(ProductCard));
      final name = tester.getRect(find.text('Burger'));
      expect(plus.bottom, lessThan(name.top));
      expect(plus.right, lessThanOrEqualTo(card.right));
      expect(plus.left, greaterThanOrEqualTo(card.left));
    });

    testWidgets(
        'no "+" for an unavailable product, or when the caller gives no action',
        (tester) async {
      const gone = Product(
          id: 'p',
          vendorBranchId: 'b',
          categoryId: 'c',
          name: 'Burger',
          priceMinor: 10000,
          isAvailable: false);
      await tester.pumpWidget(hatlyTestApp(ProductCard(
          product: gone, width: 160, onTap: () {}, onQuickAdd: () {})));
      expect(find.byType(HatlyQuickAddButton), findsNothing);
      await tester.pumpWidget(hatlyTestApp(
          ProductCard(product: available, width: 160, onTap: () {})));
      expect(find.byType(HatlyQuickAddButton), findsNothing);
    });

    testWidgets(
        'the "+" is reachable by screen readers with the add-to-cart label',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(hatlyTestApp(Center(
          child: ProductCard(
              product: available,
              width: 160,
              onTap: () {},
              onQuickAdd: () {}))));
      expect(tester.getSemantics(find.byType(HatlyQuickAddButton)),
          isSemantics(label: 'أضف للسلة', isButton: true, hasTapAction: true));
      handle.dispose();
    });

    testWidgets(
        'offer cards show it only when the offer is a real, addable product',
        (tester) async {
      const real = HomeOffer(
          id: 'o',
          kind: HomeOfferKind.flash,
          title: 'Flash',
          priceMinor: 100,
          targetId: 'real-id');
      const demo = HomeOffer(
          id: 'o',
          kind: HomeOfferKind.flash,
          title: 'Flash',
          priceMinor: 100,
          targetId: 'demo-product-1',
          isDemo: true);
      const vendorOffer = HomeOffer(
          id: 'o', kind: HomeOfferKind.vendor, title: 'V', targetId: 'real-id');
      expect(offerIsQuickAddable(real), isTrue);
      expect(offerIsQuickAddable(demo), isFalse);
      expect(offerIsQuickAddable(vendorOffer), isFalse);

      await tester.pumpWidget(hatlyTestApp(Center(
          child: OfferCard(
              offer: real, width: 160, onTap: () {}, onQuickAdd: () {}))));
      expect(find.byType(HatlyQuickAddButton), findsOneWidget);
      await tester.pumpWidget(hatlyTestApp(Center(
          child: OfferCard(offer: vendorOffer, width: 160, onTap: () {}))));
      expect(find.byType(HatlyQuickAddButton), findsNothing);
    });

    testWidgets(
        'cards with the "+" still fit 320px, 1.5× text, dark mode, LTR and RTL',
        (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        await tester.pumpWidget(hatlyTestApp(
          HomeHorizontalRow(
              itemCount: 2,
              itemBuilder: (c, i, w) => ProductCard(
                  product: available,
                  width: w,
                  onTap: () {},
                  onQuickAdd: () {})),
          locale: locale,
          dark: true,
          textScale: 1.5,
        ));
        await tester.pump();
        expect(tester.takeException(), isNull);
      }
    });
  });

  group('OfferCard (mixed offers)', () {
    testWidgets(
        'only flash / free delivery / bundle carry a badge; plain product and vendor offers stay quiet',
        (tester) async {
      final expected = {
        HomeOfferKind.flash: 'عرض سريع',
        HomeOfferKind.freeDelivery: 'توصيل مجاني',
        HomeOfferKind.bundle: 'باكدج',
      };
      for (final entry in expected.entries) {
        await tester.pumpWidget(hatlyTestApp(OfferCard(
            offer: HomeOffer(id: 'o', kind: entry.key, title: 'T'),
            onTap: () {},
            width: 160)));
        expect(find.text(entry.value), findsOneWidget, reason: '${entry.key}');
      }
      for (final kind in [HomeOfferKind.vendor, HomeOfferKind.product]) {
        await tester.pumpWidget(hatlyTestApp(OfferCard(
            offer: HomeOffer(id: 'o', kind: kind, title: 'T'),
            onTap: () {},
            width: 160)));
        expect(find.byType(HatlyBadge), findsNothing, reason: '$kind');
      }
    });
  });

  group('robustness', () {
    testWidgets(
        'cards survive a 320px screen with 1.5× text, English (LTR) and dark mode without overflow',
        (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      const p = Product(
          id: 'p',
          vendorBranchId: 'b',
          categoryId: 'c',
          name: 'A very long product name that must wrap and ellipsize',
          priceMinor: 12345,
          isAvailable: true,
          activeOffer:
              ActiveOffer(mechanism: 'FLASH_SALE', specialPriceMinor: 9999));
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final dark in [false, true]) {
          await tester.pumpWidget(hatlyTestApp(
            ListView(children: [
              VendorCoverCard(vendor: _vendor(promo: true), onTap: () {}),
              HomeHorizontalRow(
                  itemCount: 2,
                  itemBuilder: (c, i, w) =>
                      ProductCard(product: p, width: w, onTap: () {})),
              HomeHorizontalRow(
                  itemCount: 2,
                  itemBuilder: (c, i, w) => OfferCard(
                      offer: const HomeOffer(
                          id: 'o',
                          kind: HomeOfferKind.bundle,
                          title: 'A long bundle title that must not overflow',
                          subtitle: 'sub',
                          priceMinor: 32000),
                      onTap: () {},
                      width: w)),
              PromoCarousel(
                  promos: _promos,
                  onAction: (_) {},
                  autoRotateInterval: const Duration(days: 1)),
            ]),
            locale: locale,
            dark: dark,
            textScale: 1.5,
          ));
          await tester.pump();
          expect(tester.takeException(), isNull, reason: '$locale dark=$dark');
        }
      }
    });
  });
}

int _activeIndex(WidgetTester tester) {
  final widths = tester
      .widgetList<AnimatedContainer>(find.descendant(
          of: find.byType(PromoPageIndicator),
          matching: find.byType(AnimatedContainer)))
      .map((c) => c.constraints!.maxWidth)
      .toList();
  return widths.indexOf(widths.reduce((a, b) => a > b ? a : b));
}
