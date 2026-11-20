import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/localization/locale_provider.dart';
import 'package:hatly_customer/core/storage/locale_preference_storage.dart';
import 'package:hatly_customer/features/profile/presentation/settings_screen.dart';
import 'package:hatly_customer/features/profile/presentation/widgets/delete_account_section.dart';
import 'package:hatly_customer/features/profile/presentation/widgets/password_change_section.dart';
import 'package:hatly_customer/features/profile/presentation/widgets/theme_mode_selector.dart';

import '../../support/test_app.dart';

class _MemoryLocaleStorage implements LocalePreferenceStorage {
  Locale? saved;
  @override
  Future<Locale?> readLocale() async => saved;
  @override
  Future<void> saveLocale(Locale locale) async => saved = locale;
}

void main() {
  testWidgets(
      'Settings gathers language, appearance, password and account deletion',
      (tester) async {
    tester.view.physicalSize = const Size(390, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(hatlyTestApp(const SettingsScreen(), overrides: [
      localePreferenceStorageProvider.overrideWithValue(_MemoryLocaleStorage()),
    ]));
    await tester.pumpAndSettle();
    expect(find.text('الإعدادات'), findsOneWidget);
    expect(find.byKey(const Key('settings-language')), findsOneWidget);
    expect(find.byType(ThemeModeSelector), findsOneWidget);
    expect(find.byType(PasswordChangeSection), findsOneWidget);
    expect(find.byType(DeleteAccountSection), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('choosing English updates the app language and persists it',
      (tester) async {
    final storage = _MemoryLocaleStorage();
    await tester.pumpWidget(hatlyTestApp(const SettingsScreen(), overrides: [
      localePreferenceStorageProvider.overrideWithValue(storage),
    ]));
    await tester.pumpAndSettle();
    final container =
        ProviderScope.containerOf(tester.element(find.byType(SettingsScreen)));
    expect(container.read(localeProvider).languageCode, 'ar');

    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(container.read(localeProvider).languageCode, 'en');
    expect(storage.saved, const Locale('en'));
  });

  for (final scenario in const [
    ('ar 320 2x', Locale('ar'), 2.0),
    ('en 320 2x', Locale('en'), 2.0),
  ]) {
    testWidgets('no overflow: ${scenario.$1}', (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyTestApp(const SettingsScreen(),
          locale: scenario.$2,
          textScale: scenario.$3,
          overrides: [
            localePreferenceStorageProvider
                .overrideWithValue(_MemoryLocaleStorage()),
          ]));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
