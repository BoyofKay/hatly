import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_soft_image.dart';
import 'sector_icon.dart';

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
      this.width});

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
        child: InkWell(
          borderRadius: BorderRadius.circular(HatlyRadius.card),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AspectRatio(
                  aspectRatio: 1.25,
                  child: HatlySoftImage(
                    url: imageUrl,
                    width: double.infinity,
                    height: double.infinity,
                    placeholderIconSize: 36,
                    placeholderIcon: slug == null
                        ? Icons.category_outlined
                        : sectorIcon(slug!),
                  ),
                ),
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
        ),
      ),
    );
  }
}
