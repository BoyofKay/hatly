import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/storage/theme_preference_storage.dart';
import 'package:hatly_customer/core/theme/theme_mode_provider.dart';
import 'package:hatly_customer/features/profile/presentation/widgets/theme_mode_selector.dart';

import '../../support/test_app.dart';

/// Same in-memory fake used by theme_mode_provider_test.dart — kept local
/// (not shared) since it is tiny and this is the only other file needing it.
class _FakeThemePreferenceStorage implements ThemePreferenceStorage {
  ThemeMode? saved;
  final saveCalls = <ThemeMode>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<ThemeMode?> readThemeMode() async => saved;

  @override
  Future<void> saveThemeMode(ThemeMode mode) async {
    saveCalls.add(mode);
    saved = mode;
  }
}

void main() {
  group('ThemeModeSelector (Profile ▸ المظهر)', () {
    testWidgets('shows all three choices with Arabic labels, System/Light/Dark',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(const ThemeModeSelector()));

      expect(find.text('المظهر'), findsOneWidget);
      expect(find.text('النظام'), findsOneWidget);
      expect(find.text('فاتح'), findsOneWidget);
      expect(find.text('داكن'), findsOneWidget);
    });

    testWidgets('the current mode is the one shown selected', (tester) async {
      final storage = _FakeThemePreferenceStorage();
      await tester.pumpWidget(hatlyTestApp(
        const ThemeModeSelector(),
        overrides: [
          themePreferenceStorageProvider.overrideWithValue(storage),
          initialThemeModeProvider.overrideWithValue(ThemeMode.dark),
        ],
      ));

      final button = tester.widget<SegmentedButton<ThemeMode>>(
          find.byType(SegmentedButton<ThemeMode>));
      expect(button.selected, {ThemeMode.dark});
    });

    testWidgets(
        'tapping "داكن" switches the app-wide provider to Dark and persists it — no restart needed',
        (tester) async {
      final storage = _FakeThemePreferenceStorage();
      await tester.pumpWidget(hatlyTestApp(
        const ThemeModeSelector(),
        overrides: [themePreferenceStorageProvider.overrideWithValue(storage)],
      ));

      // Starts on the conservative default.
      expect(
          tester
              .widget<SegmentedButton<ThemeMode>>(
                  find.byType(SegmentedButton<ThemeMode>))
              .selected,
          {ThemeMode.light});

      await tester.tap(find.text('داكن'));
      await tester.pumpAndSettle();

      expect(
          tester
              .widget<SegmentedButton<ThemeMode>>(
                  find.byType(SegmentedButton<ThemeMode>))
              .selected,
          {ThemeMode.dark});
      expect(storage.saveCalls, [ThemeMode.dark]);
    });

    testWidgets('every segment is a real interactive control ≥44px tall',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(const ThemeModeSelector()));
      final size =
          tester.getSize(find.byType(SegmentedButton<ThemeMode>));
      expect(size.height, greaterThanOrEqualTo(44));
    });

    testWidgets('renders correctly in Dark Mode too (no overflow/exception)',
        (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(const ThemeModeSelector(), dark: true));
      expect(tester.takeException(), isNull);
    });

    testWidgets('fits at 1.3x text scale without overflow', (tester) async {
      await tester.pumpWidget(
          hatlyTestApp(const ThemeModeSelector(), textScale: 1.3));
      expect(tester.takeException(), isNull);
    });
  });
}
