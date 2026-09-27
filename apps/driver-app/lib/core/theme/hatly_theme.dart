import 'package:flutter/material.dart';

/// Hatly brand: orange primary, white supporting (spec section 18).
/// Kept in one place so both the customer and driver apps (and the
/// design-tokens shared package, if promoted there later) stay in sync.
class HatlyColors {
  static const Color primaryOrange = Color(0xFFFF7A1A);
  static const Color primaryOrangeDark = Color(0xFFE0650A);
  static const Color surfaceWhite = Color(0xFFFFFFFF);
  static const Color textDark = Color(0xFF1A1A1A);
  static const Color textMuted = Color(0xFF6B6B6B);
  static const Color error = Color(0xFFD32F2F);
  static const Color success = Color(0xFF2E7D32);
}

class HatlyTheme {
  static ThemeData light() {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: HatlyColors.primaryOrange,
        primary: HatlyColors.primaryOrange,
        surface: HatlyColors.surfaceWhite,
      ),
      scaffoldBackgroundColor: HatlyColors.surfaceWhite,
      appBarTheme: const AppBarTheme(
        backgroundColor: HatlyColors.surfaceWhite,
        foregroundColor: HatlyColors.textDark,
        elevation: 0,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: HatlyColors.primaryOrange,
          foregroundColor: HatlyColors.surfaceWhite,
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
      textTheme: const TextTheme(
        bodyMedium: TextStyle(color: HatlyColors.textDark),
        bodySmall: TextStyle(color: HatlyColors.textMuted),
      ),
    );
  }
}
