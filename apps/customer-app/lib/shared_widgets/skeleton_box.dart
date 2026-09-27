import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// A static gray rounded-rect placeholder. Deliberately not an
/// animated shimmer — no new dependency was worth adding for that, and
/// the spec asks for "minimal unnecessary animation" — a plain skeleton
/// still communicates "loading" without extra motion.
class SkeletonBox extends StatelessWidget {
  const SkeletonBox(
      {super.key,
      required this.width,
      required this.height,
      this.borderRadius = 8});

  final double width;
  final double height;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: context.palette.surfaceSoft,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}
