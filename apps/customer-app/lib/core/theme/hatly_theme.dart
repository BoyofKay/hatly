import 'package:flutter/material.dart';
import 'hatly_palette.dart';
import 'hatly_typography.dart';

export 'hatly_palette.dart';
export 'hatly_typography.dart';

/// Hatly Design System (UI/UX-0). Centralized design tokens — colors,
/// spacing, radius — so visual constants stop being scattered across
/// individual widgets (the pre-UI/UX-0 pattern, e.g. inline
/// `BorderRadius.circular(...)`/`EdgeInsets` literals repeated per
/// screen). Kept in one place so both the customer and driver apps
/// stay in sync if this file is later promoted to a shared package.
///
/// Semantic roles, not arbitrary color names — every constant below
/// documents WHERE it belongs and where it should NOT be used, per
/// the approved UI/UX-0 Design Review.
class HatlyColors {
  // --- Brand ---
  /// Primary CTAs, selected states, brand accents. Never as body text
  /// on white (contrast) and never for large background fills beyond
  /// buttons/badges.
  static const Color primaryOrange = Color(0xFFFF7A1A);

  /// Pressed/active state of a primary element only — never an idle
  /// fill (that would read as a second, competing brand color).
  static const Color primaryOrangeDark = Color(0xFFE0650A);

  /// Disabled CTA fill only. Never used for an enabled element — easy
  /// to mistake for a lighter brand tint if misused.
  static const Color primaryOrangeDisabled = Color(0xFFFFD3AD);

  /// Secondary-action ink (outlined/tertiary button border+text).
  /// Never as a large fill — too visually heavy at that scale.
  static const Color secondary = Color(0xFF1A1A1A);

  // --- Surfaces ---
  /// Screen background — a hair off pure white so white Cards read as
  /// distinct surfaces rather than blending into the page.
  static const Color background = Color(0xFFFAFAFA);

  /// Cards, sheets, app bar surface.
  static const Color surfaceWhite = Color(0xFFFFFFFF);

  // --- Text ---
  static const Color textDark = Color(0xFF1A1A1A);
  static const Color textMuted = Color(0xFF6B6B6B);

  /// Disabled input/button text only.
  static const Color textDisabled = Color(0xFFB0B0B0);

  /// Card borders, list dividers — never used for emphasis.
  static const Color border = Color(0xFFE5E5E5);

  // --- Semantic feedback ---
  static const Color success = Color(0xFF2E7D32);

  /// Pending/awaiting states (e.g. Manual Transfer under review) —
  /// deliberately distinct from primaryOrange so it never competes
  /// visually with a CTA.
  static const Color warning = Color(0xFFED6C02);

  static const Color error = Color(0xFFD32F2F);

  /// Neutral informational banners only — never an actionable
  /// element (would be mistaken for a link/CTA).
  static const Color info = Color(0xFF0288D1);

  // --- Marketplace-specific ---
  /// Vendor "closed"/product "unavailable" badge. Deliberately a
  /// desaturated gray, never red — red means "error," not "not
  /// available right now."
  static const Color closedUnavailable = Color(0xFF9E9E9E);

  /// Offer badges reuse the brand color — reinforces "this is a
  /// Hatly-run promotion," not a generic sale tag.
  static const Color offer = primaryOrange;

  /// Flash Sale is genuinely urgency-coded (time-limited) — the one
  /// deliberate reuse of "error red" for non-error meaning, matching
  /// common urgency-coding convention.
  static const Color flashSale = Color(0xFFD32F2F);
}

/// 4pt base spacing scale. Default screen horizontal padding is
/// [md] (16) unless a screen has an established reason otherwise.
class HatlySpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double ms = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;

  static const double screenPadding = md;
}

/// Corner-radius scale. Buttons and inputs share the same radius —
/// both are interactive controls; cards are slightly softer, reading
/// as "content containers" rather than actions.
class HatlyRadius {
  /// Approved radii (Design System v1).
  static const double chip = 8;
  static const double badge = 8;
  static const double button = 12;
  static const double input = 12;
  static const double searchBar = 12;
  static const double card = 16;
  static const double dialog = 16;
  static const double imageContainer = 16;
  static const double promoBanner = 20;
  /// Recovered Nov 13 full-width hero banners use deliberately restrained corners.
  static const double heroBanner = 8;
  static const double bottomSheetTop = 20;

  /// Circular controls (avatars, round icon buttons, the nav pill's ends).
  static const double circular = 999;
}

/// Minimum interactive size (logical px) — ≈44 per the accessibility bar.
class HatlyTouch {
  static const double minTarget = 44;
}

class HatlyTheme {
  /// Legacy Material text-theme helper, now on the approved Inter(+Cairo
  /// fallback) family. Sizes of the existing Material slots are intentionally
  /// unchanged (other screens depend on them); the approved 28/24/20/18/16/14/12
  /// scale is available to new widgets through `context.type`.
  static TextStyle _cairo({
    required double fontSize,
    required FontWeight fontWeight,
    Color color = HatlyColors.textDark,
    double? height,
  }) {
    return HatlyTypography.style(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: height);
  }

  static ThemeData light() => _build(HatlyPalette.light, Brightness.light);

  static ThemeData dark() => _build(HatlyPalette.dark, Brightness.dark);

  static ThemeData _build(HatlyPalette p, Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    // EXISTING screens keep white-on-orange in light mode so this slice does not restyle them
    // (2.6:1 — flagged for Design Review); new components use `p.accentOn` (dark ink, 7:1).
    final legacyOnOrange = isDark ? p.accentOn : HatlyColors.surfaceWhite;
    TextStyle t(double size, FontWeight w, {Color? color, double? height}) =>
        _cairo(
            fontSize: size,
            fontWeight: w,
            color: color ?? p.textPrimary,
            height: height);

    final textTheme = TextTheme(
      // Display — rare (e.g. splash), 28/Bold.
      displaySmall: t(28, FontWeight.bold, height: 1.3),
      // Title — screen titles, vendor name, 20/SemiBold.
      titleLarge: t(20, FontWeight.w600, height: 1.3),
      // Subtitle/section heading — 16/Medium.
      titleMedium: t(16, FontWeight.w500, height: 1.35),
      // Body — descriptions, list rows, 14/Regular.
      bodyMedium: t(14, FontWeight.normal, height: 1.4),
      bodySmall: t(14, FontWeight.normal, color: p.textMuted, height: 1.4),
      // Label — buttons, chips, 13/Medium.
      labelLarge: t(13, FontWeight.w500, height: 1.3),
      // Caption — metadata, timestamps, 12/Regular.
      bodyLarge: t(12, FontWeight.normal, color: p.textMuted, height: 1.3),
    );

    OutlineInputBorder outline(Color c, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(HatlyRadius.input),
          borderSide: BorderSide(color: c, width: width),
        );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme.fromSeed(
        seedColor: HatlyColors.primaryOrange,
        brightness: brightness,
        primary: HatlyColors.primaryOrange,
        onPrimary: legacyOnOrange,
        surface: p.surface,
        onSurface: p.textPrimary,
        error: isDark ? p.urgent : HatlyColors.error,
      ),
      scaffoldBackgroundColor: p.background,
      canvasColor: p.background,
      dividerColor: p.border,
      textTheme: textTheme,
      extensions: [
        p,
        HatlyTextScale.build(primary: p.textPrimary, muted: p.textMuted)
      ],
      appBarTheme: AppBarTheme(
        backgroundColor: p.surface,
        foregroundColor: p.textPrimary,
        elevation: 0,
        // No Material-3 scroll-under tint: the bar keeps its surface colour while content scrolls beneath.
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: t(20, FontWeight.w600),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: HatlyColors.primaryOrange,
          disabledBackgroundColor: HatlyColors.primaryOrangeDisabled,
          foregroundColor: legacyOnOrange,
          minimumSize: const Size.fromHeight(48),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(HatlyRadius.button)),
          textStyle: t(13, FontWeight.w500, color: legacyOnOrange),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: p.textPrimary,
          side: BorderSide(color: p.textPrimary),
          minimumSize: const Size.fromHeight(48),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(HatlyRadius.button)),
          textStyle: t(13, FontWeight.w500),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: p.link,
          minimumSize: const Size(48, HatlyTouch.minTarget),
          textStyle: t(13, FontWeight.w500, color: p.link),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        // Dark Mode: a filled input needs to read as distinct from a card,
        // not the identical surface colour — `surfaceSoft` is a step lighter
        // than `surface` in the dark palette. Left as `p.surface` (unchanged)
        // in Light Mode so this does not alter the approved Light appearance.
        fillColor: isDark ? p.surfaceSoft : p.surface,
        contentPadding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
        border: outline(p.border),
        enabledBorder: outline(p.border),
        focusedBorder: outline(HatlyColors.primaryOrange, 2),
        errorBorder: outline(isDark ? p.urgent : HatlyColors.error),
        disabledBorder: outline(p.background),
        hintStyle: t(14, FontWeight.normal, color: p.textMuted),
      ),
      cardTheme: CardThemeData(
        color: p.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          side: BorderSide(color: p.border),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: p.surface,
        selectedColor: HatlyColors.primaryOrange,
        disabledColor: p.background,
        labelStyle: t(13, FontWeight.w500),
        secondaryLabelStyle: t(13, FontWeight.w500, color: legacyOnOrange),
        side: BorderSide(color: p.border),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(HatlyRadius.chip)),
        padding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.ms, vertical: HatlySpacing.xs),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: p.surface,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(HatlyRadius.dialog)),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
              top: Radius.circular(HatlyRadius.bottomSheetTop)),
        ),
      ),
    );
  }
}
