import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/shared_widgets/hatly_badge.dart';
import 'package:hatly_customer/shared_widgets/hatly_floating_nav_bar.dart';
import 'package:hatly_customer/shared_widgets/hatly_search_bar.dart';
import 'package:hatly_customer/shared_widgets/hatly_section_header.dart';
import 'package:hatly_customer/shared_widgets/hatly_soft_image.dart';

import '../support/test_app.dart';

const _navItems = [
  HatlyNavItem(
      label: 'Home',
      icon: Icons.home_outlined,
      activeIcon: Icons.home_rounded,
      key: Key('n0')),
  HatlyNavItem(
      label: 'Explore',
      icon: Icons.explore_outlined,
      activeIcon: Icons.explore_rounded,
      key: Key('n1')),
  HatlyNavItem(
      label: 'Cart',
      icon: Icons.shopping_bag_outlined,
      activeIcon: Icons.shopping_bag_rounded,
      badgeCount: 3,
      key: Key('n2')),
  HatlyNavItem(
      label: 'Orders',
      icon: Icons.receipt_long_outlined,
      activeIcon: Icons.receipt_long_rounded,
      key: Key('n3')),
  HatlyNavItem(
      label: 'Profile',
      icon: Icons.person_outline_rounded,
      activeIcon: Icons.person_rounded,
      key: Key('n4')),
];

void main() {
  group('HatlySearchBar', () {
    testWidgets(
        'uses the same 12px-radius search silhouette as Explore, is ≥48px tall, and reports taps',
        (tester) async {
      var taps = 0;
      await tester.pumpWidget(hatlyTestApp(
          HatlySearchBar(hintText: 'بتدور على إيه؟', onTap: () => taps++)));

      expect(find.text('بتدور على إيه؟'), findsOneWidget);
      // the pill: fully rounded corners and a visible border
      final box = tester.widget<DecoratedBox>(find
          .descendant(
              of: find.byType(HatlySearchBar),
              matching: find.byType(DecoratedBox))
          .first);
      final decoration = box.decoration as BoxDecoration;
      expect(
          decoration.borderRadius, BorderRadius.circular(HatlyRadius.searchBar));
      expect(decoration.border, isNotNull);
      expect(tester.getSize(find.byType(HatlySearchBar)).height,
          greaterThanOrEqualTo(48));

      await tester.tap(find.byType(HatlySearchBar));
      expect(taps, 1);
    });
  });

  group('HatlySectionHeader', () {
    testWidgets(
        'title and "عرض الكل" + arrow on ONE line; the action keeps a ≥44px target and fires',
        (tester) async {
      var taps = 0;
      await tester.pumpWidget(hatlyTestApp(HatlySectionHeader(
          title: 'العروض', seeAllLabel: 'عرض الكل', onSeeAll: () => taps++)));

      final title = tester.getRect(find.text('العروض'));
      final action = tester.getRect(find.text('عرض الكل'));
      expect((title.center.dy - action.center.dy).abs(), lessThan(4));
      expect(find.byIcon(Icons.arrow_forward_rounded), findsOneWidget);
      final target = tester.getSize(find
          .ancestor(of: find.text('عرض الكل'), matching: find.byType(InkWell))
          .first);
      expect(target.height, greaterThanOrEqualTo(44));

      await tester.tap(find.text('عرض الكل'));
      expect(taps, 1);
    });

    testWidgets(
        'the arrow points toward the reading direction in RTL (left) and LTR (right)',
        (tester) async {
      Future<TextDirection> arrowDirection(Locale locale) async {
        await tester.pumpWidget(hatlyTestApp(
            HatlySectionHeader(title: 'x', seeAllLabel: 'y', onSeeAll: () {}),
            locale: locale));
        final icon = find.byIcon(Icons.arrow_forward_rounded);
        return Directionality.of(tester.element(icon));
      }

      expect(await arrowDirection(const Locale('ar')), TextDirection.rtl);
      expect(await arrowDirection(const Locale('en')), TextDirection.ltr);
    });

    testWidgets('has no action when none is given', (tester) async {
      await tester
          .pumpWidget(hatlyTestApp(const HatlySectionHeader(title: 'الفئات')));
      expect(find.byIcon(Icons.arrow_forward_rounded), findsNothing);
    });
  });

  group('HatlyBadge', () {
    testWidgets(
        'every kind pairs its text with its OWN icon (state is never colour-only) and radius 8',
        (tester) async {
      final seenIcons = <IconData>{};
      for (final kind in HatlyBadgeKind.values) {
        await tester
            .pumpWidget(hatlyTestApp(HatlyBadge(kind: kind, label: kind.name)));
        expect(find.text(kind.name), findsOneWidget,
            reason: '$kind has a text label');
        final icon = tester.widget<Icon>(find.descendant(
            of: find.byType(HatlyBadge), matching: find.byType(Icon)));
        seenIcons.add(icon.icon!);
        final box = tester.widget<Container>(find
            .descendant(
                of: find.byType(HatlyBadge), matching: find.byType(Container))
            .first);
        expect((box.decoration as BoxDecoration).borderRadius,
            BorderRadius.circular(8));
      }
      expect(seenIcons.length, HatlyBadgeKind.values.length,
          reason: 'each kind must be recognisable by icon');
    });
  });

  group('HatlySoftImage', () {
    testWidgets(
        'shows a soft placeholder (no coloured icon card) when there is no image and clips to radius 16',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          const HatlySoftImage(url: null, width: 100, height: 100)));
      expect(find.byIcon(Icons.image_outlined), findsOneWidget);
      final clip = tester.widget<ClipRRect>(find.byType(ClipRRect));
      expect(clip.borderRadius, BorderRadius.circular(16));
    });
  });

  group('HatlyFloatingNavBar', () {
    testWidgets(
        'renders 5 destinations on a flat full-width bar with a top border (reference board), and marks only the selected one',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(HatlyFloatingNavBar(
          items: _navItems, selectedIndex: 0, onTap: (_) {})));

      for (final label in ['Home', 'Explore', 'Cart', 'Orders', 'Profile']) {
        expect(find.text(label), findsOneWidget);
      }
      // flat: the bar spans the full width, with a hairline top border and a soft upward shadow, and no rounded corners
      final bar = find.descendant(
          of: find.byType(HatlyFloatingNavBar),
          matching: find.byType(DecoratedBox));
      final card = tester.getRect(bar.first);
      expect(card.left, 0);
      expect(card.width,
          tester.view.physicalSize.width / tester.view.devicePixelRatio);
      final deco =
          tester.widget<DecoratedBox>(bar.first).decoration as BoxDecoration;
      expect(deco.boxShadow, isNotEmpty);
      expect(deco.border, isNotNull);
      expect(deco.borderRadius, isNull);
      // active item uses the filled icon, the others the outlined one
      expect(find.byIcon(Icons.home_rounded), findsOneWidget);
      expect(find.byIcon(Icons.explore_outlined), findsOneWidget);
    });

    testWidgets(
        'active item has an orange indicator AND a heavier label; inactive has neither',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(HatlyFloatingNavBar(
          items: _navItems, selectedIndex: 1, onTap: (_) {})));
      await tester.pumpAndSettle();

      TextStyle labelStyle(String t) =>
          tester.widget<Text>(find.text(t)).style!;
      expect(labelStyle('Explore').fontWeight, FontWeight.w800);
      expect(labelStyle('Home').fontWeight, FontWeight.w500);

      double indicatorWidth(String key) => tester
          .getSize(find
              .descendant(
                  of: find.byKey(Key(key)),
                  matching: find.byType(AnimatedContainer))
              .first)
          .width;

      expect(indicatorWidth('n1'), greaterThan(0));
      expect(indicatorWidth('n0'), 0);
    });

    testWidgets(
        'exposes selected state to accessibility, every button is ≥44×44, and the cart badge shows its count',
        (tester) async {
      final handle = tester.ensureSemantics();
      await tester.pumpWidget(hatlyTestApp(HatlyFloatingNavBar(
          items: _navItems, selectedIndex: 3, onTap: (_) {})));

      expect(
          tester.getSemantics(find.byKey(const Key('n3'))),
          isSemantics(
              label: 'Orders',
              isButton: true,
              isSelected: true,
              hasTapAction: true));
      expect(
          tester.getSemantics(find.byKey(const Key('n0'))),
          isSemantics(
              label: 'Home',
              isButton: true,
              isSelected: false,
              hasTapAction: true));
      for (final key in ['n0', 'n1', 'n2', 'n3', 'n4']) {
        final size = tester.getSize(find.byKey(Key(key)));
        expect(size.width, greaterThanOrEqualTo(44), reason: key);
        expect(size.height, greaterThanOrEqualTo(44), reason: key);
      }
      expect(find.text('3'), findsOneWidget);
      handle.dispose();
    });

    testWidgets(
        'REGRESSION: inside a real Scaffold bottomNavigationBar the bar is compact (about one row), not full-screen',
        (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      HatlyTypography.useGoogleFonts = false;
      await tester.pumpWidget(
        MaterialApp(
          theme: HatlyTheme.light(),
          home: Scaffold(
            body: const Text('page'),
            bottomNavigationBar: HatlyFloatingNavBar(
                items: _navItems, selectedIndex: 0, onTap: (_) {}),
          ),
        ),
      );
      final bar = tester.getSize(find.byType(HatlyFloatingNavBar));
      expect(bar.height, lessThan(110));
      expect(bar.height, greaterThanOrEqualTo(64));
      expect(tester.getTopLeft(find.text('page')).dy, lessThan(100),
          reason: 'the page keeps the space above the bar');
    });

    testWidgets(
        'reports the tapped index; selectedIndex null highlights nothing',
        (tester) async {
      final tapped = <int>[];
      await tester.pumpWidget(hatlyTestApp(HatlyFloatingNavBar(
          items: _navItems, selectedIndex: null, onTap: tapped.add)));
      await tester.tap(find.text('Cart'));
      await tester.tap(find.text('Profile'));
      expect(tapped, [2, 4]);
      expect(find.byIcon(Icons.home_rounded), findsNothing);
    });

    testWidgets(
        'fits a 320px-wide screen in Arabic with large text and in dark mode, without overflow',
        (tester) async {
      tester.view.physicalSize = const Size(320, 640);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyTestApp(
          HatlyFloatingNavBar(
              items: _navItems, selectedIndex: 0, onTap: (_) {}),
          dark: true,
          textScale: 1.3));
      expect(tester.takeException(), isNull);
    });
  });
}
