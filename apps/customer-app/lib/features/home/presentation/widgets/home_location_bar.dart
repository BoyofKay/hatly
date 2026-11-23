import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
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
      padding: const EdgeInsetsDirectional.fromSTEB(
          HatlySpacing.md, HatlySpacing.sm, HatlySpacing.xs, 0),
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
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.homeDeliverTo,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.caption
                            .copyWith(color: p.textMuted, height: 1.2),
                      ),
                      Row(
                        children: [
                          Icon(Icons.location_on_rounded,
                              color: p.accent, size: 18),
                          const SizedBox(width: 2),
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
                              size: 20, color: p.accent),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

