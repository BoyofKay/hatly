import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_card.dart';
import '../../../shared_widgets/hatly_image.dart';
import '../../../shared_widgets/availability_badge.dart';
import '../data/favorites_providers.dart';
import '../domain/favorite_vendor.dart';

/// Favorites Chunk 4. Real, backend-backed screen — replaces the
/// previous "coming soon" placeholder. Reads exclusively from the
/// existing `favoritesControllerProvider` (Chunk 2) — no direct
/// `FavoritesApi` call, no second Favorites state, no per-Vendor
/// request.
///
/// KNOWN, DELIBERATE DEVIATION from "reuse the existing VendorCard"
/// verbatim: `VendorCard` requires a full `Vendor` object with
/// several fields the Favorites backend never returns at all
/// (`category`, `ratingAverage`, `ratingCount`, `etaMinMinutes`,
/// `etaMaxMinutes`, `deliveryFeeMinor` — confirmed required,
/// non-nullable constructor params on `Vendor`, per
/// `vendor.dart`). Constructing a fake `Vendor` from `FavoriteVendor`
/// to satisfy that constructor would mean fabricating those fields
/// (e.g. `ratingAverage: 0`, `etaMinMinutes: 0`) — exactly the kind
/// of invented marketplace data this whole Favorites feature (and
/// this project generally) has been careful never to show. This is
/// the exact "VendorCard genuinely cannot support the required data"
/// case this chunk's own brief anticipated and pre-authorized a
/// fallback for. `_FavoriteVendorCard` below is that fallback: a
/// small, local, visually-equivalent card (same HatlyCard/HatlyImage/
/// AvailabilityBadge composition VendorCard itself already uses),
/// built only from the real fields `FavoriteVendor` actually
/// provides, with its own favorite heart mirroring the exact pattern
/// already established in VendorCard/VendorDetailsScreen (Chunk 3) —
/// not a new design, just the same real components rebuilt around
/// the smaller, real data shape this screen actually has.
class FavoritesScreen extends ConsumerWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final favoritesAsync = ref.watch(favoritesControllerProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.favorites)),
      body: favoritesAsync.when(
        loading: () => const HatlyLoadingView(),
        error: (error, stackTrace) => HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () =>
              ref.read(favoritesControllerProvider.notifier).refresh(),
        ),
        data: (favorites) {
          if (favorites.isEmpty) {
            return HatlyStateView(
              icon: Icons.favorite_border,
              title: l10n.favoritesEmptyState,
              subtitle: l10n.favoritesEmptyStateSubtitle,
            );
          }

          // No pagination in V1 (per the approved product decision) —
          // a plain ListView over the whole real, already-loaded
          // list, matching Saved Addresses' own non-paginated
          // precedent.
          return ListView.separated(
            padding: const EdgeInsets.all(HatlySpacing.md),
            itemCount: favorites.length,
            separatorBuilder: (context, index) =>
                const SizedBox(height: HatlySpacing.sm),
            itemBuilder: (context, index) =>
                _FavoriteVendorCard(favorite: favorites[index]),
          );
        },
      ),
    );
  }
}

class _FavoriteVendorCard extends StatelessWidget {
  const _FavoriteVendorCard({required this.favorite});

  final FavoriteVendor favorite;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final displayName =
        isArabic && favorite.nameAr != null ? favorite.nameAr! : favorite.name;

    return Opacity(
      opacity: favorite.isActive ? 1.0 : 0.55,
      child: HatlyCard(
        // Reuses the existing real Vendor Details route exactly as
        // VendorCard itself does — no new route, no duplicated
        // Vendor Details logic.
        onTap: () => context.push('/vendors/${favorite.vendorId}'),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            HatlyImage(
                url: favorite.logoUrl,
                width: 64,
                height: 64,
                shape: HatlyImageShape.circular),
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
                  // Real, live status from the backend (Chunk 1) —
                  // CONFIRMED never filtered out or hidden here: an
                  // inactive favorited Vendor still renders, muted,
                  // with its real status, exactly per the approved
                  // product decision.
                  AvailabilityBadge(
                    isOpen: favorite.isActive,
                    openLabel: l10n.vendorOpenNow,
                    closedLabel: l10n.vendorClosed,
                  ),
                ],
              ),
            ),
            _FavoriteHeartButton(vendorId: favorite.vendorId),
          ],
        ),
      ),
    );
  }
}

/// Same source-of-truth/no-per-card-request reasoning as VendorCard's
/// own `_FavoriteHeartButton` (Chunk 3) — a separate private copy
/// here, since that widget is private to vendor_card.dart and this
/// chunk's file scope does not include creating a new shared-widget
/// file. Unfavoriting from here relies entirely on
/// `favoritesControllerProvider`'s own state: after a successful
/// `remove`, the provider refreshes its collection and this screen's
/// `ConsumerWidget` rebuilds from that real state — there is no
/// parallel local list maintained anywhere in this file.
class _FavoriteHeartButton extends ConsumerWidget {
  const _FavoriteHeartButton({required this.vendorId});

  final String vendorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final controller = ref.watch(favoritesControllerProvider.notifier);
    final isLoading = ref.watch(favoritesControllerProvider).isLoading;
    // Always true within this screen (every card here came from the
    // Favorites list itself) — kept as a real lookup rather than a
    // hardcoded assumption, so behavior stays correct if this widget
    // is ever reused elsewhere.
    final isFavorited = controller.isFavorited(vendorId);

    return IconButton(
      icon: Icon(
        isFavorited ? Icons.favorite : Icons.favorite_border,
        color: isFavorited ? HatlyColors.primaryOrange : HatlyColors.textMuted,
      ),
      tooltip:
          isFavorited ? l10n.favoritesRemoveAction : l10n.favoritesAddAction,
      onPressed: isLoading
          ? null
          : () async {
              final error = isFavorited
                  ? await controller.remove(vendorId)
                  : await controller.add(vendorId);
              if (error != null && context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text(l10n.somethingWentWrong)),
                );
              }
            },
    );
  }
}
