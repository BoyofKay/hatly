import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// Full-width primary call-to-action (medium-rounded, radius 12, 52px): brand orange with dark ink (7:1),
/// an inline spinner while [isLoading] and a clearly disabled look when [onPressed] is null. Used in the
/// content flow — deliberately NOT a floating/sticky control.
class HatlyCtaButton extends StatelessWidget {
  const HatlyCtaButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final enabled = onPressed != null && !isLoading;
    return Semantics(
      button: true,
      enabled: enabled,
      label: label,
      onTap: enabled ? onPressed : null,
      excludeSemantics: true,
      child: Material(
        color: onPressed == null ? p.surfaceSoft : p.accent,
        borderRadius: BorderRadius.circular(HatlyRadius.button),
        child: InkWell(
          borderRadius: BorderRadius.circular(HatlyRadius.button),
          onTap: enabled ? onPressed : null,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52),
            child: Center(
              child: isLoading
                  ? SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                          strokeWidth: 2.5, color: p.accentOn))
                  : Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: HatlySpacing.md),
                      child: Text(label,
                          textAlign: TextAlign.center,
                          style: context.type.title.copyWith(
                              color:
                                  onPressed == null ? p.textMuted : p.accentOn,
                              fontWeight: FontWeight.w800)),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
