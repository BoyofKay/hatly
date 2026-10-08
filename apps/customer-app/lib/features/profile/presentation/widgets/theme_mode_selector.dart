import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/theme/theme_mode_provider.dart';
import '../../../../shared_widgets/hatly_surface.dart';

/// Profile ▸ "المظهر" (Appearance) — the customer's ONLY control for Dark
/// Mode. Three explicit choices, never forced into any of them: System
/// follows the device setting, Light/Dark are pinned regardless of the
/// device. See `theme_mode_provider.dart` for why Light is the DEFAULT for a
/// customer who hasn't chosen yet — System and Dark remain one tap away
/// here at any time.
///
/// Picking one only updates `themeModeProvider` and persists the choice via
/// `ThemePreferenceStorage` — it never touches auth/session
/// (`sessionControllerProvider`/`TokenStorage`) or cart/order state, and
/// `main.dart`'s `MaterialApp.router(themeMode: ref.watch(themeModeProvider))`
/// re-themes the whole app immediately, with no restart.
class ThemeModeSelector extends ConsumerWidget {
  const ThemeModeSelector({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final mode = ref.watch(themeModeProvider);

    return HatlySurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(l10n.profileAppearanceTitle, style: context.type.title),
          ),
          const SizedBox(height: HatlySpacing.sm),
          SegmentedButton<ThemeMode>(
            key: const Key('profile-appearance-selector'),
            style: SegmentedButton.styleFrom(
              minimumSize: const Size(0, HatlyTouch.minTarget),
              // Tight, icon-free labels: at this card's width, "النظام"
              // (the widest of the three) wrapped to two lines with the
              // Material3 default padding/icon combination.
              padding: const EdgeInsets.symmetric(horizontal: 2),
              textStyle: context.type.small,
            ),
            segments: [
              ButtonSegment(
                value: ThemeMode.system,
                label: Text(l10n.themeModeSystem, maxLines: 1),
              ),
              ButtonSegment(
                value: ThemeMode.light,
                label: Text(l10n.themeModeLight, maxLines: 1),
              ),
              ButtonSegment(
                value: ThemeMode.dark,
                label: Text(l10n.themeModeDark, maxLines: 1),
              ),
            ],
            selected: {mode},
            showSelectedIcon: false,
            onSelectionChanged: (selection) {
              ref
                  .read(themeModeProvider.notifier)
                  .setThemeMode(selection.first);
            },
          ),
        ],
      ),
    );
  }
}
