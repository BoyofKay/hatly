import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../core/theme/hatly_theme.dart';

enum HatlyImageShape { rounded, circular }

/// UI/UX-0 Design System. Centralizes image presentation — resolves
/// the pre-UI/UX-0 inconsistency where `Image.network` (e.g.
/// cart_item_tile.dart's Custom Request thumbnails) and
/// `CachedNetworkImage` (e.g. order_details_screen.dart, same visual
/// concept) were used interchangeably. Always uses the existing
/// `cached_network_image` dependency (already present — no new image
/// library introduced) so every image in the app benefits from
/// caching, not just some.
///
/// Placeholder is a brand-tinted box (never a bare gray Material
/// default, which reads as "broken" rather than "loading"); the
/// failed state is a neutral gray box with an icon (never blank —
/// blank space reads as a bug).
class HatlyImage extends StatelessWidget {
  const HatlyImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.shape = HatlyImageShape.rounded,
    this.fit = BoxFit.cover,
  });

  final String? url;
  final double? width;
  final double? height;
  final HatlyImageShape shape;
  final BoxFit fit;

  BorderRadius get _radius => shape == HatlyImageShape.circular
      ? BorderRadius.circular(HatlyRadius.circular)
      : BorderRadius.circular(HatlyRadius.imageContainer);

  @override
  Widget build(BuildContext context) {
    if (url == null || url!.isEmpty) {
      return _placeholder();
    }
    return ClipRRect(
      borderRadius: _radius,
      child: CachedNetworkImage(
        imageUrl: url!,
        width: width,
        height: height,
        fit: fit,
        placeholder: (context, _) => _placeholder(),
        errorWidget: (context, _, __) => _failed(),
      ),
    );
  }

  Widget _placeholder() {
    return ClipRRect(
      borderRadius: _radius,
      child: Container(
        width: width,
        height: height,
        color: HatlyColors.primaryOrange.withOpacity(0.08),
        child: const Center(
            child: Icon(Icons.shopping_bag_outlined,
                color: HatlyColors.primaryOrange)),
      ),
    );
  }

  Widget _failed() {
    return ClipRRect(
      borderRadius: _radius,
      child: Container(
        width: width,
        height: height,
        color: HatlyColors.background,
        child: const Center(
            child: Icon(Icons.broken_image_outlined,
                color: HatlyColors.closedUnavailable)),
      ),
    );
  }
}
