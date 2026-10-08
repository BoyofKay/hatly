import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists the customer's EXPLICIT theme-mode choice (Light/Dark/System)
/// across app restarts. Deliberately a separate store from
/// [TokenStorage]/`flutter_secure_storage` (core/storage/token_storage.dart):
/// a theme preference is a device/user display setting, not session data —
/// it must survive `TokenStorage.clear()` on logout (spec: "changing theme
/// does not affect auth/session state") and is not sensitive, so the
/// lighter-weight `shared_preferences` (already the standard Flutter choice
/// for exactly this kind of non-sensitive local setting) is used instead of
/// the Keychain/EncryptedSharedPreferences-backed secure storage.
class ThemePreferenceStorage {
  static const _key = 'hatly_theme_mode';

  Future<ThemeMode?> readThemeMode() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_key);
    for (final mode in ThemeMode.values) {
      if (mode.name == value) return mode;
    }
    return null;
  }

  Future<void> saveThemeMode(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, mode.name);
  }
}
