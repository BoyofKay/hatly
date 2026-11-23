import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../data/home_address_provider.dart';
import 'address_selection_sheet.dart';

/// Compact address row only. Notification and Favorites now belong to the persistent global header, so they never duplicate on Home.
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
        ],
      ),
    );
  }
}

