import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';

/// Contextual badge kinds. Every kind has its own icon, and its own colour
/// treatment, so status is never conveyed by colour alone and a "flash sale"
/// can never be mistaken for "open now".
enum HatlyBadgeKind {
  offer,
  flashSale,
  freeDelivery,
  bundle,
  newItem,
  popular,
  open,
  closed,
  unavailable
}

class HatlyBadge extends StatelessWidget {
  const HatlyBadge({super.key, required this.kind, required this.label});

  final HatlyBadgeKind kind;
  final String label;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final spec = _spec(kind, p);

    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: HatlySpacing.sm, vertical: 3),
        decoration: BoxDecoration(
          color: spec.background,
          borderRadius: BorderRadius.circular(HatlyRadius.badge),
          border: spec.outlined
              ? Border.all(color: spec.foreground.withValues(alpha: 0.5))
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(spec.icon, size: 14, color: spec.foreground),
            const SizedBox(width: HatlySpacing.xs),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: context.type.caption.copyWith(
                    color: spec.foreground, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static _BadgeSpec _spec(HatlyBadgeKind kind, HatlyPalette p) {
    switch (kind) {
      case HatlyBadgeKind.offer:
        return _BadgeSpec(p.accentSoft, p.link, Icons.local_offer_outlined);
      case HatlyBadgeKind.flashSale:
        // Solid + bolt: the one urgency-coded badge.
        return _BadgeSpec(p.urgent, Colors.white, Icons.bolt_rounded);
      case HatlyBadgeKind.freeDelivery:
        return _BadgeSpec(p.success.withValues(alpha: 0.14), p.success,
            Icons.delivery_dining_outlined);
      case HatlyBadgeKind.bundle:
        return _BadgeSpec(
            p.info.withValues(alpha: 0.14), p.info, Icons.inventory_2_outlined);
      case HatlyBadgeKind.newItem:
        return _BadgeSpec(
            Colors.transparent, p.textPrimary, Icons.auto_awesome_outlined,
            outlined: true);
      case HatlyBadgeKind.popular:
        return _BadgeSpec(p.warning.withValues(alpha: 0.14), p.warning,
            Icons.local_fire_department_outlined);
      case HatlyBadgeKind.open:
        return _BadgeSpec(p.success.withValues(alpha: 0.14), p.success,
            Icons.check_circle_outline_rounded);
      case HatlyBadgeKind.closed:
        return _BadgeSpec(p.neutralStatus.withValues(alpha: 0.14),
            p.neutralStatus, Icons.schedule_rounded);
      case HatlyBadgeKind.unavailable:
        return _BadgeSpec(p.neutralStatus.withValues(alpha: 0.14),
            p.neutralStatus, Icons.block_rounded);
    }
  }
}

class _BadgeSpec {
  const _BadgeSpec(this.background, this.foreground, this.icon,
      {this.outlined = false});

  final Color background;
  final Color foreground;
  final IconData icon;
  final bool outlined;
}
