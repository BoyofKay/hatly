import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/hatly_quick_add_button.dart';
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
      {super.key, required this.product, required this.onTap, this.onQuickAdd});

  final Product product;
  final VoidCallback onTap;

  /// One-tap "+" at the tile's end. Shown only when given AND [canQuickAdd]:
  /// a weighted product or one with options always goes through the product
  /// page (weight / option choice); the caller's handler still hands off to the
  /// product page if the backend asks for a choice anyway.
  final VoidCallback? onQuickAdd;

  static bool canQuickAdd(Product product) =>
      product.isAvailable && !product.isWeighted && product.options.isEmpty;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final displayName =
        isArabic && product.nameAr != null ? product.nameAr! : product.name;
    final displayDescription = isArabic && product.descriptionAr != null
        ? product.descriptionAr
        : product.description;

    return Opacity(
      opacity: product.isAvailable ? 1.0 : 0.5,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: HatlySpacing.xs),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: p.surface,
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            boxShadow: HatlyShadows.soft(p),
          ),
          child: Material(
            type: MaterialType.transparency,
            child: InkWell(
              onTap: product.isAvailable ? onTap : null,
              borderRadius: BorderRadius.circular(HatlyRadius.card),
              child: Padding(
                padding: const EdgeInsets.all(HatlySpacing.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    HatlySoftImage(
                        url: product.imageUrl,
                        width: 88,
                        height: 88,
                        radius: 12,
                        placeholderIcon: Icons.fastfood_outlined),
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
                            // Polish pass: no Flexible/overflow handling — a long
                            // formatted price (e.g. wide-locale digits, a 4+ digit
                            // amount) plus the struck-through original price plus
                            // "/kg" could overflow this Row on a narrow screen.
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    formatMinorUnits(
                                        product.priceMinor, context),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodyLarge
                                        ?.copyWith(
                                          decoration:
                                              TextDecoration.lineThrough,
                                        ),
                                  ),
                                ),
                                const SizedBox(width: HatlySpacing.sm),
                                Flexible(
                                  child: LtrText(
                                    formatMinorUnits(
                                        product.activeOffer!
                                                .specialPriceMinor ??
                                            product.priceMinor,
                                        context),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium
                                        ?.copyWith(
                                            fontWeight: FontWeight.bold,
                                            color: p.success),
                                  ),
                                ),
                                if (product.isWeighted)
                                  Text('/kg',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyLarge),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: HatlySpacing.sm, vertical: 1),
                              decoration: BoxDecoration(
                                // Dark Mode fix: fixed `HatlyColors.success`/
                                // `flashSale` — identical to the old constants in
                                // Light Mode, theme-tuned (brighter/more legible)
                                // on a dark surface in Dark Mode.
                                color: p.urgent.withValues(alpha: 0.15),
                                borderRadius:
                                    BorderRadius.circular(HatlyRadius.chip),
                              ),
                              child: Text(
                                l10n.flashSaleBadge,
                                style: Theme.of(context)
                                    .textTheme
                                    .labelLarge
                                    ?.copyWith(color: p.urgent),
                              ),
                            ),
                          ] else ...[
                            Row(
                              children: [
                                Flexible(
                                  child: LtrText(
                                    formatMinorUnits(
                                        product.priceMinor, context),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium
                                        ?.copyWith(
                                            fontWeight: FontWeight.bold,
                                            color: p.link),
                                  ),
                                ),
                                if (product.isWeighted)
                                  Text('/kg',
                                      style: Theme.of(context)
                                          .textTheme
                                          .bodyLarge),
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
                                    ?.copyWith(color: p.success),
                              ),
                            ],
                          ],
                        ],
                      ),
                    ),
                    if (onQuickAdd != null && canQuickAdd(product)) ...[
                      const SizedBox(width: HatlySpacing.sm),
                      HatlyQuickAddButton(
                        key: Key('product-quick-add-${product.id}'),
                        tooltip: l10n.promoCtaProduct,
                        onPressed: onQuickAdd!,
                        quiet: true,
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
