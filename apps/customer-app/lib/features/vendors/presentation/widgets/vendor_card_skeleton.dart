import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/skeleton_box.dart';

/// Skeleton shaped like a VendorCard, repeated a few times while the
/// (currently fixture, later real) vendor list is loading.
class VendorCardSkeleton extends StatelessWidget {
  const VendorCardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          vertical: HatlySpacing.sm, horizontal: HatlySpacing.md),
      child: Row(
        children: [
          const SkeletonBox(width: 72, height: 72, borderRadius: 12),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: const [
                SkeletonBox(width: double.infinity, height: 14),
                SizedBox(height: HatlySpacing.sm),
                SkeletonBox(width: 120, height: 12),
                SizedBox(height: HatlySpacing.sm),
                SkeletonBox(width: 160, height: 12),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
