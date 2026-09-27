import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../domain/home_content.dart';

/// The CTA label for each promo kind (Product → add to cart, Vendor → shop now,
/// Offer → discover the offer, Free Delivery → order now, Bundle → see the
/// bundle).
String promoCtaLabel(AppLocalizations l10n, HomePromoKind kind) {
  switch (kind) {
    case HomePromoKind.product:
      return l10n.promoCtaProduct;
    case HomePromoKind.vendor:
      return l10n.promoCtaVendor;
    case HomePromoKind.offer:
      return l10n.promoCtaOffer;
    case HomePromoKind.freeDelivery:
      return l10n.promoCtaFreeDelivery;
    case HomePromoKind.bundle:
      return l10n.promoCtaBundle;
  }
}

/// ONE call-to-action component for every promo kind: same shape, size and
/// style; only the label (and the action the caller wires) changes.
class PromoCtaButton extends StatelessWidget {
  const PromoCtaButton(
      {super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Material(
      color: p.accent,
      borderRadius: BorderRadius.circular(HatlyRadius.button),
      child: InkWell(
        borderRadius: BorderRadius.circular(HatlyRadius.button),
        onTap: onPressed,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.md),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.small.copyWith(
                        color: p.accentOn, fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
