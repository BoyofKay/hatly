import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

enum HatlyChipVariant { category, status, offer, availability }

/// UI/UX-0 Design System. Replaces the inline
/// `textMuted.withOpacity(0.15)` badge pattern copy-pasted across
/// screens pre-UI/UX-0 (e.g. the Custom Request badge in
/// cart_item_tile.dart) with one shared pill component. [color]
/// lets a caller supply a semantic color (e.g. HatlyColors.success
/// for a "Delivered" status chip) without this widget inventing
/// status-to-color mappings itself — that mapping is a business/UX
/// decision for the screen using it, not this foundation component.
class HatlyChip extends StatelessWidget {
  const HatlyChip({
    super.key,
    required this.label,
    this.variant = HatlyChipVariant.category,
    this.selected = false,
    this.color,
    this.onTap,
  });

  final String label;
  final HatlyChipVariant variant;
  final bool selected;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final baseColor = color ?? HatlyColors.primaryOrange;
    final background = selected ? baseColor : HatlyColors.surfaceWhite;
    final foreground = selected
        ? HatlyColors.surfaceWhite
        : (variant == HatlyChipVariant.status
            ? baseColor
            : HatlyColors.textDark);
    final borderColor = selected
        ? baseColor
        : (variant == HatlyChipVariant.status
            ? baseColor.withOpacity(0.4)
            : HatlyColors.border);

    final chip = Container(
      padding: const EdgeInsets.symmetric(
          horizontal: HatlySpacing.ms, vertical: HatlySpacing.xs),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(HatlyRadius.chip),
        border: Border.all(color: borderColor),
      ),
      child: Text(
        label,
        style:
            Theme.of(context).textTheme.labelLarge?.copyWith(color: foreground),
      ),
    );

    if (onTap == null) return chip;
    return InkWell(
        borderRadius: BorderRadius.circular(HatlyRadius.chip),
        onTap: onTap,
        child: chip);
  }
}
