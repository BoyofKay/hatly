import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// "Title ........ عرض الكل ←" on one line. The action is orange text plus an
/// arrow (never colour alone) and keeps a ≥44px touch target. No subtitle by
/// design. The arrow mirrors automatically in RTL.
class HatlySectionHeader extends StatelessWidget {
  const HatlySectionHeader(
      {super.key, required this.title, this.seeAllLabel, this.onSeeAll});

  final String title;
  final String? seeAllLabel;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final showAction = onSeeAll != null && seeAllLabel != null;

    return Padding(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.screenPadding),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
        child: Row(
          children: [
            Container(
              width: 4,
              height: 20,
              margin: const EdgeInsetsDirectional.only(end: HatlySpacing.sm),
              decoration: BoxDecoration(
                  color: p.accent,
                  borderRadius: BorderRadius.circular(HatlyRadius.circular)),
            ),
            Expanded(
              child: Semantics(
                header: true,
                child: Text(title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: context.type.h2),
              ),
            ),
            if (showAction)
              // Sized to its own label (capped), so it sits at the row's far end instead of floating mid-row.
              ConstrainedBox(
                constraints: BoxConstraints(
                    maxWidth: MediaQuery.sizeOf(context).width * 0.4),
                child: InkWell(
                  borderRadius: BorderRadius.circular(HatlyRadius.circular),
                  onTap: onSeeAll,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(
                        minHeight: HatlyTouch.minTarget,
                        minWidth: HatlyTouch.minTarget),
                    child: Padding(
                      padding: const EdgeInsetsDirectional.only(
                          start: HatlySpacing.sm),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Flexible(
                            child: Text(
                              seeAllLabel!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: context.type.small.copyWith(
                                  color: p.link, fontWeight: FontWeight.w700),
                            ),
                          ),
                          const SizedBox(width: HatlySpacing.xs),
                          Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(
                                color: p.accentSoft, shape: BoxShape.circle),
                            child: Icon(Icons.arrow_forward_rounded,
                                size: 14, color: p.link),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
