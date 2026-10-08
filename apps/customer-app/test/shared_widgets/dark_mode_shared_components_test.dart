import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/shared_widgets/hatly_button.dart';
import 'package:hatly_customer/shared_widgets/hatly_card.dart';
import 'package:hatly_customer/shared_widgets/hatly_chip.dart';
import 'package:hatly_customer/shared_widgets/hatly_error_banner.dart';
import 'package:hatly_customer/shared_widgets/hatly_price_label.dart';
import 'package:hatly_customer/shared_widgets/hatly_primary_button.dart';
import 'package:hatly_customer/shared_widgets/hatly_state_view.dart';
import 'package:hatly_customer/shared_widgets/sort_menu_button.dart';

import '../support/test_app.dart';

/// Dark Mode implementation milestone. These are the shared/root-cause
/// components the Visual QA audit flagged (HatlyCard, QuantityStepper) plus
/// the other shared widgets found to have the same hardcoded-colour
/// anti-pattern during this milestone's own Phase 1 sweep. Every group below
/// asserts the SAME two things: Light Mode is unchanged from the old fixed
/// constants (no regression), and Dark Mode actually uses a dark-appropriate
/// colour (not a leftover light-mode constant, not a crash).
double _luminance(Color c) => c.computeLuminance();
double _contrast(Color a, Color b) {
  final la = _luminance(a), lb = _luminance(b);
  final hi = la > lb ? la : lb, lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  group('HatlyCard (audit F-D1)', () {
    BoxDecoration deco(WidgetTester tester) => tester
        .widget<Container>(find.descendant(
            of: find.byType(HatlyCard), matching: find.byType(Container)))
        .decoration as BoxDecoration;

    testWidgets('Light Mode colours are unchanged from the old constants',
        (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(const HatlyCard(child: Text('x'))));
      final d = deco(tester);
      expect(d.color, HatlyColors.surfaceWhite);
      expect((d.border as Border).top.color, HatlyColors.border);
    });

    testWidgets('Dark Mode uses the dark palette, never the fixed white',
        (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(const HatlyCard(child: Text('x')), dark: true));
      final d = deco(tester);
      expect(d.color, HatlyPalette.dark.surface);
      expect(d.color, isNot(HatlyColors.surfaceWhite));
      expect((d.border as Border).top.color, HatlyPalette.dark.border);
    });

    testWidgets('elevated: true keeps a shadow (never a border) in both themes',
        (tester) async {
      for (final dark in [false, true]) {
        await tester.pumpWidget(hatlyTestApp(
            const HatlyCard(elevated: true, child: Text('x')),
            dark: dark));
        await tester.pumpAndSettle();
        final d = deco(tester);
        expect(d.border, isNull, reason: 'dark=$dark');
        expect(d.boxShadow, isNotNull, reason: 'dark=$dark');
      }
    });
  });

  // The "QuantityStepper (audit F-D2)" group that used to live here was
  // removed together with `lib/shared_widgets/quantity_stepper.dart` itself
  // (Polish pass) — confirmed dead code with zero production call sites,
  // fully superseded by `HatlyQuantityControl` (used by Product Details and
  // Cart). No dedicated Dark Mode unit test exists for `HatlyQuantityControl`
  // itself; adding one is outside this dead-code removal's scope.

  group('HatlyStateView (empty/error states app-wide)', () {
    testWidgets('Light Mode text colours are unchanged', (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          const HatlyStateView(icon: Icons.error_outline, title: 'Oops')));
      final title = tester.widget<Text>(find.text('Oops'));
      expect(title.style!.color, HatlyColors.textDark);
    });

    testWidgets('Dark Mode text is readable against the dark background',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          const HatlyStateView(
              icon: Icons.error_outline, title: 'Oops', subtitle: 'Try again'),
          dark: true));
      final title = tester.widget<Text>(find.text('Oops'));
      final subtitle = tester.widget<Text>(find.text('Try again'));
      expect(_contrast(title.style!.color!, HatlyPalette.dark.background),
          greaterThanOrEqualTo(4.5));
      expect(_contrast(subtitle.style!.color!, HatlyPalette.dark.background),
          greaterThanOrEqualTo(3.0));
    });
  });

  group('HatlyChip (unselected fill/text/border)', () {
    Color labelColor(WidgetTester tester) =>
        tester.widget<Text>(find.text('Pizza')).style!.color!;

    testWidgets('Light Mode is unchanged', (tester) async {
      await tester
          .pumpWidget(hatlyTestApp(const HatlyChip(label: 'Pizza')));
      expect(labelColor(tester), HatlyColors.textDark);
    });

    testWidgets('Dark Mode text is never the fixed near-black', (tester) async {
      await tester
          .pumpWidget(hatlyTestApp(const HatlyChip(label: 'Pizza'), dark: true));
      expect(labelColor(tester), isNot(HatlyColors.textDark));
      expect(_contrast(labelColor(tester), HatlyPalette.dark.surface),
          greaterThanOrEqualTo(4.5));
    });
  });

  group('HatlyErrorBanner', () {
    testWidgets('uses the theme urgent colour, identical to the old red in Light Mode',
        (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(const HatlyErrorBanner(message: 'nope')));
      final text = tester.widget<Text>(find.text('nope'));
      expect(text.style!.color, HatlyPalette.light.urgent);
      expect(HatlyPalette.light.urgent, HatlyColors.error);
    });

    testWidgets('is readable in Dark Mode', (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(const HatlyErrorBanner(message: 'nope'), dark: true));
      final text = tester.widget<Text>(find.text('nope'));
      expect(text.style!.color, HatlyPalette.dark.urgent);
    });
  });

  group('HatlyPriceLabel', () {
    testWidgets(
        'the pending label uses the theme muted colour, unchanged in Light Mode',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(const HatlyPriceLabel(
          isPending: true, pendingLabel: 'Price pending')));
      final text = tester.widget<Text>(find.text('Price pending'));
      expect(text.style!.color, HatlyColors.textMuted);
    });

    testWidgets('the pending label is readable in Dark Mode', (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          const HatlyPriceLabel(isPending: true, pendingLabel: 'Price pending'),
          dark: true));
      final text = tester.widget<Text>(find.text('Price pending'));
      expect(_contrast(text.style!.color!, HatlyPalette.dark.background),
          greaterThanOrEqualTo(3.0));
    });
  });

  group('SortMenuButton', () {
    testWidgets('Dark Mode fill/icon are never the fixed light-mode constants',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          SortMenuButton(
              value: null,
              label: 'الأحدث',
              onChanged: (_) {},
              options: const [('newest', 'الأحدث')]),
          dark: true));
      final box = tester.widget<Container>(find.descendant(
          of: find.byType(SortMenuButton), matching: find.byType(Container)));
      final fill = (box.decoration as BoxDecoration).color;
      expect(fill, isNot(const Color(0xFFF5F5F5))); // Colors.grey.shade100
      expect(fill, HatlyPalette.dark.surfaceSoft);
    });
  });

  group('HatlyButton — destructive variant (dark-mode contrast regression)',
      () {
    testWidgets(
        'label/spinner stay white-on-red in Dark Mode too (not the primary button\'s dark-ink foreground)',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
          const HatlyButton(
              label: 'Delete',
              variant: HatlyButtonVariant.destructive,
              isLoading: true),
          dark: true));
      final spinner =
          tester.widget<CircularProgressIndicator>(find.byType(CircularProgressIndicator));
      expect(spinner.color, Colors.white);
    });

    testWidgets('primary variant spinner matches the button\'s own foreground',
        (tester) async {
      for (final dark in [false, true]) {
        await tester.pumpWidget(hatlyTestApp(
            const HatlyButton(label: 'Save', isLoading: true),
            dark: dark));
        // MaterialApp animates a theme change (AnimatedTheme) — settle it
        // before reading the resolved colour, or a re-pump within the same
        // test can still read a mid-transition frame.
        await tester.pump(kThemeAnimationDuration);
        final spinner = tester.widget<CircularProgressIndicator>(
            find.byType(CircularProgressIndicator));
        final expected = dark ? HatlyPalette.dark.accentOn : Colors.white;
        expect(spinner.color, expected, reason: 'dark=$dark');
      }
    });
  });

  group('HatlyPrimaryButton (audit F-D6)', () {
    testWidgets('spinner matches the resolved button foreground in both themes',
        (tester) async {
      for (final dark in [false, true]) {
        await tester.pumpWidget(hatlyTestApp(
            HatlyPrimaryButton(
                label: 'Continue', onPressed: () {}, isLoading: true),
            dark: dark));
        await tester.pump(kThemeAnimationDuration);
        final spinner = tester.widget<CircularProgressIndicator>(
            find.byType(CircularProgressIndicator));
        final expected = dark ? HatlyPalette.dark.accentOn : Colors.white;
        expect(spinner.color, expected, reason: 'dark=$dark');
      }
    });
  });
}
