import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_card.dart';
import '../../../../shared_widgets/hatly_image.dart';
import '../../../../shared_widgets/availability_badge.dart';
import '../../../favorites/data/favorites_providers.dart';
import '../../domain/vendor.dart';

/// Vendor summary card used both in Home's preview row and the full
/// Vendor List screen. Closed vendors are shown (not hidden) but
/// visually muted, matching how real delivery apps let a customer see
/// a closed vendor exists rather than disappearing it entirely.
///
/// UI/UX-2 Chunk 2 removed the star rating and the ETA/delivery-fee row from
/// this legacy card: the ETA/fee values are hardcoded `0` placeholders in
/// ApiVendorRepository._toVendor (they were being shown as if real).
///
/// UPDATE: customer-facing vendor ratings are now an APPROVED product
/// requirement (the earlier "ratings/reviews are prohibited" rule no longer
/// applies). `ratingAverage`/`ratingCount` are real backend values, and the
/// redesigned Home/Explore card (`VendorCoverCard`) shows them. This legacy
/// card is used by the Vendor List screen, which is outside the Explore task,
/// so it is intentionally left as-is until that screen is redesigned.
class VendorCard extends StatelessWidget {
  const VendorCard(
      {super.key, required this.vendor, required this.onTap, this.width});

  final Vendor vendor;
  final VoidCallback onTap;

  /// When set, constrains the card to a fixed width — used for Home's
  /// horizontally-scrolling preview row. Left null for the full-width
  /// vertical Vendor List screen.
  final double? width;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final displayName =
        isArabic && vendor.nameAr != null ? vendor.nameAr! : vendor.name;

    final card = Opacity(
      opacity: vendor.isOpen ? 1.0 : 0.55,
      child: HatlyCard(
        onTap: onTap,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _VendorLogo(
                logoUrl: vendor.logoUrl, hasPromotion: vendor.hasPromotion),
            const SizedBox(width: HatlySpacing.ms),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: HatlySpacing.xs),
                  AvailabilityBadge(
                    isOpen: vendor.isOpen,
                    openLabel: l10n.vendorOpenNow,
                    closedLabel: l10n.vendorClosed,
                  ),
                ],
              ),
            ),
            _FavoriteHeartButton(vendorId: vendor.id),
          ],
        ),
      ),
    );

    return SizedBox(width: width, child: card);
  }
}

/// Favorites Chunk 3. Vendor-based, source of truth is
/// `favoritesControllerProvider` (Chunk 2) exclusively — never a
/// per-card GET request, never a second local favorite state. Narrow
/// `ConsumerWidget` (not the whole VendorCard) so only the heart
/// itself rebuilds when the Favorites collection changes, per this
/// chunk's own "don't rebuild unrelated parts" guidance — a small,
/// simple scoping choice, not a custom selector architecture.
class _FavoriteHeartButton extends ConsumerWidget {
  const _FavoriteHeartButton({required this.vendorId});

  final String vendorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final controller = ref.watch(favoritesControllerProvider.notifier);
    // CONFIRMED: reading `.isLoading` on the whole collection's
    // AsyncValue (not a per-vendor in-flight flag — the provider's
    // own `_pendingVendorIds` is intentionally private) is the
    // closest available in-flight signal without duplicating the
    // provider's internal locking in this widget; it briefly disables
    // every heart during a refresh, which is a small, acceptable
    // in-flight indication for a personal, low-frequency action like
    // this, not a functional bug — the provider itself still
    // guarantees no duplicate API call per vendorId regardless.
    final isLoading = ref.watch(favoritesControllerProvider).isLoading;
    final isFavorited = controller.isFavorited(vendorId);

    return IconButton(
      // A nested IconButton has its own ink response, consuming the
      // tap before it can bubble to HatlyCard's own onTap — the same
      // confirmed-safe pattern already used for the Saved Addresses
      // delete action, so this never accidentally triggers card
      // navigation.
      icon: Icon(
        isFavorited ? Icons.favorite : Icons.favorite_border,
        // Polish pass: the unselected state was `HatlyColors.textMuted` (fixed
        // light-mode constant) — too dark a gray on a dark background. The
        // equivalent heart on Vendor Details already correctly used `p.textMuted`.
        color: isFavorited ? HatlyColors.primaryOrange : p.textMuted,
      ),
      tooltip:
          isFavorited ? l10n.favoritesRemoveAction : l10n.favoritesAddAction,
      onPressed: isLoading
          ? null
          : () async {
              final error = isFavorited
                  ? await controller.remove(vendorId)
                  : await controller.add(vendorId);
              // The provider's own refreshed state (or its unchanged
              // state on failure) is what this widget reads on the
              // next build via `.watch` above — nothing is set
              // locally here, so there is no way for the heart to get
              // stuck showing a state the provider doesn't actually
              // hold.
              if (error != null && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(l10n.somethingWentWrong)),
                );
              }
            },
    );
  }
}

class _VendorLogo extends StatelessWidget {
  const _VendorLogo({required this.logoUrl, required this.hasPromotion});

  final String? logoUrl;
  final bool hasPromotion;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        HatlyImage(
            url: logoUrl,
            width: 64,
            height: 64,
            shape: HatlyImageShape.circular),
        if (hasPromotion)
          // Polish pass: was a fixed physical `right:` offset — the sibling
          // `VendorCoverCard`'s equivalent badge already uses `PositionedDirectional`
          // so it mirrors correctly under RTL; this one didn't.
          PositionedDirectional(
            top: -6,
            end: -6,
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: const BoxDecoration(
                  color: HatlyColors.primaryOrange, shape: BoxShape.circle),
              child: const Icon(Icons.local_offer,
                  size: 12, color: HatlyColors.surfaceWhite),
            ),
          ),
      ],
    );
  }
}
