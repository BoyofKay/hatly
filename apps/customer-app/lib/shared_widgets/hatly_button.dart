import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

enum HatlyButtonVariant { primary, secondary, tertiary, destructive }

/// UI/UX-0 Design System. One button component instead of ad hoc
/// `ElevatedButton`/raw `Container`+`InkWell` combinations repeated
/// per screen (e.g. the "add photo" tile pattern seen pre-UI/UX-0).
/// Enabled/disabled/loading states are handled centrally here so no
/// future screen needs to hand-roll a `CircularProgressIndicator`
/// swap again.
class HatlyButton extends StatelessWidget {
  const HatlyButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = HatlyButtonVariant.primary,
    this.isLoading = false,
    this.fullWidth = true,
    this.icon,
  });

  final String label;
  final VoidCallback? onPressed;
  final HatlyButtonVariant variant;
  final bool isLoading;
  final bool fullWidth;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final effectiveOnPressed = isLoading ? null : onPressed;
    final p = context.palette;
    // Dark Mode fix: the loading spinner used to always hardcode
    // `HatlyColors.surfaceWhite`, regardless of variant — invisible on
    // `secondary`/`tertiary` (no fill to contrast against) and mismatched
    // with `primary`'s own dark-mode foreground (`colorScheme.onPrimary` ==
    // `legacyOnOrange` in hatly_theme.dart, dark ink in Dark Mode). Each
    // variant's spinner now matches that same variant's own label colour.
    final foregroundColor = switch (variant) {
      HatlyButtonVariant.primary => Theme.of(context).colorScheme.onPrimary,
      HatlyButtonVariant.secondary => p.textPrimary,
      HatlyButtonVariant.tertiary => p.link,
      // White-on-error/urgent has good contrast in both themes — the
      // destructive fill is never orange, so the primary button's dark-ink
      // foreground would be unreadable here.
      HatlyButtonVariant.destructive => Colors.white,
    };
    final child = isLoading
        ? SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
                strokeWidth: 2, color: foregroundColor),
          )
        : icon != null
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 20),
                  const SizedBox(width: HatlySpacing.sm),
                  Text(label)
                ],
              )
            : Text(label);

    Widget button;
    switch (variant) {
      case HatlyButtonVariant.primary:
        button = ElevatedButton(onPressed: effectiveOnPressed, child: child);
        break;
      case HatlyButtonVariant.secondary:
        button = OutlinedButton(onPressed: effectiveOnPressed, child: child);
        break;
      case HatlyButtonVariant.tertiary:
        button = TextButton(onPressed: effectiveOnPressed, child: child);
        break;
      case HatlyButtonVariant.destructive:
        // Dark Mode fix: `HatlyColors.error` (fixed) is now `p.urgent` (the
        // theme's own dark-mode-tuned error/urgent colour — identical value
        // in Light Mode), and `foregroundColor` is now set explicitly
        // instead of silently inheriting the primary button theme's
        // dark-ink-in-Dark-Mode default, which was unreadable on this red
        // fill.
        button = ElevatedButton(
          onPressed: effectiveOnPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: p.urgent,
            foregroundColor: foregroundColor,
            disabledBackgroundColor: p.urgent.withOpacity(0.4),
            minimumSize: const Size.fromHeight(48),
            shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(HatlyRadius.button)),
          ),
          child: child,
        );
        break;
    }

    return fullWidth ? SizedBox(width: double.infinity, child: button) : button;
  }
}
