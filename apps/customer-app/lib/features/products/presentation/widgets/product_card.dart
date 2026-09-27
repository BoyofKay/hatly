import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_quick_add_button.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/product.dart';

/// Vertical product card for horizontal rows (≈2.5 visible). Image container
/// (radius 16) with contextual badges, then name and price. Uses the product's
/// real [Product.activeOffer] when there is one — never a price of its own.
///
/// [extraBadge] lets a caller add one contextual badge (e.g. "Popular" /
/// "New" in the Popular & New row) without the card knowing about Home.
class ProductCard extends StatelessWidget {
  const ProductCard(
      {super.key,
      required this.product,
      required this.onTap,
      this.width,
      this.extraBadge,
      this.onQuickAdd,
      this.elevated = true});

  final Product product;
  final VoidCallback onTap;
  final double? width;
  final HatlyBadgeKind? extraBadge;

  /// When given (and the product is available) a floating "+" sits on the image
  /// corner. The caller decides what it does (Home adds one unit through the
  /// existing cart controller).
  final VoidCallback? onQuickAdd;

  /// Soft shadow under the card. Quiet rows (Popular & New) turn it off.
  final bool elevated;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name =
        isArabic && product.nameAr != null ? product.nameAr! : product.name;

    final offer = product.activeOffer;
    final flashPrice = offer != null &&
            offer.isFlashSale &&
            offer.specialPriceMinor != null &&
            offer.specialPriceMinor! < product.priceMinor
        ? offer.specialPriceMinor
        : null;
    final shownPrice = flashPrice ?? product.priceMinor;

    // One primary badge slot on the image: unavailable wins, then the offer
    // kind, then the caller's tag.
    HatlyBadgeKind? badgeKind;
    String? badgeLabel;
    if (!product.isAvailable) {
      badgeKind = HatlyBadgeKind.unavailable;
      badgeLabel = l10n.badgeUnavailable;
    } else if (offer != null) {
      badgeKind =
          offer.isFlashSale ? HatlyBadgeKind.flashSale : HatlyBadgeKind.offer;
      badgeLabel = offer.isFlashSale ? l10n.badgeFlashSale : l10n.badgeOffer;
    } else if (extraBadge != null) {
      badgeKind = extraBadge;
      badgeLabel = _label(l10n, extraBadge!);
    }

    final card = Semantics(
      button: true,
      enabled: product.isAvailable,
      label: [
        name,
        formatMinorUnits(shownPrice, context),
        if (badgeLabel != null) badgeLabel
      ].join('، '),
      onTap: product.isAvailable ? onTap : null,
      excludeSemantics: true,
      child: Opacity(
        opacity: product.isAvailable ? 1 : 0.7,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            boxShadow: elevated ? HatlyShadows.soft(p) : null,
          ),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              borderRadius: BorderRadius.circular(HatlyRadius.card),
              onTap: product.isAvailable ? onTap : null,
              child: Padding(
                padding: const EdgeInsets.all(HatlySpacing.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Stack(
                      children: [
                        AspectRatio(
                          aspectRatio: 1.1,
                          child: HatlySoftImage(
                            url: product.imageUrl,
                            width: double.infinity,
                            height: double.infinity,
                            placeholderIcon: Icons.fastfood_outlined,
                          ),
                        ),
                        if (badgeKind != null && badgeLabel != null)
                          PositionedDirectional(
                            top: HatlySpacing.sm,
                            start: HatlySpacing.sm,
                            child:
                                HatlyBadge(kind: badgeKind, label: badgeLabel),
                          ),
                      ],
                    ),
                    const SizedBox(height: HatlySpacing.sm),
                    Text(
                      name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.type.small.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: HatlySpacing.xs),
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: HatlySpacing.xs,
                      children: [
                        LtrText(
                          formatMinorUnits(shownPrice, context),
                          style: context.type.small.copyWith(
                            color:
                                flashPrice != null ? p.urgent : p.textPrimary,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (flashPrice != null)
                          LtrText(
                            formatMinorUnits(product.priceMinor, context),
                            style: context.type.caption.copyWith(
                                decoration: TextDecoration.lineThrough),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );

    final showAdd = onQuickAdd != null && product.isAvailable;
    return SizedBox(
      width: width,
      child: Builder(
        builder: (context) {
          // `width` is required for the "+": its position is derived from the
          // image height (width - padding, at aspect 1.1). No LayoutBuilder here on
          // purpose — cards live inside IntrinsicHeight rows, which cannot
          // measure a LayoutBuilder.
          if (!showAdd || width == null) return card;
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

  static String _label(AppLocalizations l10n, HatlyBadgeKind kind) {
    switch (kind) {
      case HatlyBadgeKind.newItem:
        return l10n.badgeNew;
      case HatlyBadgeKind.popular:
        return l10n.badgePopular;
      case HatlyBadgeKind.freeDelivery:
        return l10n.badgeFreeDelivery;
      case HatlyBadgeKind.bundle:
        return l10n.badgeBundle;
      case HatlyBadgeKind.flashSale:
        return l10n.badgeFlashSale;
      case HatlyBadgeKind.unavailable:
        return l10n.badgeUnavailable;
      case HatlyBadgeKind.open:
        return l10n.vendorOpenNow;
      case HatlyBadgeKind.closed:
        return l10n.vendorClosed;
      case HatlyBadgeKind.offer:
        return l10n.badgeOffer;
    }
  }
}
