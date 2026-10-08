import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../core/media/media_url.dart';
import '../core/theme/hatly_theme.dart';

/// Soft Image Container: radius 16 by default, a soft neutral fill while
/// loading / when there is no image, and a quiet line icon — never a coloured
/// icon card standing in for a photo. Theme-aware (light + dark).
class HatlySoftImage extends StatelessWidget {
  const HatlySoftImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.radius = HatlyRadius.imageContainer,
    this.circular = false,
    this.fit = BoxFit.cover,
    this.placeholderIcon = Icons.image_outlined,
    this.placeholderIconSize = 28,
    this.semanticLabel,
  });

  final String? url;
  final double? width;
  final double? height;
  final double radius;
  final bool circular;
  final BoxFit fit;
  final IconData placeholderIcon;
  final double placeholderIconSize;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final borderRadius =
        BorderRadius.circular(circular ? HatlyRadius.circular : radius);

    Widget placeholder() => Container(
          width: width,
          height: height,
          color: p.surfaceSoft,
          alignment: Alignment.center,
          child: Icon(placeholderIcon,
              color: p.textMuted.withValues(alpha: 0.7),
              size: placeholderIconSize),
        );

    final resolvedUrl = resolveMediaUrl(url);
    final image = resolvedUrl != null
        ? CachedNetworkImage(
            imageUrl: resolvedUrl,
            width: width,
            height: height,
            fit: fit,
            placeholder: (context, _) => placeholder(),
            errorWidget: (context, _, __) => placeholder(),
          )
        : placeholder();

    return Semantics(
      image: true,
      label: semanticLabel,
      excludeSemantics: semanticLabel != null,
      child: ClipRRect(borderRadius: borderRadius, child: image),
    );
  }
}
