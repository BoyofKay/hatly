import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../storage/locale_preference_storage.dart';

final localePreferenceStorageProvider =
    Provider<LocalePreferenceStorage>((ref) => LocalePreferenceStorage());

/// The language the app starts in — overridden once in `main()` with the saved
/// choice. Arabic is the default (Arabic-first product).
final initialLocaleProvider = Provider<Locale>((ref) => const Locale('ar'));

/// App-wide language: Arabic (RTL) or English (LTR), chosen in Settings and
/// persisted. Flutter derives the text direction from it, so switching needs
/// no restart and touches no session, cart or order state.
class LocaleController extends StateNotifier<Locale> {
  LocaleController(this._storage, Locale initial) : super(initial);

  final LocalePreferenceStorage _storage;

  Future<void> setLocale(Locale locale) async {
    if (state.languageCode == locale.languageCode) return;
    state = locale;
    await _storage.saveLocale(locale);
  }
}

final localeProvider = StateNotifierProvider<LocaleController, Locale>((ref) {
  return LocaleController(
    ref.read(localePreferenceStorageProvider),
    ref.read(initialLocaleProvider),
  );
});
