import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';

/// Entry point for the standalone Hatly Service
/// (`/hatly-service`, see `hatly_service_screen.dart`) — a wide,
/// first-class banner rather than an extra tile in "Shop by Category":
/// CONFIRMED this feature is deliberately NOT part of the marketplace
/// category grid (`home_category_section.dart`/"Categories" is on the
/// project's explicit do-not-change list), since it is not vendor- or
/// category-scoped at all. No pre-existing intended entry point for
/// this capability was found anywhere in the app (checked before
/// adding this), so this is a new, additive section — it does not
/// replace or reorder anything in the approved Home structure.
class HatlyServiceEntryCard extends StatelessWidget {
  const HatlyServiceEntryCard({super.key, this.buyFromPlaceOnly = false});

  /// UI entry context only. No change to Hatly/Wasaly cart or order workflows.
  final bool buyFromPlaceOnly;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    // chevron_right is a directional icon: Flutter mirrors it in RTL, so it always points "forward".
    const chevron = Icons.chevron_right;

    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: Semantics(
        button: true,
        label:
            '${l10n.hatlyServiceEntryTitle}. ${l10n.hatlyServiceEntrySubtitle}',
        excludeSemantics: true,
        child: InkWell(
          key: Key(buyFromPlaceOnly ? 'sector-hatly-service-entry' : 'home-hatly-service-entry'),
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          onTap: () => context.push(buyFromPlaceOnly
              ? '/hatly-service?entry=sector'
              : '/hatly-service'),
          child: Container(
            padding: const EdgeInsets.all(HatlySpacing.md),
            decoration: BoxDecoration(
              color: p.accentSoft,
              borderRadius: BorderRadius.circular(HatlyRadius.card),
            ),
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: p.accent,
                  foregroundColor: p.accentOn,
                  child: const Icon(Icons.support_agent_outlined),
                ),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.hatlyServiceEntryTitle,
                          style: context.type.title.copyWith(
                              color: p.textPrimary,
                              fontWeight: FontWeight.w800)),
                      const SizedBox(height: 2),
                      Text(l10n.hatlyServiceEntrySubtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: context.type.caption
                              .copyWith(color: p.textMuted)),
                    ],
                  ),
                ),
                Icon(chevron, color: p.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
