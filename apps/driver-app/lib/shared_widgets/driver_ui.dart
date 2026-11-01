import 'package:flutter/material.dart';
import '../core/localization/bilingual.dart';

/// A soft white card with a thin border — the one container every driver screen uses.
class DriverCard extends StatelessWidget {
  const DriverCard(
      {super.key,
      required this.child,
      this.onTap,
      this.padding = const EdgeInsets.all(14),
      this.margin = const EdgeInsets.only(bottom: 12),
      this.accent});
  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(16);
    // The soft lift sits OUTSIDE an opaque white Material (a shadow painted over the card would grey it); ink and list tiles inside paint on that Material.
    return Padding(
      padding: margin,
      child: DecoratedBox(
        decoration: BoxDecoration(borderRadius: radius, boxShadow: const [
          BoxShadow(
              color: Color(0x14000000), blurRadius: 10, offset: Offset(0, 3))
        ]),
        child: Material(
          color: Colors.white,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
              borderRadius: radius,
              side: BorderSide(color: accent ?? const Color(0xFFE9E9E9))),
          child: InkWell(
              onTap: onTap, child: Padding(padding: padding, child: child)),
        ),
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8, top: 4),
        child: Row(children: [
          Expanded(
              child: Text(text,
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(fontWeight: FontWeight.w800))),
          if (trailing != null) trailing!
        ]),
      );
}

/// A big number with a small label — the summary tiles on Home and Earnings.
class KpiTile extends StatelessWidget {
  const KpiTile(
      {super.key,
      required this.label,
      required this.value,
      this.emphasis = false});
  final String label;
  final String value;
  final bool emphasis;
  @override
  Widget build(BuildContext context) {
    final orange = Theme.of(context).colorScheme.primary;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: emphasis
                ? orange.withValues(alpha: 0.10)
                : const Color(0xFFF7F7F7),
            borderRadius: BorderRadius.circular(14)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(value,
              style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: emphasis ? orange : const Color(0xFF1A1A1A))),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
        ]),
      ),
    );
  }
}

/// An empty or failed state with a retry — never a blank screen.
class MessageView extends StatelessWidget {
  const MessageView(
      {super.key,
      required this.icon,
      required this.message,
      this.hint,
      this.onRetry});
  final IconData icon;
  final String message;
  final String? hint;
  final VoidCallback? onRetry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 40, color: const Color(0xFFB0B0B0)),
            const SizedBox(height: 10),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w700)),
            if (hint != null) ...[
              const SizedBox(height: 4),
              Text(hint!,
                  textAlign: TextAlign.center,
                  style:
                      const TextStyle(color: Color(0xFF6B6B6B), fontSize: 13))
            ],
            if (onRetry != null)
              TextButton(
                  onPressed: onRetry,
                  child: Text(context.t('Retry', 'إعادة المحاولة'))),
          ]),
        ),
      );
}
