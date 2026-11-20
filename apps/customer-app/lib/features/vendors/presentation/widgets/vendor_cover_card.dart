import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_badge.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../domain/vendor.dart';

/// Marketplace vendor card: cover image, overlapping logo, name, rating, ETA,
/// open/closed and — only when the vendor has one — an offer badge.
/// Commercial-first hierarchy: the name and the trust/speed facts (rating,
/// ETA, open state) come before anything decorative.
///
/// Full width by default (the parent decides the width). Presentation only:
/// the caller supplies [onTap]; favorites etc. stay on the legacy `VendorCard`.
class VendorCoverCard extends StatelessWidget {
  const VendorCoverCard(
      {super.key,
      required this.vendor,
      required this.onTap,
      this.coverHeight = 132});

  final Vendor vendor;
  final VoidCallback onTap;
  final double coverHeight;

  static const double _logoSize = 48;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    final name =
        isArabic && vendor.nameAr != null ? vendor.nameAr! : vendor.name;
    final hasEta = vendor.etaMaxMinutes > 0;
    // Isolated left-to-right so the two numbers keep their order inside an
    // Arabic (RTL) line: "15–25", never "25–15".
    final etaRange =
        '\u2066${vendor.etaMinMinutes}–${vendor.etaMaxMinutes}\u2069';
    final hasRating = vendor.ratingCount > 0;
    final ratingText = vendor.ratingAverage.toStringAsFixed(1);

    return Semantics(
      button: true,
      container: true,
      label: [
        name,
        if (hasRating) l10n.vendorRatingSemantics(ratingText),
        if (hasEta) l10n.vendorEtaMinutes(etaRange),
        vendor.isOpen ? l10n.vendorOpenNow : l10n.vendorClosed,
        if (vendor.hasPromotion) l10n.badgeOffer,
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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    HatlySoftImage(
                      url: vendor.coverImageUrl,
                      width: double.infinity,
                      height: coverHeight,
                      radius: HatlyRadius.card,
                      placeholderIcon: Icons.storefront_outlined,
                    ),
                    if (vendor.hasPromotion)
                      PositionedDirectional(
                        top: HatlySpacing.sm,
                        start: HatlySpacing.sm,
                        child: HatlyBadge(
                            kind: HatlyBadgeKind.offer, label: l10n.badgeOffer),
                      ),
                    PositionedDirectional(
                      bottom: -(_logoSize / 2),
                      start: HatlySpacing.md,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                            color: p.surface, shape: BoxShape.circle),
                        child: HatlySoftImage(
                          url: vendor.logoUrl,
                          width: _logoSize,
                          height: _logoSize,
                          circular: true,
                          placeholderIcon: Icons.store_outlined,
                        ),
                      ),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsetsDirectional.fromSTEB(
                    HatlySpacing.md,
                    _logoSize / 2 + HatlySpacing.sm,
                    HatlySpacing.md,
                    HatlySpacing.md,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: context.type.title),
                      const SizedBox(height: HatlySpacing.xs),
                      Wrap(
                        spacing: HatlySpacing.ms,
                        runSpacing: HatlySpacing.xs,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (hasRating)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.star_rounded,
                                    size: 18, color: p.warning),
                                const SizedBox(width: 2),
                                LtrText(ratingText,
                                    style: context.type.small.copyWith(
                                        color: p.textPrimary,
                                        fontWeight: FontWeight.w700)),
                                const SizedBox(width: 4),
                                // Flexible: in a narrow card at large text sizes the
                                // review count shrinks instead of overflowing.
                                Flexible(
                                  child: LtrText('(${vendor.ratingCount})',
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: context.type.caption),
                                ),
                              ],
                            ),
                          if (hasEta)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.schedule_rounded,
                                    size: 16, color: p.textMuted),
                                const SizedBox(width: 4),
                                // Flexible, like the review count above: shrinks in a narrow card at large text sizes.
                                Flexible(
                                  child: Text(l10n.vendorEtaMinutes(etaRange),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: context.type.small),
                                ),
                              ],
                            ),
                          HatlyBadge(
                            kind: vendor.isOpen
                                ? HatlyBadgeKind.open
                                : HatlyBadgeKind.closed,
                            label: vendor.isOpen
                                ? l10n.vendorOpenNow
                                : l10n.vendorClosed,
                          ),
                        ],
                      ),
                    ],
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
