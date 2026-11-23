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
    // Dark Mode fix: this shared empty/error state (used by nearly every
    // list screen in the app) used to hardcode `HatlyColors.textMuted`/
    // `textDark` — fixed near-black colours that rendered as barely-legible
    // dark-on-dark text on a dark background. Now theme-aware; identical to
    // the old constants in Light Mode.
    final p = context.palette;
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // A soft brand halo around the icon: calm, recognisably Hatly, never alarming.
            Container(
              width: 64,
              height: 64,
              decoration:
                  BoxDecoration(color: p.accentSoft, shape: BoxShape.circle),
              child: Icon(icon, size: 30, color: p.accent),
            ),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              // Polish pass: was a raw `TextStyle` (Roboto fallback, not the
              // approved Inter+Cairo family) — now the app's own type scale,
              // same visual weight as before.
              style: context.type.title
                  .copyWith(fontWeight: FontWeight.w700, color: p.textPrimary),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 6),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: context.type.caption.copyWith(color: p.textMuted),
              ),
            ],
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 260),
                child: OutlinedButton(
                    onPressed: onRetry, child: Text(retryLabel ?? '')),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
