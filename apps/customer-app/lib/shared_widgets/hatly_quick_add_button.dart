import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// The floating "+" on product cards: a circular, ≥44px brand-orange control
/// with dark ink (7:1 on the orange) and a soft shadow. Sits over the corner of
/// a card's image. Presentation only — [onPressed] is supplied by the caller.
class HatlyQuickAddButton extends StatelessWidget {
  const HatlyQuickAddButton(
      {super.key,
      required this.tooltip,
      required this.onPressed,
      this.quiet = false});

  final String tooltip;
  final VoidCallback? onPressed;

  /// Quieter look for dense grids: a 36px white circle with an orange line icon and a soft shadow. The
  /// touch target stays [size] (44px) — only the drawn circle is smaller.
  final bool quiet;

  /// Diameter of the drawn circle in the [quiet] variant.
  static const double quietVisualSize = 36;

  /// Diameter — also the minimum touch target.
  static const double size = HatlyTouch.minTarget;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    if (quiet) return _buildQuiet(context, p);
    final enabled = onPressed != null;
    return Semantics(
      button: true,
      enabled: enabled,
      label: tooltip,
      onTap: onPressed,
      excludeSemantics: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: enabled ? p.accent : p.surfaceSoft,
          shape: BoxShape.circle,
          boxShadow: HatlyShadows.soft(p),
        ),
        child: Material(
          type: MaterialType.transparency,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onPressed,
            child: SizedBox(
              width: size,
              height: size,
              child: Icon(Icons.add_rounded, color: enabled ? p.accentOn : p.textMuted, size: 24),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildQuiet(BuildContext context, HatlyPalette p) {
    final enabled = onPressed != null;
    return Semantics(
      button: true,
      label: tooltip,
      onTap: onPressed,
      excludeSemantics: true,
      child: SizedBox(
        width: size,
        height: size,
        child: InkResponse(
          onTap: onPressed,
          radius: size / 2,
          child: Center(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: enabled ? p.surface : p.surfaceSoft,
                shape: BoxShape.circle,
                boxShadow: HatlyShadows.soft(p),
              ),
              child: SizedBox(
                width: quietVisualSize,
                height: quietVisualSize,
                child: Icon(Icons.add_rounded, color: enabled ? p.accent : p.textMuted, size: 22),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
