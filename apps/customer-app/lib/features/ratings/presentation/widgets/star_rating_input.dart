import 'package:flutter/material.dart';

/// Customer Ratings. Confirmed no existing star-rating widget exists
/// anywhere in this app — created fresh, matching the backend's exact
/// 1–5 integer scale (no half-stars, no 10-point scale, no emoji).
class StarRatingInput extends StatelessWidget {
  const StarRatingInput(
      {super.key,
      required this.value,
      required this.onChanged,
      this.size = 32});

  /// 0 means "nothing selected yet."
  final int value;
  final ValueChanged<int> onChanged;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        final starValue = index + 1;
        final filled = starValue <= value;
        return Semantics(
          button: true,
          label: '$starValue',
          child: InkWell(
            onTap: () => onChanged(starValue),
            borderRadius: BorderRadius.circular(size),
            child: Padding(
              padding: const EdgeInsets.all(4),
              child: Icon(
                filled ? Icons.star : Icons.star_border,
                color: Colors.amber,
                size: size,
              ),
            ),
          ),
        );
      }),
    );
  }
}

/// Read-only display of an already-submitted rating — no tap targets,
/// matching the backend's immutable-rating design exactly (no edit,
/// no delete, no second Submit).
class StarRatingDisplay extends StatelessWidget {
  const StarRatingDisplay({super.key, required this.value, this.size = 20});

  final int value;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (index) {
        return Icon(
          index < value ? Icons.star : Icons.star_border,
          color: Colors.amber,
          size: size,
        );
      }),
    );
  }
}
