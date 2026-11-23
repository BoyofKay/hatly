import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import 'sector_icon.dart';

/// Restrained corners for the two-per-row category cards (card / picture inside it).
const double kCategoryCardRadius = 12;
const double kCategoryImageRadius = 8;

/// One cell of the "Shop by category" grid: a square soft image container
/// (radius 16, no border, no shadow) with the category name BELOW it — the
/// label never sits on top of a photo, so its contrast does not depend on the
/// image. Without an image the tile shows the soft placeholder with a large,
/// quiet line icon (not a coloured icon card). Every category carries the same
/// visual weight: no badges, no metadata.
class CategoryCard extends StatelessWidget {
  const CategoryCard(
      {super.key,
      required this.label,
      required this.onTap,
      this.imageUrl,
      this.slug,
      this.width,
      this.large = false});

  /// The Categories page card (reference board): a white card with a shadow, the photo inside it and a bold name.
  final bool large;

  final String label;
  final String? imageUrl;

  /// Only used to pick the quiet placeholder icon.
  final String? slug;
  final VoidCallback onTap;
  final double? width;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: Semantics(
        button: true,
        label: label,
        onTap: onTap,
        excludeSemantics: true,
        child: large ? _large(context) : _compact(context),
      ),
    );
  }

  Widget _image(double iconSize) => HatlySoftImage(
        url: imageUrl,
        width: double.infinity,
        height: double.infinity,
        radius: large ? kCategoryImageRadius : HatlyRadius.imageContainer,
        placeholderIconSize: iconSize,
        placeholderIcon:
            slug == null ? Icons.category_outlined : sectorIcon(slug!),
      );

  /// The two-per-row category card (Home and the Categories page; owner, 2026-11-11): white, a restrained 12 px corner, a hairline
  /// border and a very light shadow; the picture keeps its own aspect (cover, never stretched) and the name always has room for two
  /// lines, so a long Arabic name neither clips nor makes one card taller than its neighbour.
  Widget _large(BuildContext context) {
    final p = context.palette;
    final nameStyle = context.type.body.copyWith(
        color: p.textPrimary, fontWeight: FontWeight.w700, height: 1.3);
    final twoLines = MediaQuery.textScalerOf(context)
            .scale(nameStyle.fontSize ?? 14) *
        1.3 *
        2;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(kCategoryCardRadius),
        border: Border.all(color: p.border.withValues(alpha: 0.7), width: 0.8),
        boxShadow: [
          BoxShadow(
              color: p.shadow.withValues(alpha: 0.5),
              blurRadius: 8,
              offset: const Offset(0, 2)),
        ],
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(kCategoryCardRadius),
          splashColor: p.accentSoft,
          highlightColor: p.accentSoft.withValues(alpha: 0.5),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(HatlySpacing.sm),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AspectRatio(aspectRatio: 1.35, child: _image(40)),
                const SizedBox(height: HatlySpacing.sm),
                SizedBox(
                  height: twoLines,
                  child: Center(
                    child: Text(
                      label,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: nameStyle,
                    ),
                  ),
                ),
                const SizedBox(height: HatlySpacing.xs),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _compact(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(HatlyRadius.card),
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(aspectRatio: 1.25, child: _image(36)),
            const SizedBox(height: HatlySpacing.sm),
            Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: context.type.small.copyWith(
                  color: context.palette.textPrimary,
                  fontWeight: FontWeight.w600,
                  height: 1.3),
            ),
          ],
        ),
      ),
    );
  }
}
