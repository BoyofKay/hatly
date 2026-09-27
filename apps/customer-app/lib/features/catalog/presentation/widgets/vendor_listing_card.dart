import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/catalog_product.dart';

/// One store's offer of a catalog product, for the "Available Stores" list. Every store gets the SAME
/// treatment — no "cheapest"/"recommended" highlight, nothing pre-selected: the customer chooses. Shows
/// only real data: vendor, real rating + count (hidden when there are no ratings), price, offer, open state
/// and out-of-stock. There is no ETA or delivery fee because the API has none.
class VendorListingCard extends StatelessWidget {
  const VendorListingCard(
      {super.key, required this.listing, required this.onSelect});

  final VendorListing listing;
  final VoidCallback onSelect;

  bool get _outOfStock =>
      listing.isTracked && listing.quantity != null && listing.quantity! <= 0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final vendorName = isArabic && listing.vendor.nameAr != null
        ? listing.vendor.nameAr!
        : listing.vendor.name;
    final unit = listing.isWeighted ? ' /kg' : '';
    final offer = listing.activeOffer;
    final flashPrice =
        offer != null && offer.isFlashSale && offer.specialPriceMinor != null
            ? offer.specialPriceMinor
            : null;
    final hasRating = listing.ratingCount > 0;
    final shownPrice =
        '${formatMinorUnits(flashPrice ?? listing.priceMinor, context)}$unit';
    final canSelect = !_outOfStock;

    return Semantics(
      button: true,
      enabled: canSelect,
      container: true,
      label: [
        vendorName,
        if (hasRating)
          l10n.vendorRatingSemantics(listing.ratingAverage.toStringAsFixed(1)),
        shownPrice,
        listing.isOpen ? l10n.vendorOpenNow : l10n.vendorClosed,
        if (_outOfStock) l10n.productUnavailable,
        if (offer != null)
          offer.isFlashSale
              ? l10n.badgeFlashSale
              : l10n.subtotalDiscountAvailable,
      ].join('، '),
      onTap: canSelect ? onSelect : null,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          boxShadow: HatlyShadows.soft(p),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            onTap: canSelect ? onSelect : null,
            child: Padding(
              padding: const EdgeInsets.all(HatlySpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Identity block: logo + name, with rating and status right beneath the name.
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      HatlySoftImage(
                        url: listing.vendor.logoUrl,
                        width: 44,
                        height: 44,
                        circular: true,
                        placeholderIcon: Icons.storefront_outlined,
                        placeholderIconSize: 22,
                      ),
                      const SizedBox(width: HatlySpacing.ms),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(vendorName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: context.type.body.copyWith(
                                    color: p.textPrimary,
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(height: HatlySpacing.xs),
                            Wrap(
                              crossAxisAlignment: WrapCrossAlignment.center,
                              spacing: HatlySpacing.sm,
                              runSpacing: HatlySpacing.xs,
                              children: [
                                if (hasRating)
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(Icons.star_rounded,
                                          size: 16, color: p.warning),
                                      const SizedBox(width: 2),
                                      LtrText(
                                          listing.ratingAverage
                                              .toStringAsFixed(1),
                                          style: context.type.small.copyWith(
                                              color: p.textPrimary,
                                              fontWeight: FontWeight.w700)),
                                      const SizedBox(width: 4),
                                      Flexible(
                                        child: LtrText(
                                            '(${listing.ratingCount})',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: context.type.caption),
                                      ),
                                    ],
                                  ),
                                HatlyBadge(
                                  kind: listing.isOpen
                                      ? HatlyBadgeKind.open
                                      : HatlyBadgeKind.closed,
                                  label: listing.isOpen
                                      ? l10n.vendorOpenNow
                                      : l10n.vendorClosed,
                                ),
                                if (_outOfStock)
                                  HatlyBadge(
                                      kind: HatlyBadgeKind.unavailable,
                                      label: l10n.productUnavailable),
                                if (offer != null)
                                  HatlyBadge(
                                    kind: offer.isFlashSale
                                        ? HatlyBadgeKind.flashSale
                                        : HatlyBadgeKind.offer,
                                    label: offer.isFlashSale
                                        ? l10n.badgeFlashSale
                                        : l10n.subtotalDiscountAvailable,
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: HatlySpacing.ms),
                  // Action row: the price and the choose button together — one commercial block.
                  Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: HatlySpacing.sm,
                          children: [
                            LtrText(shownPrice,
                                style: context.type.title.copyWith(
                                    color: flashPrice != null
                                        ? p.urgent
                                        : p.textPrimary,
                                    fontWeight: FontWeight.w800)),
                            if (flashPrice != null)
                              LtrText(
                                  '${formatMinorUnits(listing.priceMinor, context)}$unit',
                                  style: context.type.caption.copyWith(
                                      decoration: TextDecoration.lineThrough)),
                          ],
                        ),
                      ),
                      const SizedBox(width: HatlySpacing.sm),
                      _SelectButton(
                          label: l10n.catalogChooseStore,
                          onPressed: canSelect ? onSelect : null),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SelectButton extends StatelessWidget {
  const _SelectButton({required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: onPressed == null ? p.surfaceSoft : p.accentSoft,
      borderRadius: BorderRadius.circular(HatlyRadius.button),
      child: InkWell(
        borderRadius: BorderRadius.circular(HatlyRadius.button),
        onTap: onPressed,
        child: ConstrainedBox(
          constraints: const BoxConstraints(
              minHeight: HatlyTouch.minTarget, minWidth: 72),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.md),
              child: Text(label,
                  style: context.type.small.copyWith(
                      color: onPressed == null ? p.textMuted : p.link,
                      fontWeight: FontWeight.w800)),
            ),
          ),
        ),
      ),
    );
  }
}
