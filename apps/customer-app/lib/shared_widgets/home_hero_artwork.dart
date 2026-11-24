import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'hatly_soft_image.dart';
import '../core/media/media_url.dart';

/// Active banner artwork, not a sector-derived tint.
final activeHeroArtworkProvider = StateProvider<String?>((ref) => null);

/// Square source shared between the pinned header and lower carousel.
class HomeHeroArtwork extends StatelessWidget {
  const HomeHeroArtwork({super.key, required this.url, required this.alignment});
  final String? url;
  final Alignment alignment;
  @override
  Widget build(BuildContext context) => ClipRect(child: LayoutBuilder(
    builder: (context, constraints) {
      final extent = constraints.maxWidth;
      // A missing/invalid image must not request the network or crop the
      // placeholder out of the visible carousel. The header remains decorative.
      final placeholderSize = alignment == Alignment.topCenter ? 0.0 : 28.0;
      if (resolveMediaUrl(url) == null) {
        return HatlySoftImage(url: url, width: extent, height: constraints.maxHeight,
          radius: 0, placeholderIcon: Icons.local_offer_outlined,
          placeholderIconSize: placeholderSize);
      }
      return OverflowBox(
        alignment: alignment,
        minWidth: extent, maxWidth: extent,
        minHeight: extent, maxHeight: extent,
        child: HatlySoftImage(url: url, width: extent, height: extent,
          radius: 0, placeholderIcon: Icons.local_offer_outlined,
          placeholderIconSize: placeholderSize),
      );
    },
  ));
}

class HomePinnedSearchScope extends InheritedWidget {
  const HomePinnedSearchScope({super.key, required this.pinned, required super.child});
  final bool pinned;
  static bool of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<HomePinnedSearchScope>()?.pinned ?? false;
  @override
  bool updateShouldNotify(HomePinnedSearchScope oldWidget) => pinned != oldWidget.pinned;
}
