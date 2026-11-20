import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// UI/UX-2. Thin wrapper around HatlyChip's availability variant —
/// CONFIRMED, receives the actual availability boolean from its
/// caller (e.g. VendorBranchSummary.isOpen, itself real backend
/// data) and performs no business-availability logic of its own.
/// Open uses HatlyColors.success; closed uses
/// HatlyColors.closedUnavailable — NEVER red, which stays reserved
/// for errors/destructive/Flash Sale semantics.
class AvailabilityBadge extends StatelessWidget {
  const AvailabilityBadge(
      {super.key,
      required this.isOpen,
      required this.openLabel,
      required this.closedLabel});

  final bool isOpen;
  final String openLabel;
  final String closedLabel;

  @override
  Widget build(BuildContext context) {
    // A soft tinted pill with a status dot (text + dot, never colour alone) — calmer than a solid fill on image-led cards.
    final color =
        isOpen ? context.palette.success : HatlyColors.closedUnavailable;
    return Container(
      padding:
          const EdgeInsets.symmetric(horizontal: HatlySpacing.sm, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(HatlyRadius.circular),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: HatlySpacing.xs),
          Flexible(
            child: Text(
              isOpen ? openLabel : closedLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.type.caption
                  .copyWith(color: color, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}
