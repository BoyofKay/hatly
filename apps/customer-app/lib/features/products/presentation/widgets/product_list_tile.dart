import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../../../shared_widgets/hatly_image.dart';
import '../../domain/product.dart';

/// Product list tile used on the Vendor Details screen's product
/// list. Unavailable products are shown (not hidden), muted, with a
/// badge — same "show it, don't hide it" pattern as closed vendors on
/// VendorCard from Phase 2B.
///
/// UI/UX-2 Chunk 2. Visual-token cleanup only. The Flash-Sale/
/// Subtotal-Discount price branching below is deliberately left
/// EXACTLY as it was — evaluated against HatlyPriceLabel (UI/UX-0)
/// and found not to fit: HatlyPriceLabel's states are normal/pending-
/// custom-request/priced-custom-request/weighted-estimate-vs-final,
/// none of which represent "original price struck through + a
/// discounted special price + a badge," which is what a real Flash
/// Sale actually needs to show here. Forcing this tile into
/// HatlyPriceLabel would mean either losing that visual information
/// or modifying HatlyPriceLabel's own behavior — both out of this
/// chunk's scope — so the existing, already-correct, already-real-
/// data-only branching is preserved unchanged; only its typography
/// was aligned to theme tokens.
class ProductListTile extends StatelessWidget {
  const ProductListTile(
      {super.key, required this.product, required this.onTap});

  final Product product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final displayName =
        isArabic && product.nameAr != null ? product.nameAr! : product.name;
    final displayDescription = isArabic && product.descriptionAr != null
        ? product.descriptionAr
        : product.description;

    return Opacity(
      opacity: product.isAvailable ? 1.0 : 0.5,
      child: InkWell(
        onTap: product.isAvailable ? onTap : null,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HatlyImage(url: product.imageUrl, width: 72, height: 72),
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
                    if (displayDescription != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        displayDescription,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ],
                    const SizedBox(height: HatlySpacing.sm),
                    // Customer Product-Level Offers Display. Backend
                    // remains authoritative — this only ever displays
                    // priceMinor/activeOffer.specialPriceMinor exactly
                    // as returned, never a client-calculated value.
                    // Branching preserved unchanged — see class doc.
                    if (product.activeOffer?.isFlashSale == true) ...[
                      Row(
                        children: [
                          Text(
                            formatMinorUnits(product.priceMinor, context),
                            style:
                                Theme.of(context).textTheme.bodyLarge?.copyWith(
                                      decoration: TextDecoration.lineThrough,
                                    ),
                          ),
                          const SizedBox(width: HatlySpacing.sm),
                          LtrText(
                            formatMinorUnits(
                                product.activeOffer!.specialPriceMinor ??
                                    product.priceMinor,
                                context),
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: HatlyColors.success),
                          ),
                          if (product.isWeighted)
                            Text('/kg',
                                style: Theme.of(context).textTheme.bodyLarge),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: HatlySpacing.sm, vertical: 1),
                        decoration: BoxDecoration(
                          color: HatlyColors.flashSale.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(HatlyRadius.chip),
                        ),
                        child: Text(
                          l10n.flashSaleBadge,
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(color: HatlyColors.flashSale),
                        ),
                      ),
                    ] else ...[
                      Row(
                        children: [
                          LtrText(
                            formatMinorUnits(product.priceMinor, context),
                            style: Theme.of(context)
                                .textTheme
                                .titleMedium
                                ?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: HatlyColors.primaryOrangeDark),
                          ),
                          if (product.isWeighted)
                            Text('/kg',
                                style: Theme.of(context).textTheme.bodyLarge),
                        ],
                      ),
                      if (product.activeOffer?.mechanism ==
                          'SUBTOTAL_DISCOUNT') ...[
                        const SizedBox(height: 2),
                        Text(
                          l10n.subtotalDiscountAvailable,
                          style: Theme.of(context)
                              .textTheme
                              .labelLarge
                              ?.copyWith(color: HatlyColors.success),
                        ),
                      ],
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
