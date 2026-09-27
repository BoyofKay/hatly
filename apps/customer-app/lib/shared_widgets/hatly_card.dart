import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// UI/UX-0 Design System. Default = flat white surface + subtle
/// border (no shadow) per the approved Design Review — ordinary
/// content cards (vendor/product/order/etc.) should never be
/// elevated; only genuinely floating UI (dialogs, bottom sheets) may
/// set [elevated] true.
class HatlyCard extends StatelessWidget {
  const HatlyCard(
      {super.key,
      required this.child,
      this.padding,
      this.elevated = false,
      this.onTap});

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final bool elevated;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final content = Container(
      padding: padding ?? const EdgeInsets.all(HatlySpacing.md),
      decoration: BoxDecoration(
        color: HatlyColors.surfaceWhite,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        border: elevated ? null : Border.all(color: HatlyColors.border),
        boxShadow: elevated
            ? [
                BoxShadow(
                    color: Colors.black.withOpacity(0.08),
                    blurRadius: 12,
                    offset: const Offset(0, 4))
              ]
            : null,
      ),
      child: child,
    );

    if (onTap == null) return content;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(HatlyRadius.card),
      child: content,
    );
  }
}
