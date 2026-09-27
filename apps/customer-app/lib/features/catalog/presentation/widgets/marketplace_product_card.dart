import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_quick_add_button.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/catalog_product.dart';

/// Marketplace product card for the category listing: large soft image, name, one price line, and — only
/// when it is real — the store count and an offer badge. A grouped catalog product shows "يبدأ من X" with
/// its store count; a single-store item shows its normal price. No rating, ETA, delivery fee or popularity
/// is shown because the listing API returns none of them.
///
/// The floating "+" never silently picks a vendor: for a grouped product it opens the same store selection
/// as the card, for an unlinked product it opens the product's own configuration screen (the caller wires
/// both — this widget only presents).
///
/// [width] is required for the "+" position (derived from the image height, no LayoutBuilder — cards live
/// inside IntrinsicHeight rows).
class MarketplaceProductCard extends StatelessWidget {
  const MarketplaceProductCard({
    super.key,
    required this.item,
    required this.width,
    required this.onTap,
    required this.onAdd,
  });

  final CatalogProductSummary item;
  final double width;
  final VoidCallback onTap;
  final VoidCallback onAdd;

  static const double _imageAspect = 1.1;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name = isArabic && item.nameAr != null ? item.nameAr! : item.name;
    final grouped = item.storeCount > 1;
    final price =
        '${formatMinorUnits(item.fromPriceMinor, context)}${item.isWeighted ? ' /kg' : ''}';

    final card = Semantics(
      button: true,
      container: true,
      label: [
        name,
        grouped ? l10n.catalogStartsFrom(price) : price,
        if (grouped) l10n.catalogStoreCount(item.storeCount),
        if (item.hasOffer) l10n.badgeOffer,
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
                        aspectRatio: _imageAspect,
                        child: HatlySoftImage(
                          url: item.imageUrl,
                          width: double.infinity,
                          height: double.infinity,
                          placeholderIcon: Icons.shopping_basket_outlined,
                          placeholderIconSize: 36,
                        ),
                      ),
                      if (item.hasOffer)
                        PositionedDirectional(
                          top: HatlySpacing.sm,
                          start: HatlySpacing.sm,
                          child: HatlyBadge(
                              kind: HatlyBadgeKind.offer,
                              label: l10n.badgeOffer),
                        ),
                    ],
                  ),
                  const SizedBox(height: HatlySpacing.sm),
                  Text(name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: context.type.small.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w600)),
                  const SizedBox(height: HatlySpacing.xs),
                  if (grouped)
                    Text(l10n.catalogStartsFrom(''),
                        style: context.type.caption),
                  LtrText(price,
                      style: context.type.small.copyWith(
                          color: p.textPrimary, fontWeight: FontWeight.w800)),
                  if (grouped)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(l10n.catalogStoreCount(item.storeCount),
                          style: context.type.caption),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    final imageHeight = (width - HatlySpacing.sm * 2) / _imageAspect;
    final top = HatlySpacing.sm +
        imageHeight -
        HatlyQuickAddButton.size -
        HatlySpacing.sm;

    return SizedBox(
      width: width,
      child: Stack(
        children: [
          card,
          PositionedDirectional(
            top: top,
            end: HatlySpacing.md,
            child: HatlyQuickAddButton(
              quiet: true,
              tooltip: grouped
                  ? l10n.catalogAvailableFromStores(item.storeCount)
                  : l10n.promoCtaProduct,
              onPressed: onAdd,
            ),
          ),
        ],
      ),
    );
  }
}
