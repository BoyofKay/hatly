import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists the customer's explicit app-language choice (Arabic / English).
/// Same reasoning as [ThemePreferenceStorage]: a non-sensitive display
/// setting that must survive logout, so `shared_preferences`, not secure storage.
class LocalePreferenceStorage {
  static const _key = 'hatly_locale';

  Future<Locale?> readLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_key);
    return value == 'ar' || value == 'en' ? Locale(value!) : null;
  }

  Future<void> saveLocale(Locale locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, locale.languageCode);
  }
}
