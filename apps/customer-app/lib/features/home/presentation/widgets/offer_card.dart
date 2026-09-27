import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_quick_add_button.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/home_content.dart';

/// One card of the mixed Offers row. Image, title and price lead; a single
/// badge appears only for the kinds that need one (flash, free delivery,
/// bundle) — plain product/vendor offers already sit under the "Offers"
/// header, so a generic "Offer" badge would only add noise. There is no offer
/// logic here — only what [HomeOffer] already carries.
class OfferCard extends StatelessWidget {
  const OfferCard(
      {super.key,
      required this.offer,
      required this.onTap,
      this.width,
      this.onQuickAdd});

  final HomeOffer offer;
  final VoidCallback onTap;
  final double? width;

  /// Floating "+" for offers that are a real, addable product (product/flash).
  final VoidCallback? onQuickAdd;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final (badgeKind, badgeLabel, icon) = _kindSpec(l10n, offer.kind);
    final showBadge = offer.kind != HomeOfferKind.product &&
        offer.kind != HomeOfferKind.vendor;

    final card = Semantics(
      button: true,
      label: [
        badgeLabel,
        offer.title,
        if (offer.subtitle != null) offer.subtitle!
      ].join('، '),
      onTap: onTap,
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
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(HatlySpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Stack(
                    children: [
                      AspectRatio(
                        aspectRatio: 1.1, // same large image as ProductCard
                        child: HatlySoftImage(
                          url: offer.imageUrl,
                          width: double.infinity,
                          height: double.infinity,
                          placeholderIcon: icon,
                        ),
                      ),
                      if (showBadge)
                        PositionedDirectional(
                          top: HatlySpacing.sm,
                          start: HatlySpacing.sm,
                          child: HatlyBadge(kind: badgeKind, label: badgeLabel),
                        ),
                    ],
                  ),
                  const SizedBox(height: HatlySpacing.sm),
                  Text(
                    offer.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.small.copyWith(
                        color: p.textPrimary, fontWeight: FontWeight.w700),
                  ),
                  if (offer.subtitle != null)
                    Text(offer.subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.caption),
                  if (offer.priceMinor != null) ...[
                    const SizedBox(height: HatlySpacing.xs),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: HatlySpacing.xs,
                      children: [
                        LtrText(
                          formatMinorUnits(offer.priceMinor!, context),
                          style: context.type.body.copyWith(
                            color: offer.kind == HomeOfferKind.flash
                                ? p.urgent
                                : p.textPrimary,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (offer.originalPriceMinor != null)
                          LtrText(
                            formatMinorUnits(
                                offer.originalPriceMinor!, context),
                            style: context.type.caption.copyWith(
                                decoration: TextDecoration.lineThrough),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );

    return SizedBox(
      width: width,
      child: Builder(
        builder: (context) {
          // `width` is required for the "+": its position is derived from the
          // image height (width - padding, at aspect 1.1). No LayoutBuilder here on
          // purpose — cards live inside IntrinsicHeight rows, which cannot
          // measure a LayoutBuilder.
          if (onQuickAdd == null || width == null) return card;
          final imageHeight = (width! - HatlySpacing.sm * 2) / 1.1;
          final top = HatlySpacing.sm +
              imageHeight -
              HatlyQuickAddButton.size -
              HatlySpacing.sm;
          return Stack(
            children: [
              card,
              PositionedDirectional(
                top: top,
                end: HatlySpacing.md,
                child: HatlyQuickAddButton(
                    tooltip: l10n.promoCtaProduct, onPressed: onQuickAdd!),
              ),
            ],
          );
        },
      ),
    );
  }

  static (HatlyBadgeKind, String, IconData) _kindSpec(
      AppLocalizations l10n, HomeOfferKind kind) {
    switch (kind) {
      case HomeOfferKind.flash:
        return (
          HatlyBadgeKind.flashSale,
          l10n.badgeFlashSale,
          Icons.bolt_rounded
        );
      case HomeOfferKind.freeDelivery:
        return (
          HatlyBadgeKind.freeDelivery,
          l10n.badgeFreeDelivery,
          Icons.delivery_dining_outlined
        );
      case HomeOfferKind.bundle:
        return (
          HatlyBadgeKind.bundle,
          l10n.badgeBundle,
          Icons.inventory_2_outlined
        );
      case HomeOfferKind.vendor:
        return (
          HatlyBadgeKind.offer,
          l10n.badgeOffer,
          Icons.storefront_outlined
        );
      case HomeOfferKind.product:
        return (
          HatlyBadgeKind.offer,
          l10n.badgeOffer,
          Icons.local_offer_outlined
        );
    }
  }
}
