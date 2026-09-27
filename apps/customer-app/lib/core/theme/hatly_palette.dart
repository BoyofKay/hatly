import 'package:flutter/material.dart';
import 'hatly_typography.dart';

/// Semantic colours that differ between light and dark. The brand orange is
/// the SAME in both modes and is the one already defined in
/// `HatlyColors.primaryOrange` (extracted from the existing Hatly brand) —
/// it is never redefined here.
///
/// Widgets read this through `context.palette` instead of hard-coding
/// `HatlyColors.surfaceWhite` / `textDark`, so a screen migrated to the
/// palette works in both themes without further changes.
@immutable
class HatlyPalette extends ThemeExtension<HatlyPalette> {
  const HatlyPalette({
    required this.background,
    required this.surface,
    required this.surfaceSoft,
    required this.textPrimary,
    required this.textMuted,
    required this.border,
    required this.shadow,
    required this.accent,
    required this.accentOn,
    required this.accentSoft,
    required this.link,
    required this.success,
    required this.warning,
    required this.info,
    required this.urgent,
    required this.neutralStatus,
  });

  /// Screen background — soft off-white (light) / near-black (dark).
  final Color background;

  /// Cards, sheets, the floating navigation.
  final Color surface;

  /// Soft filled controls (search bar), image containers/placeholders.
  final Color surfaceSoft;
  final Color textPrimary;
  final Color textMuted;
  final Color border;
  final Color shadow;

  /// Brand orange (identical in both modes) and the ink drawn on top of it.
  final Color accent;
  final Color accentOn;

  /// Subtle orange tint — the active bottom-nav pill.
  final Color accentSoft;

  /// Orange used for *text* links ("عرض الكل ←"): the darker brand shade in
  /// light mode (better contrast on white), the brand orange in dark mode.
  final Color link;

  final Color success;
  final Color warning;
  final Color info;
  final Color urgent;
  final Color neutralStatus;

  static const Color _brandOrange = Color(0xFFFF7A1A);
  static const Color _brandOrangeDark = Color(0xFFE0650A);

  static const light = HatlyPalette(
    background: Color(0xFFFAFAFA),
    surface: Color(0xFFFFFFFF),
    surfaceSoft: Color(0xFFF1F1F1),
    textPrimary: Color(0xFF1A1A1A),
    textMuted: Color(0xFF6B6B6B),
    border: Color(0xFFE5E5E5),
    shadow: Color(0x14000000), // 8% black — soft
    accent: _brandOrange,
    // Dark ink on the brand orange: 7:1. White on #FF7A1A is only 2.6:1, which fails
    // accessibility for text, so NEW components never put white text on the brand fill.
    accentOn: Color(0xFF1A1A1A),
    accentSoft: Color(0x1FFF7A1A), // 12% orange
    link: _brandOrangeDark,
    success: Color(0xFF2E7D32),
    warning: Color(0xFFB45309),
    info: Color(0xFF0369A1),
    urgent: Color(0xFFD32F2F),
    neutralStatus: Color(0xFF6B6B6B),
  );

  static const dark = HatlyPalette(
    background: Color(0xFF111111),
    surface: Color(0xFF1C1C1E),
    surfaceSoft: Color(0xFF2A2A2D),
    textPrimary: Color(0xFFF2F2F2),
    textMuted: Color(0xFFA8A8AD),
    border: Color(0xFF38383A),
    shadow: Color(0x66000000),
    accent: _brandOrange,
    accentOn: Color(0xFF1A1A1A),
    accentSoft: Color(0x33FF7A1A), // 20% orange
    link: _brandOrange,
    success: Color(0xFF66BB6A),
    warning: Color(0xFFFFB74D),
    info: Color(0xFF4FC3F7),
    urgent: Color(0xFFEF5350),
    neutralStatus: Color(0xFFA8A8AD),
  );

  @override
  HatlyPalette copyWith({
    Color? background,
    Color? surface,
    Color? surfaceSoft,
    Color? textPrimary,
    Color? textMuted,
    Color? border,
    Color? shadow,
    Color? accent,
    Color? accentOn,
    Color? accentSoft,
    Color? link,
    Color? success,
    Color? warning,
    Color? info,
    Color? urgent,
    Color? neutralStatus,
  }) {
    return HatlyPalette(
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surfaceSoft: surfaceSoft ?? this.surfaceSoft,
      textPrimary: textPrimary ?? this.textPrimary,
      textMuted: textMuted ?? this.textMuted,
      border: border ?? this.border,
      shadow: shadow ?? this.shadow,
      accent: accent ?? this.accent,
      accentOn: accentOn ?? this.accentOn,
      accentSoft: accentSoft ?? this.accentSoft,
      link: link ?? this.link,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      info: info ?? this.info,
      urgent: urgent ?? this.urgent,
      neutralStatus: neutralStatus ?? this.neutralStatus,
    );
  }

  @override
  HatlyPalette lerp(ThemeExtension<HatlyPalette>? other, double t) {
    if (other is! HatlyPalette) return this;
    Color c(Color a, Color b) => Color.lerp(a, b, t)!;
    return HatlyPalette(
      background: c(background, other.background),
      surface: c(surface, other.surface),
      surfaceSoft: c(surfaceSoft, other.surfaceSoft),
      textPrimary: c(textPrimary, other.textPrimary),
      textMuted: c(textMuted, other.textMuted),
      border: c(border, other.border),
      shadow: c(shadow, other.shadow),
      accent: c(accent, other.accent),
      accentOn: c(accentOn, other.accentOn),
      accentSoft: c(accentSoft, other.accentSoft),
      link: c(link, other.link),
      success: c(success, other.success),
      warning: c(warning, other.warning),
      info: c(info, other.info),
      urgent: c(urgent, other.urgent),
      neutralStatus: c(neutralStatus, other.neutralStatus),
    );
  }
}

/// Soft, subtle elevation only — never a heavy shadow.
class HatlyShadows {
  HatlyShadows._();

  static List<BoxShadow> soft(HatlyPalette p) => [
        BoxShadow(color: p.shadow, blurRadius: 12, offset: const Offset(0, 2)),
      ];

  /// The floating bottom navigation sits a little higher off the page.
  static List<BoxShadow> floating(HatlyPalette p) => [
        BoxShadow(color: p.shadow, blurRadius: 20, offset: const Offset(0, 4)),
      ];
}

/// `context.palette` / `context.type` — theme-aware tokens for any widget.
/// They fall back to the light palette/scale when no Hatly theme is
/// installed (e.g. a bare `MaterialApp` in a widget test).
extension HatlyThemeContext on BuildContext {
  HatlyPalette get palette =>
      Theme.of(this).extension<HatlyPalette>() ?? HatlyPalette.light;

  HatlyTextScale get type =>
      Theme.of(this).extension<HatlyTextScale>() ??
      HatlyTextScale.build(
          primary: HatlyPalette.light.textPrimary,
          muted: HatlyPalette.light.textMuted);
}
