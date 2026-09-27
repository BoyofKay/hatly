import 'package:flutter/material.dart';
import '../../../../shared_widgets/skeleton_box.dart';

class ProductListTileSkeleton extends StatelessWidget {
  const ProductListTileSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          const SkeletonBox(width: 72, height: 72, borderRadius: 12),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: const [
                SkeletonBox(width: double.infinity, height: 13),
                SizedBox(height: 8),
                SkeletonBox(width: 160, height: 11),
                SizedBox(height: 8),
                SkeletonBox(width: 70, height: 13),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
