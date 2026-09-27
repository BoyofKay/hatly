import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';

void main() {
  setUpAll(() => HatlyTypography.useGoogleFonts = false);

  group('approved radii', () {
    test('match the Design System', () {
      expect(HatlyRadius.chip, 8);
      expect(HatlyRadius.button, 12);
      expect(HatlyRadius.input, 12);
      expect(HatlyRadius.searchBar, 12);
      expect(HatlyRadius.card, 16);
      expect(HatlyRadius.imageContainer, 16);
      expect(HatlyRadius.promoBanner, 20);
      expect(HatlyRadius.circular, greaterThanOrEqualTo(999));
    });
  });

  group('type scale', () {
    test(
        'Display 28 · H1 24 · H2 20 · Title 18 · Body 16 · Small 14 · Caption 12',
        () {
      final t = HatlyTheme.light().extension<HatlyTextScale>()!;
      expect(
          [t.display, t.h1, t.h2, t.title, t.body, t.small, t.caption]
              .map((s) => s.fontSize),
          [28, 24, 20, 18, 16, 14, 12]);
    });

    test(
        'Inter is the primary family with Cairo as the fallback (Arabic → Cairo, Latin/digits → Inter)',
        () {
      final body = HatlyTheme.light().extension<HatlyTextScale>()!.body;
      expect(body.fontFamily, 'Inter');
      expect(body.fontFamilyFallback, contains('Cairo'));
    });
  });

  group('light + dark palettes', () {
    test(
        'both themes install the same extensions and the brand orange is identical',
        () {
      final light = HatlyTheme.light().extension<HatlyPalette>()!;
      final dark = HatlyTheme.dark().extension<HatlyPalette>()!;
      expect(light.accent, HatlyColors.primaryOrange);
      expect(dark.accent, HatlyColors.primaryOrange);
      expect(HatlyTheme.dark().extension<HatlyTextScale>(), isNotNull);
    });

    test(
        'light = soft off-white page with white surfaces; dark = dark page with elevated dark surfaces',
        () {
      const light = HatlyPalette.light;
      expect(light.background, const Color(0xFFFAFAFA));
      expect(light.surface, Colors.white);
      const dark = HatlyPalette.dark;
      expect(dark.background.computeLuminance(), lessThan(0.05));
      expect(dark.surface.computeLuminance(),
          greaterThan(dark.background.computeLuminance()));
    });

    test(
        'text contrast is at least WCAG AA (4.5:1) against its own background and surface, in both modes',
        () {
      double ratio(Color a, Color b) {
        final la = a.computeLuminance();
        final lb = b.computeLuminance();
        final hi = la > lb ? la : lb;
        final lo = la > lb ? lb : la;
        return (hi + 0.05) / (lo + 0.05);
      }

      for (final p in [HatlyPalette.light, HatlyPalette.dark]) {
        expect(ratio(p.textPrimary, p.background), greaterThanOrEqualTo(4.5));
        expect(ratio(p.textPrimary, p.surface), greaterThanOrEqualTo(4.5));
        expect(ratio(p.textMuted, p.surface), greaterThanOrEqualTo(4.5));
        expect(ratio(p.textMuted, p.surfaceSoft), greaterThanOrEqualTo(4.5));
        expect(ratio(p.accentOn, p.accent),
            greaterThanOrEqualTo(4.5)); // CTA text on the brand orange
        expect(ratio(p.link, p.surface),
            greaterThanOrEqualTo(3.0)); // orange text link (large/bold minimum)
      }
    });

    test('the theme switches brightness and scaffold background', () {
      expect(HatlyTheme.light().brightness, Brightness.light);
      expect(HatlyTheme.dark().brightness, Brightness.dark);
      expect(HatlyTheme.dark().scaffoldBackgroundColor,
          HatlyPalette.dark.background);
    });
  });
}
