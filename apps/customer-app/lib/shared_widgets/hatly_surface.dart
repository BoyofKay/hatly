import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// A card built from the theme palette, so it is correct in Light AND Dark Mode (the legacy `HatlyCard` is a fixed white).
/// Same flat, bordered, card-radius look. When [onTap] is set the whole card is one button (with a minimum touch target and
/// an ink response); pass [semanticLabel] when its visible text alone is not a good spoken description.
class HatlySurface extends StatelessWidget {
  const HatlySurface({
    super.key,
    required this.child,
    this.padding,
    this.onTap,
    this.semanticLabel,
    this.borderColor,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;
  final String? semanticLabel;
  final Color? borderColor;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final radius = BorderRadius.circular(HatlyRadius.card);
    final inner = padding == EdgeInsets.zero
        ? child
        : Padding(
            padding: padding ?? const EdgeInsets.all(HatlySpacing.md),
            child: child);
    // A real Material (not a bare DecoratedBox) so ink splashes and list tiles inside — e.g. an ExpansionTile — paint on it.
    final surface = DecoratedBox(
      // The soft lift every premium card shares (the same shadow as the vendor and product cards), under a hairline border.
      decoration:
          BoxDecoration(borderRadius: radius, boxShadow: HatlyShadows.soft(p)),
      child: Material(
        color: p.surface,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side:
              BorderSide(color: borderColor ?? p.border.withValues(alpha: 0.7)),
        ),
        child: onTap == null ? inner : InkWell(onTap: onTap, child: inner),
      ),
    );
    if (onTap == null) return surface;
    return Semantics(
      button: true,
      label: semanticLabel,
      container: true,
      child: surface,
    );
  }
}

/// A screen section: a title above its content, with the approved spacing.
class HatlySection extends StatelessWidget {
  const HatlySection({
    super.key,
    required this.title,
    required this.child,
    this.trailing,
    this.icon,
  });

  final String title;
  final Widget child;
  final Widget? trailing;

  /// Reference board (checkout / order screens): a soft orange icon box leads the heading instead of the accent bar.
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (icon != null)
              Container(
                width: 32,
                height: 32,
                margin: const EdgeInsetsDirectional.only(end: HatlySpacing.sm),
                decoration: BoxDecoration(
                    color: context.palette.accentSoft,
                    borderRadius: BorderRadius.circular(HatlyRadius.chip + 2)),
                child: Icon(icon, size: 18, color: context.palette.accent),
              )
            else
              // The same orange accent bar as the Home section headers, so every screen's headings read as one family.
              Container(
                width: 4,
                height: 18,
                margin: const EdgeInsetsDirectional.only(end: HatlySpacing.sm),
                decoration: BoxDecoration(
                    color: context.palette.accent,
                    borderRadius: BorderRadius.circular(HatlyRadius.circular)),
              ),
            Expanded(
              child: Semantics(
                header: true,
                child: Text(title, style: context.type.title),
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
        const SizedBox(height: HatlySpacing.sm),
        child,
      ],
    );
  }
}
