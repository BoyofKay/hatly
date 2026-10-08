import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// A quiet inline error banner rather than a SnackBar or dialog — auth
/// forms should show the error next to the field it relates to and
/// let the user immediately retry, not interrupt them with a modal.
class HatlyErrorBanner extends StatelessWidget {
  const HatlyErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    // Dark Mode fix: this — the app's own "correct" shared error-banner
    // pattern that other ad-hoc `Colors.red` call sites should have been
    // routed through — hardcoded `HatlyColors.error` itself, instead of the
    // theme's dark-mode-tuned `p.urgent` (used everywhere else an
    // error/urgent colour needs to work on a dark surface, e.g.
    // `hatly_theme.dart`'s own `errorBorder`). Identical value in Light Mode.
    final errorColor = context.palette.urgent;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: errorColor.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: errorColor.withOpacity(0.25)),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: errorColor, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(message,
                style: TextStyle(color: errorColor, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
