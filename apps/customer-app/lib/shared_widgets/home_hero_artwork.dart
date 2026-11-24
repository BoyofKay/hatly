import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'hatly_soft_image.dart';

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
      return OverflowBox(
        alignment: alignment,
        minWidth: extent, maxWidth: extent,
        minHeight: extent, maxHeight: extent,
        child: HatlySoftImage(url: url, width: extent, height: extent,
          radius: 0, placeholderIconSize: 0),
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
