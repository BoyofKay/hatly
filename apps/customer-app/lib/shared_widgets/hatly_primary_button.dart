import 'package:flutter/material.dart';

/// The one button style used across auth/shell screens, so "primary
/// action" always looks the same. Shows a spinner in place of the
/// label while [isLoading] is true, and disables itself — callers
/// don't need to guard against double-submits separately.
class HatlyPrimaryButton extends StatelessWidget {
  const HatlyPrimaryButton({
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
    // Dark Mode fix (audit F-D6): the spinner used to hardcode
    // `Colors.white`, independent of this button's own dark-mode foreground
    // (`legacyOnOrange` in hatly_theme.dart, passed straight through as
    // `ColorScheme.fromSeed(onPrimary: legacyOnOrange, ...)`).
    // `colorScheme.onPrimary` is exactly that same value, so the spinner
    // always matches the label colour Flutter itself paints on this
    // ElevatedButton — identical (white) in Light Mode.
    final foregroundColor = Theme.of(context).colorScheme.onPrimary;
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: isLoading ? null : onPressed,
        child: isLoading
            ? SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2.5, color: foregroundColor),
              )
            // Polish pass: no longer overrides with a hardcoded 16/w600 style —
            // inherits the same `ElevatedButtonThemeData.textStyle` (13/w500)
            // every other primary button (`HatlyButton`) already uses, so the
            // two shared button widgets render identical label text.
            : Text(label),
      ),
    );
  }
}
