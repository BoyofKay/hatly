import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/storage/theme_preference_storage.dart';
import 'package:hatly_customer/core/theme/theme_mode_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// In-memory fake — same `implements ... { noSuchMethod }` pattern used
/// throughout this codebase's other fakes (e.g. `_FakeWalletApi`). Avoids
/// touching the real `shared_preferences` plugin channel in a plain
/// `ProviderContainer` test.
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
  group('ThemeModeController', () {
    test('starts at the seeded initial mode, not always Light', () {
      final storage = _FakeThemePreferenceStorage();
      final container = ProviderContainer(overrides: [
        themePreferenceStorageProvider.overrideWithValue(storage),
        initialThemeModeProvider.overrideWithValue(ThemeMode.dark),
      ]);
      addTearDown(container.dispose);

      expect(container.read(themeModeProvider), ThemeMode.dark);
    });

    test('defaults to Light when nothing was seeded (conservative rollout)',
        () {
      final storage = _FakeThemePreferenceStorage();
      final container = ProviderContainer(overrides: [
        themePreferenceStorageProvider.overrideWithValue(storage),
      ]);
      addTearDown(container.dispose);

      expect(container.read(themeModeProvider), ThemeMode.light);
    });

    test('setThemeMode updates state immediately and persists the choice',
        () async {
      final storage = _FakeThemePreferenceStorage();
      final container = ProviderContainer(overrides: [
        themePreferenceStorageProvider.overrideWithValue(storage),
      ]);
      addTearDown(container.dispose);

      await container
          .read(themeModeProvider.notifier)
          .setThemeMode(ThemeMode.dark);

      expect(container.read(themeModeProvider), ThemeMode.dark);
      expect(storage.saveCalls, [ThemeMode.dark]);
    });

    test('picking the already-active mode again does not re-persist',
        () async {
      final storage = _FakeThemePreferenceStorage();
      final container = ProviderContainer(overrides: [
        themePreferenceStorageProvider.overrideWithValue(storage),
        initialThemeModeProvider.overrideWithValue(ThemeMode.light),
      ]);
      addTearDown(container.dispose);

      await container
          .read(themeModeProvider.notifier)
          .setThemeMode(ThemeMode.light);

      expect(storage.saveCalls, isEmpty);
    });

    test('every mode round-trips through setThemeMode + persistence',
        () async {
      final storage = _FakeThemePreferenceStorage();
      final container = ProviderContainer(overrides: [
        themePreferenceStorageProvider.overrideWithValue(storage),
      ]);
      addTearDown(container.dispose);

      for (final mode in ThemeMode.values) {
        await container.read(themeModeProvider.notifier).setThemeMode(mode);
        expect(container.read(themeModeProvider), mode);
        expect(storage.saved, mode);
      }
    });
  });

  group('ThemePreferenceStorage (the real, shared_preferences-backed impl)',
      () {
    // `SharedPreferences.setMockInitialValues` is the package's own
    // documented way to unit-test code built on it without a real platform.
    setUp(() => SharedPreferences.setMockInitialValues({}));

    test('reads null when nothing was ever saved', () async {
      expect(await ThemePreferenceStorage().readThemeMode(), isNull);
    });

    test(
        'round-trips a saved mode across separate instances (simulating a restart)',
        () async {
      await ThemePreferenceStorage().saveThemeMode(ThemeMode.dark);

      // A fresh instance — nothing but the persisted value ties it to the
      // one that saved.
      expect(await ThemePreferenceStorage().readThemeMode(), ThemeMode.dark);
    });

    test('every ThemeMode round-trips', () async {
      for (final mode in ThemeMode.values) {
        await ThemePreferenceStorage().saveThemeMode(mode);
        expect(await ThemePreferenceStorage().readThemeMode(), mode);
      }
    });
  });
}
