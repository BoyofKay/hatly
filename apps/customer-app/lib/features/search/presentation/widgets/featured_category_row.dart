import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import '../../../home/presentation/widgets/home_category_section.dart';
import '../../../home/presentation/widgets/sector_icon.dart';
import '../../../sectors/domain/sector.dart';

/// "Featured categories": a compact, quiet horizontal row — a small round
/// image/icon and the name on a light pill. Lighter than the Shop by Category
/// tiles on purpose; no counts, badges or popularity labels.
class FeaturedCategoryRow extends StatelessWidget {
  const FeaturedCategoryRow({super.key, required this.categories});

  final List<MarketplaceSector> categories;

  static const double height = 56;

  @override
  Widget build(BuildContext context) {
    final isArabic = Localizations.localeOf(context).languageCode == 'ar';
    // The pill grows with the user's text size, like every other row.
    final scale =
        MediaQuery.textScalerOf(context).scale(16).clamp(16.0, 32.0) / 16;

    return SizedBox(
      height: height * scale,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.screenPadding, vertical: HatlySpacing.xs),
        itemCount: categories.length,
        separatorBuilder: (context, index) =>
            const SizedBox(width: HatlySpacing.ms),
        itemBuilder: (context, i) => _FeaturedCategoryPill(
          sector: categories[i],
          label: categoryDisplayName(categories[i], isArabic: isArabic),
          onTap: () => context
              .push(categoryListingRoute(categories[i], isArabic: isArabic)),
        ),
      ),
    );
  }
}

class _FeaturedCategoryPill extends StatelessWidget {
  const _FeaturedCategoryPill(
      {required this.sector, required this.label, required this.onTap});

  final MarketplaceSector sector;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      button: true,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: Material(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        elevation: 0,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            boxShadow: HatlyShadows.soft(p),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(HatlyRadius.card),
            onTap: onTap,
            child: ConstrainedBox(
              constraints:
                  const BoxConstraints(minHeight: HatlyTouch.minTarget),
              child: Padding(
                padding: const EdgeInsetsDirectional.only(
                    start: HatlySpacing.sm,
                    end: HatlySpacing.md,
                    top: HatlySpacing.sm,
                    bottom: HatlySpacing.sm),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    HatlySoftImage(
                      url: sector.imageUrl,
                      width: 40,
                      height: 40,
                      circular: true,
                      placeholderIconSize: 22,
                      placeholderIcon: sectorIcon(sector.slug),
                    ),
                    const SizedBox(width: HatlySpacing.ms),
                    Text(label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.type.small.copyWith(
                            color: p.textPrimary, fontWeight: FontWeight.w600)),
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
