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
    final child = isLoading
        ? const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
                strokeWidth: 2, color: HatlyColors.surfaceWhite),
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
        button = ElevatedButton(
          onPressed: effectiveOnPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: HatlyColors.error,
            disabledBackgroundColor: HatlyColors.error.withOpacity(0.4),
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
