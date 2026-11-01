import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Arabic is the app's language; English is one tap away and is remembered. Every screen string is written once in each language at the place
/// it is used (`context.t('Delivered', 'تم التسليم')`), so a missing translation is visible in review, never a silent fallback.
extension BilingualContext on BuildContext {
  bool get isArabic => Localizations.localeOf(this).languageCode == 'ar';
  String t(String en, String ar) => isArabic ? ar : en;
}

const _localeKey = 'hatly_driver_locale';

class LocaleController extends StateNotifier<Locale> {
  LocaleController({FlutterSecureStorage? storage, Locale initial = const Locale('ar')})
      : _storage = storage ?? const FlutterSecureStorage(),
        super(initial);

  final FlutterSecureStorage _storage;

  /// Restores the saved language (best effort: an unreadable store keeps the default).
  Future<void> restore() async {
    try {
      final saved = await _storage.read(key: _localeKey);
      if (saved == 'en' || saved == 'ar') state = Locale(saved!);
    } catch (_) {/* keep the default */}
  }

  Future<void> set(Locale locale) async {
    state = locale;
    try {
      await _storage.write(key: _localeKey, value: locale.languageCode);
    } catch (_) {/* not remembered */}
  }
}

final localeProvider = StateNotifierProvider<LocaleController, Locale>((ref) => LocaleController()..restore());
