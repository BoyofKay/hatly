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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: HatlyColors.error.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: HatlyColors.error.withOpacity(0.25)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: HatlyColors.error, size: 18),
          const SizedBox(width: 8),
          Expanded(
            child: Text(message,
                style: const TextStyle(color: HatlyColors.error, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
