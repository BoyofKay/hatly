import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_cta_button.dart';
import '../../../../shared_widgets/skeleton_box.dart';

/// Empty cart: a calm, vertically balanced visual, "سلتك مستنيا طلبك" and one primary action that takes the
/// customer back into marketplace discovery (the caller wires the navigation).
class CartEmptyView extends StatelessWidget {
  const CartEmptyView({super.key, required this.onExplore});

  final VoidCallback onExplore;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.xl, vertical: HatlySpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(
              child: SizedBox(
                width: 132,
                height: 132,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    DecoratedBox(
                      decoration: BoxDecoration(
                          color: p.accentSoft, shape: BoxShape.circle),
                      child: const SizedBox(width: 132, height: 132),
                    ),
                    DecoratedBox(
                      decoration: BoxDecoration(
                        color: p.surface,
                        shape: BoxShape.circle,
                        boxShadow: HatlyShadows.soft(p),
                      ),
                      child: SizedBox(
                        width: 84,
                        height: 84,
                        child: Icon(Icons.shopping_bag_outlined,
                            size: 40, color: p.accent),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: HatlySpacing.lg),
            Semantics(
              header: true,
              child: Text(l10n.cartEmptyTitle,
                  textAlign: TextAlign.center,
                  style: context.type.h2.copyWith(
                      color: p.textPrimary, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(height: HatlySpacing.lg),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 320),
              child: HatlyCtaButton(
                  label: l10n.cartEmptyCta, onPressed: onExplore),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cart-shaped, static placeholder: a vendor header and a few product rows (image block, text lines,
/// quantity and price areas). No shimmer — lightweight by design.
class CartSkeleton extends StatelessWidget {
  const CartSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      label: AppLocalizations.of(context).cart,
      child: ExcludeSemantics(
        child: ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(HatlySpacing.screenPadding),
          children: [
            DecoratedBox(
              decoration: BoxDecoration(
                color: p.surface,
                borderRadius: BorderRadius.circular(HatlyRadius.card),
                boxShadow: HatlyShadows.soft(p),
              ),
              child: Padding(
                padding: const EdgeInsets.all(HatlySpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        SkeletonBox(width: 22, height: 22, borderRadius: 6),
                        SizedBox(width: HatlySpacing.ms),
                        SkeletonBox(width: 140, height: 18),
                        Spacer(),
                        SkeletonBox(width: 64, height: 18),
                      ],
                    ),
                    for (var i = 0; i < 3; i++) ...[
                      const SizedBox(height: HatlySpacing.md),
                      const Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SkeletonBox(
                              width: 72,
                              height: 72,
                              borderRadius: HatlyRadius.imageContainer),
                          SizedBox(width: HatlySpacing.ms),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                SkeletonBox(width: 160, height: 16),
                                SizedBox(height: HatlySpacing.sm),
                                SkeletonBox(width: 110, height: 12),
                                SizedBox(height: HatlySpacing.sm),
                                SkeletonBox(width: 70, height: 16),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: HatlySpacing.sm),
                      const Row(
                        children: [
                          SkeletonBox(
                              width: 124,
                              height: 44,
                              borderRadius: HatlyRadius.circular),
                          Spacer(),
                          SkeletonBox(width: 44, height: 44, borderRadius: 22),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
