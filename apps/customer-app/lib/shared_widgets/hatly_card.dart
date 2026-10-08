import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// UI/UX-0 Design System. Default = flat surface + subtle border (no
/// shadow) per the approved Design Review — ordinary content cards
/// (vendor/product/order/etc.) should never be elevated; only
/// genuinely floating UI (dialogs, bottom sheets) may set [elevated]
/// true.
///
/// Dark Mode fix: this used to hardcode `HatlyColors.surfaceWhite`,
/// which rendered a fixed white card on a dark background wherever
/// this widget is used (`VendorCard`, Favorites). Now reads
/// `context.palette` like `HatlySurface`, so both existing call sites
/// become theme-aware for free — no change needed to them. In Light
/// Mode `p.surface`/`p.border` are the exact same values as the old
/// constants, so this is visually a no-op there.
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
    final p = context.palette;
    final content = Container(
      padding: padding ?? const EdgeInsets.all(HatlySpacing.md),
      decoration: BoxDecoration(
        color: p.surface,
        borderRadius: BorderRadius.circular(HatlyRadius.card),
        border: elevated ? null : Border.all(color: p.border),
        // Same blur/offset as before this fix — only the colour is now
        // theme-aware (`p.shadow` in Light Mode is the exact same 8% black
        // as the old hardcoded `Colors.black.withOpacity(0.08)`).
        boxShadow: elevated
            ? [BoxShadow(color: p.shadow, blurRadius: 12, offset: const Offset(0, 4))]
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
