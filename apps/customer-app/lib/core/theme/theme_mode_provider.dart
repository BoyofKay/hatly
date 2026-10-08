import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../storage/theme_preference_storage.dart';

final themePreferenceStorageProvider =
    Provider<ThemePreferenceStorage>((ref) => ThemePreferenceStorage());

/// The theme mode the app should render with BEFORE any saved preference is
/// read — overridden once, in `main()`, with whatever was persisted (or
/// [ThemeMode.light] if nothing was saved yet, or this is the first launch).
/// Reading it here, before `runApp`, means [ThemeModeController] starts
/// already-correct: no flash of the wrong theme on a cold start, and no
/// FutureBuilder/loading state needed anywhere in the widget tree.
final initialThemeModeProvider = Provider<ThemeMode>((ref) => ThemeMode.light);

/// App-wide theme mode: an explicit, persisted USER choice (Light / Dark /
/// System), never forced. Defaults to [ThemeMode.light] for a customer who
/// has never chosen — a deliberate, conservative rollout choice (this is
/// Dark Mode's first real release across the whole app) rather than
/// defaulting new installs straight into [ThemeMode.system]; System and Dark
/// remain one tap away in Profile ▸ "المظهر" (Appearance) at any time.
/// Changing it never touches auth/session state (`TokenStorage`/
/// `sessionControllerProvider`) or cart/order state — it only updates this
/// provider and persists the choice via [ThemePreferenceStorage], which
/// `main.dart`'s `MaterialApp.router(themeMode: ref.watch(themeModeProvider))`
/// already reacts to immediately, with no restart required.
class ThemeModeController extends StateNotifier<ThemeMode> {
  ThemeModeController(this._storage, ThemeMode initial) : super(initial);

  final ThemePreferenceStorage _storage;

  Future<void> setThemeMode(ThemeMode mode) async {
    if (state == mode) return;
    state = mode;
    await _storage.saveThemeMode(mode);
  }
}

final themeModeProvider =
    StateNotifierProvider<ThemeModeController, ThemeMode>((ref) {
  return ThemeModeController(
    ref.read(themePreferenceStorageProvider),
    ref.read(initialThemeModeProvider),
  );
});
