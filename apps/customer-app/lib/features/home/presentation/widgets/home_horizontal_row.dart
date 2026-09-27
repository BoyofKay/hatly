import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';

/// Horizontal card row that shows a fractional number of cards (default 2.5)
/// so the next card peeks in and the row reads as scrollable on any width.
/// Card width is derived from the viewport; card height comes from the tallest
/// card's content, so larger system text never overflows.
class HomeHorizontalRow extends StatelessWidget {
  const HomeHorizontalRow({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    this.visibleCards = 2.5,
    this.gap = HatlySpacing.ms,
  });

  final int itemCount;

  /// Receives the computed card width.
  final Widget Function(BuildContext context, int index, double cardWidth)
      itemBuilder;
  final double visibleCards;
  final double gap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final usable = constraints.maxWidth - HatlySpacing.screenPadding;
        final cardWidth = (usable - gap * (visibleCards - 1)) / visibleCards;

        return SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(
              horizontal: HatlySpacing.screenPadding,
              vertical: HatlySpacing.xs),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < itemCount; i++) ...[
                  if (i > 0) SizedBox(width: gap),
                  itemBuilder(context, i, cardWidth),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}
