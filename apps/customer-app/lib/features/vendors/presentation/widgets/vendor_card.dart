import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/availability_badge.dart';
import '../../../../shared_widgets/hatly_rating_inline.dart';
import '../../../auth/presentation/auth_gate.dart';
import '../../../favorites/data/favorites_providers.dart';
import '../../domain/vendor.dart';
import '../../domain/opening_hours.dart';
import '../../../../shared_widgets/greyscale.dart';
import 'vendor_closed_dialog.dart';

/// Vendor summary card used both in Home's preview row and the full
/// Vendor List screen. Closed vendors are shown (not hidden) but
/// visually muted, matching how real delivery apps let a customer see
/// a closed vendor exists rather than disappearing it entirely.
///
/// UI/UX-2 Chunk 2 removed the star rating and the ETA/delivery-fee row from
/// this legacy card: the ETA/fee values are hardcoded `0` placeholders in
/// ApiVendorRepository._toVendor (they were being shown as if real).
///
/// Customer-facing vendor ratings are an APPROVED product requirement and
/// `ratingAverage`/`ratingCount` are real backend values, so this card shows
/// them (only when the vendor has at least one rating) next to the open/closed
/// badge — the trust signal a sector listing is scanned for. ETA / delivery fee
/// stay hidden: they are still `0` placeholders (see above).
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

    final p = context.palette;
    // Preserve Nov 23 store-closure behavior: visually mute the image,
    // present the closure dialog and allow browsing without ordering.
    final hoursLabel = todayHoursLabel(vendor.openingHours, l10n);
    void handleTap() => vendor.isOpen
        ? onTap()
        : showVendorClosedDialog(context,
            vendorName: displayName, hoursLabel: hoursLabel, onViewMenu: onTap);
    // Reference board ("قائمة المتاجر"): a compact white row — the store photo at the start, name, rating and status beside
    // it, the heart at the end. Closed vendors stay visible but their photo is muted (name and status stay readable).
    final card = DecoratedBox(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        boxShadow: HatlyShadows.soft(p),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          onTap: handleTap,
          child: Padding(
            padding: const EdgeInsets.all(HatlySpacing.ms),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Opacity(
                  opacity: vendor.isOpen ? 1.0 : 0.55,
                  child: Stack(
                    children: [
                      Greyscale(
                        enabled: !vendor.isOpen,
                        child: HatlySoftImage(
                          url: vendor.coverImageUrl ?? vendor.logoUrl,
                          width: 92, height: 92, radius: 14,
                          placeholderIcon: Icons.storefront_outlined,
                          placeholderIconSize: 34,
                        ),
                      ),
                      if (vendor.coverImageUrl != null &&
                          vendor.logoUrl != null)
                        PositionedDirectional(
                          bottom: 4,
                          start: 4,
                          child: Container(
                            padding: const EdgeInsets.all(1.5),
                            decoration: BoxDecoration(
                                color: p.surface, shape: BoxShape.circle),
                            child: HatlySoftImage(
                              url: vendor.logoUrl,
                              width: 28,
                              height: 28,
                              circular: true,
                              placeholderIcon: Icons.store_outlined,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displayName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.title
                            .copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: HatlySpacing.xs),
                      if (vendor.ratingCount > 0) ...[
                        HatlyRatingInline(
                            key: Key('vendor-card-rating-${vendor.id}'),
                            average: vendor.ratingAverage,
                            count: vendor.ratingCount),
                        const SizedBox(height: HatlySpacing.xs),
                      ],
                      Wrap(
                        spacing: HatlySpacing.sm,
                        runSpacing: HatlySpacing.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          AvailabilityBadge(
                            isOpen: vendor.isOpen,
                            openLabel: l10n.vendorOpenNow,
                            closedLabel: l10n.vendorClosed,
                          ),
                          if (vendor.hasPromotion)
                            HatlyBadge(
                                kind: HatlyBadgeKind.offer,
                                label: l10n.badgeOffer),
                          if (hoursLabel != null)
                            Row(
                              key: Key('vendor-card-hours-${vendor.id}'),
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.access_time_rounded,
                                  size: 15, color: p.textMuted),
                                const SizedBox(width: 4),
                                Text(hoursLabel, style: context.type.caption),
                              ],
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                _FavoriteHeartButton(vendorId: vendor.id),
              ],
            ),
          ),
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
              // Favourites belong to an account: a guest is sent to sign-in first (nothing is requested).
              if (!requireSignIn(context, ref)) return;
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
