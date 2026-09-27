import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../shell/presentation/shell_tab_provider.dart';
import '../../data/home_address_provider.dart';
import 'address_selection_sheet.dart';

/// Compact location row: pin + the active/selected address + chevron (opens
/// the existing address-selection sheet), with a single Favorites shortcut on
/// the far side. Deliberately one line, no map. (Profile is already a bottom
/// navigation tab, so it gets no second entry here.)
///
/// The Favorites shortcut exists because the redesigned bottom navigation
/// (Home · Explore · Cart · Orders · Profile) no longer has a Favorites tab;
/// the Favorites screen itself is unchanged and still lives in the shell.
class HomeLocationBar extends ConsumerWidget {
  const HomeLocationBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final activeAddressAsync = ref.watch(homeActiveAddressProvider);
    final displayLabel = activeAddressAsync.whenOrNull(
      data: (address) => address == null
          ? null
          : (address.label?.isNotEmpty == true ? address.label : address.line1),
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(
          HatlySpacing.md, HatlySpacing.sm, HatlySpacing.sm, 0),
      child: Row(
        children: [
          Expanded(
            child: Semantics(
              button: true,
              label: displayLabel ?? l10n.selectAddressCta,
              onTap: () => showAddressSelectionSheet(context, ref),
              excludeSemantics: true,
              child: InkWell(
                borderRadius: BorderRadius.circular(HatlyRadius.button),
                onTap: () => showAddressSelectionSheet(context, ref),
                child: ConstrainedBox(
                  constraints:
                      const BoxConstraints(minHeight: HatlyTouch.minTarget),
                  child: Row(
                    children: [
                      Icon(Icons.location_on_rounded,
                          color: p.accent, size: 22),
                      const SizedBox(width: HatlySpacing.xs),
                      Flexible(
                        child: Text(
                          displayLabel ?? l10n.selectAddressCta,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.type.small.copyWith(
                              color: p.textPrimary,
                              fontWeight: FontWeight.w700),
                        ),
                      ),
                      Icon(Icons.keyboard_arrow_down_rounded,
                          size: 20, color: p.textMuted),
                    ],
                  ),
                ),
              ),
            ),
          ),
          _RoundIconButton(
            icon: Icons.favorite_border_rounded,
            tooltip: l10n.homeFavoritesShortcut,
            onTap: () => ref.read(shellTabIndexProvider.notifier).state =
                ShellTab.favorites,
          ),
        ],
      ),
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton(
      {required this.icon, required this.tooltip, required this.onTap});

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return IconButton(
      tooltip: tooltip,
      onPressed: onTap,
      constraints: const BoxConstraints(
          minWidth: HatlyTouch.minTarget, minHeight: HatlyTouch.minTarget),
      icon: Icon(icon, color: p.textPrimary, size: 22),
    );
  }
}
