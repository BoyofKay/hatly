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
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: isLoading ? null : onPressed,
        child: isLoading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2.5, color: Colors.white),
              )
            : Text(label,
                style:
                    const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      ),
    );
  }
}
