import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Approved type scale (Design System v1):
/// Display 28 · H1 24 · H2 20 · Title 18 · Body 16 · Small 14 · Caption 12.
///
/// Font strategy: **Inter is the primary family and Cairo is its fallback.**
/// Inter has no Arabic glyphs, so Arabic text falls through to Cairo while
/// Latin letters and digits render in Inter — exactly "Cairo for Arabic,
/// Inter for English/Latin/numbers", with no per-string language sniffing.
class HatlyTypography {
  HatlyTypography._();

  /// Tests (no network, no bundled font files) switch this off so the theme
  /// still has the same family/fallback structure without triggering
  /// google_fonts downloads. Always true in the running app.
  static bool useGoogleFonts = true;

  static const double display = 28;
  static const double h1 = 24;
  static const double h2 = 20;
  static const double title = 18;
  static const double body = 16;
  static const double small = 14;
  static const double caption = 12;

  /// One text style in the Inter(+Cairo fallback) family.
  static TextStyle style({
    required double fontSize,
    required FontWeight fontWeight,
    Color? color,
    double? height,
  }) {
    if (!useGoogleFonts) {
      return TextStyle(
        fontFamily: 'Inter',
        fontFamilyFallback: const ['Cairo'],
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: height,
      );
    }
    final inter = GoogleFonts.inter(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        height: height);
    final cairoFamily = GoogleFonts.cairo(fontWeight: fontWeight).fontFamily;
    return inter
        .copyWith(fontFamilyFallback: [if (cairoFamily != null) cairoFamily]);
  }
}

/// The approved scale as a [ThemeExtension], so any widget can ask for
/// `context.type.h2` and get the right size, weight and colour for the
/// current (light/dark) theme.
@immutable
class HatlyTextScale extends ThemeExtension<HatlyTextScale> {
  const HatlyTextScale({
    required this.display,
    required this.h1,
    required this.h2,
    required this.title,
    required this.body,
    required this.small,
    required this.caption,
  });

  final TextStyle display;
  final TextStyle h1;
  final TextStyle h2;
  final TextStyle title;
  final TextStyle body;
  final TextStyle small;
  final TextStyle caption;

  /// [primary] is the main text colour, [muted] the secondary one (captions,
  /// metadata).
  factory HatlyTextScale.build({required Color primary, required Color muted}) {
    TextStyle s(double size, FontWeight w,
            {Color? color, double height = 1.4}) =>
        HatlyTypography.style(
            fontSize: size,
            fontWeight: w,
            color: color ?? primary,
            height: height);
    return HatlyTextScale(
      display: s(HatlyTypography.display, FontWeight.w700, height: 1.3),
      h1: s(HatlyTypography.h1, FontWeight.w700, height: 1.3),
      h2: s(HatlyTypography.h2, FontWeight.w700, height: 1.3),
      title: s(HatlyTypography.title, FontWeight.w600, height: 1.35),
      body: s(HatlyTypography.body, FontWeight.w400),
      small: s(HatlyTypography.small, FontWeight.w400, color: muted),
      caption: s(HatlyTypography.caption, FontWeight.w500,
          color: muted, height: 1.3),
    );
  }

  @override
  HatlyTextScale copyWith({
    TextStyle? display,
    TextStyle? h1,
    TextStyle? h2,
    TextStyle? title,
    TextStyle? body,
    TextStyle? small,
    TextStyle? caption,
  }) {
    return HatlyTextScale(
      display: display ?? this.display,
      h1: h1 ?? this.h1,
      h2: h2 ?? this.h2,
      title: title ?? this.title,
      body: body ?? this.body,
      small: small ?? this.small,
      caption: caption ?? this.caption,
    );
  }

  @override
  HatlyTextScale lerp(ThemeExtension<HatlyTextScale>? other, double t) {
    if (other is! HatlyTextScale) return this;
    return HatlyTextScale(
      display: TextStyle.lerp(display, other.display, t)!,
      h1: TextStyle.lerp(h1, other.h1, t)!,
      h2: TextStyle.lerp(h2, other.h2, t)!,
      title: TextStyle.lerp(title, other.title, t)!,
      body: TextStyle.lerp(body, other.body, t)!,
      small: TextStyle.lerp(small, other.small, t)!,
      caption: TextStyle.lerp(caption, other.caption, t)!,
    );
  }
}
