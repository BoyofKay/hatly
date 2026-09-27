import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';

/// Validation / server error for the authentication screens, in the approved
/// design language: 12px radius, tinted surface, icon + text (never colour
/// alone), announced to screen readers. Presentation only — the message and
/// when it shows are decided by the caller exactly as before.
class AuthErrorNotice extends StatelessWidget {
  const AuthErrorNotice({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: HatlySpacing.md,
          vertical: HatlySpacing.ms,
        ),
        decoration: BoxDecoration(
          color: p.urgent.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(HatlyRadius.input),
          border: Border.all(color: p.urgent.withValues(alpha: 0.3)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline_rounded, color: p.urgent, size: 20),
            const SizedBox(width: HatlySpacing.sm),
            Expanded(
              child: Text(
                message,
                style: context.type.small.copyWith(
                  color: p.urgent,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
