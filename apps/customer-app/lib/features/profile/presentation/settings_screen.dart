import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/localization/locale_provider.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_surface.dart';
import 'widgets/delete_account_section.dart';
import 'widgets/password_change_section.dart';
import 'widgets/theme_mode_selector.dart';

/// Settings (reference board): the app's real, device-level and account
/// settings in one place — language (Arabic RTL / English LTR, persisted),
/// appearance, password, and account deletion. Notification preferences,
/// share and rate are not offered: the backend has no notification-preference
/// API and there is no store link to share yet, so nothing is faked here.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileSettings)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
            HatlySpacing.md, HatlySpacing.sm, HatlySpacing.md, HatlySpacing.xl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _SectionTitle(l10n.settingsAppSection),
            const _LanguageSelector(),
            const SizedBox(height: HatlySpacing.md),
            const ThemeModeSelector(),
            const SizedBox(height: HatlySpacing.lg),
            _SectionTitle(l10n.settingsPasswordSection),
            const PasswordChangeSection(),
            const SizedBox(height: HatlySpacing.lg),
            _SectionTitle(l10n.settingsAccountSection),
            const DeleteAccountSection(),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
        child: Text(text,
            style: context.type.small.copyWith(
                color: context.palette.textMuted, fontWeight: FontWeight.w700)),
      );
}

/// Arabic / English, as a two-segment control in the same card style as the
/// appearance selector. Switching re-lays the whole app out (RTL ⇄ LTR) at once.
class _LanguageSelector extends ConsumerWidget {
  const _LanguageSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final current = ref.watch(localeProvider).languageCode;
    // Same card and control as the appearance selector below it, so the two settings read as one family.
    return HatlySurface(
      key: const Key('settings-language'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(l10n.settingsLanguage, style: context.type.title),
          ),
          const SizedBox(height: HatlySpacing.sm),
          SegmentedButton<String>(
            style: SegmentedButton.styleFrom(
              minimumSize: const Size(0, HatlyTouch.minTarget),
              padding: const EdgeInsets.symmetric(horizontal: 2),
              textStyle: context.type.small,
            ),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                  value: 'ar', label: Text(l10n.languageArabic, maxLines: 1)),
              ButtonSegment(
                  value: 'en', label: Text(l10n.languageEnglish, maxLines: 1)),
            ],
            selected: {current},
            onSelectionChanged: (s) =>
                ref.read(localeProvider.notifier).setLocale(Locale(s.first)),
          ),
        ],
      ),
    );
  }
}
