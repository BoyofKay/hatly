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
    // Dark Mode fix: the unselected chip used to hardcode
    // `HatlyColors.surfaceWhite`/`textDark`/`border` — a fixed white chip
    // with near-black text on a dark background. Now theme-aware; identical
    // to the old constants in Light Mode. The SELECTED fill/text stay
    // white-on-[color] (a self-contained filled badge, unaffected by the
    // surrounding theme, same as the app's other solid status badges).
    final p = context.palette;
    final baseColor = color ?? HatlyColors.primaryOrange;
    final background = selected ? baseColor : p.surface;
    final foreground = selected
        ? HatlyColors.surfaceWhite
        : (variant == HatlyChipVariant.status ? baseColor : p.textPrimary);
    final borderColor = selected
        ? baseColor
        : (variant == HatlyChipVariant.status
            ? baseColor.withOpacity(0.4)
            : p.border);

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
