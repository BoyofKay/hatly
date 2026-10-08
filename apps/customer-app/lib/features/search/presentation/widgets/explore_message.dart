import 'package:flutter/material.dart';
import '../../../../core/theme/hatly_theme.dart';

/// Empty / error / prompt message for Explore. Palette-aware (works in dark
/// mode). Note: `HatlyStateView` (shared_widgets) is also theme-aware now —
/// this widget predates that fix and was kept as-is for this Explore screen
/// rather than consolidated, to avoid a wider call-site migration outside
/// this polish pass's scope.
class ExploreMessage extends StatelessWidget {
  const ExploreMessage({
    super.key,
    required this.icon,
    required this.title,
    this.retryLabel,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String? retryLabel;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(HatlySpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: p.textMuted),
            const SizedBox(height: HatlySpacing.md),
            Text(title,
                textAlign: TextAlign.center,
                style: context.type.body.copyWith(color: p.textMuted)),
            if (onRetry != null && retryLabel != null) ...[
              const SizedBox(height: HatlySpacing.md),
              TextButton(
                onPressed: onRetry,
                style: TextButton.styleFrom(
                    minimumSize:
                        const Size(HatlyTouch.minTarget, HatlyTouch.minTarget),
                    foregroundColor: p.link),
                child: Text(retryLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
