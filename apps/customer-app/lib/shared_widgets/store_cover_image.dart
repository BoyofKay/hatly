import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';
import 'hatly_logo.dart';
import 'hatly_soft_image.dart';

/// Reuses a store's own logo when no cover/banner exists. If both are
/// absent, show the canonical Hatly logo. Presentation only.
class StoreCoverImage extends StatelessWidget {
  const StoreCoverImage({
    super.key,
    required this.coverUrl,
    required this.logoUrl,
    this.width,
    required this.height,
    this.radius = HatlyRadius.card,
  });

  final String? coverUrl;
  final String? logoUrl;
  final double? width;
  final double height;
  final double radius;

  bool get _hasCover => coverUrl?.trim().isNotEmpty == true;
  bool get _hasLogo => logoUrl?.trim().isNotEmpty == true;

  @override
  Widget build(BuildContext context) {
    if (_hasCover) {
      return HatlySoftImage(
        url: coverUrl,
        width: width,
        height: height,
        radius: radius,
        placeholderIcon: Icons.storefront_outlined,
      );
    }
    final p = context.palette;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Container(
        width: width,
        height: height,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [p.accentSoft, p.surfaceSoft],
            begin: AlignmentDirectional.topStart,
            end: AlignmentDirectional.bottomEnd,
          ),
        ),
        padding: const EdgeInsets.all(12),
        child: _hasLogo
            ? HatlySoftImage(
                url: logoUrl,
                width: height - 24,
                height: height - 24,
                radius: 12,
                fit: BoxFit.contain,
                placeholderIcon: Icons.store_outlined,
              )
            : HatlyLogo(size: height < 90 ? height - 20 : 64),
      ),
    );
  }
}
