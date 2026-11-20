import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_quick_add_button.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/product.dart';
import 'product_list_tile.dart';

/// Grid product card (reference board, "منتجات القسم"): a square photo with
/// the offer / unavailable badge, the orange "+" on the photo's corner, then the
/// name and the price in orange. Prices are exactly what the backend returned
/// (priceMinor / activeOffer.specialPriceMinor) — never computed here.
///
/// The "+" follows [ProductListTile.canQuickAdd]: weighted products and ones
/// with options always go through the product page.
class ProductGridCard extends StatelessWidget {
  const ProductGridCard(
      {super.key, required this.product, required this.onTap, this.onQuickAdd});

  final Product product;
  final VoidCallback onTap;
  final VoidCallback? onQuickAdd;

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

    HatlyBadgeKind? badgeKind;
    String? badgeLabel;
    if (!product.isAvailable) {
      badgeKind = HatlyBadgeKind.unavailable;
      badgeLabel = l10n.badgeUnavailable;
    } else if (offer != null) {
      badgeKind =
          offer.isFlashSale ? HatlyBadgeKind.flashSale : HatlyBadgeKind.offer;
      badgeLabel = offer.isFlashSale ? l10n.badgeFlashSale : l10n.badgeOffer;
    }
    final showAdd = onQuickAdd != null && ProductListTile.canQuickAdd(product);

    return Opacity(
      opacity: product.isAvailable ? 1 : 0.6,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: p.surface,
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          boxShadow: HatlyShadows.soft(p),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            key: Key('product-grid-card-${product.id}'),
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
                        aspectRatio: 1,
                        child: HatlySoftImage(
                          url: product.imageUrl,
                          width: double.infinity,
                          height: double.infinity,
                          radius: 12,
                          placeholderIcon: Icons.fastfood_outlined,
                        ),
                      ),
                      if (badgeKind != null && badgeLabel != null)
                        PositionedDirectional(
                          top: HatlySpacing.xs,
                          start: HatlySpacing.xs,
                          child: HatlyBadge(kind: badgeKind, label: badgeLabel),
                        ),
                      if (showAdd)
                        PositionedDirectional(
                          bottom: 0,
                          end: 0,
                          child: HatlyQuickAddButton(
                            key: Key('product-quick-add-${product.id}'),
                            tooltip: l10n.promoCtaProduct,
                            onPressed: onQuickAdd!,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: HatlySpacing.sm),
                  Text(
                    name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.body.copyWith(
                        fontWeight: FontWeight.w700, color: p.textPrimary),
                  ),
                  const Spacer(),
                  const SizedBox(height: HatlySpacing.xs),
                  Wrap(
                    spacing: HatlySpacing.xs,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      LtrText(
                        formatMinorUnits(
                                flashPrice ?? product.priceMinor, context) +
                            (product.isWeighted ? ' /kg' : ''),
                        style: context.type.body.copyWith(
                            color: flashPrice != null ? p.urgent : p.link,
                            fontWeight: FontWeight.w800),
                      ),
                      if (flashPrice != null)
                        LtrText(
                          formatMinorUnits(product.priceMinor, context),
                          style: context.type.caption
                              .copyWith(decoration: TextDecoration.lineThrough),
                        ),
                    ],
                  ),
                  if (offer?.mechanism == 'SUBTOTAL_DISCOUNT')
                    Text(l10n.subtotalDiscountAvailable,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.caption.copyWith(color: p.success)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Lays [children] out two per row (equal height per row, so the prices line
/// up), the way the reference grid looks — and it grows with the text size
/// instead of clipping it, which a fixed-ratio grid would.
class TwoColumnRows extends StatelessWidget {
  const TwoColumnRows({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < children.length; i += 2) ...[
          if (i > 0) const SizedBox(height: HatlySpacing.ms),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: children[i]),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                    child: i + 1 < children.length
                        ? children[i + 1]
                        : const SizedBox()),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
