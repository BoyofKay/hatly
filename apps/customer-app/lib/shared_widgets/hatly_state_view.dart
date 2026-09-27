import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// Shared empty/error state presentation — used wherever a list can
/// come back empty or fail (vendor discovery now; orders/favorites
/// lists later reuse this rather than each screen inventing its own).
/// Never leave a blank screen when a list has nothing or fails to
/// load (spec: "do not leave blank screens").
class HatlyStateView extends StatelessWidget {
  const HatlyStateView({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.retryLabel,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? retryLabel;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: HatlyColors.textMuted),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: HatlyColors.textDark),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 6),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style:
                    const TextStyle(fontSize: 13, color: HatlyColors.textMuted),
              ),
            ],
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              OutlinedButton(onPressed: onRetry, child: Text(retryLabel ?? '')),
            ],
          ],
        ),
      ),
    );
  }
}
