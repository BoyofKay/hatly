import 'package:flutter/material.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';

/// Maps the backend's `OrderStatus` enum value to a customer-facing
/// localized label — one place, reused by the history list and the
/// details screen, so the two never drift. Never modifies or infers
/// status; purely a display mapping over the exact string the backend
/// sends.
String orderStatusLabel(BuildContext context, String status) {
  final l10n = AppLocalizations.of(context);
  switch (status) {
    case 'PENDING':
      return l10n.orderStatusPending;
    case 'CONFIRMED':
      return l10n.orderStatusConfirmed;
    case 'PREPARING':
      return l10n.orderStatusPreparing;
    case 'READY_FOR_PICKUP':
      return l10n.orderStatusReadyForPickup;
    case 'ASSIGNED_TO_DRIVER':
      return l10n.orderStatusAssignedToDriver;
    case 'PICKED_UP':
      return l10n.orderStatusPickedUp;
    case 'ON_THE_WAY':
      return l10n.orderStatusOnTheWay;
    case 'DELIVERED':
      return l10n.orderStatusDelivered;
    // U2: a pickup order the customer collected at the branch — completed, like a delivered order.
    case 'COLLECTED':
      return l10n.orderStatusCollected;
    case 'CANCELLED':
      return l10n.orderStatusCancelled;
    case 'FAILED_DELIVERY':
      return l10n.orderStatusFailedDelivery;
    default:
      return status;
  }
}

/// Maps a status to its palette colour (`success` / `urgent` / `accent`) —
/// identical to the app's legacy fixed colours in Light Mode, but readable
/// on a dark surface in Dark Mode too.
Color _orderStatusColor(BuildContext context, String status) {
  final p = context.palette;
  switch (status) {
    case 'DELIVERED':
    case 'COLLECTED':
      return p.success;
    case 'CANCELLED':
    case 'FAILED_DELIVERY':
      return p.urgent;
    default:
      return p.accent;
  }
}

class OrderStatusBadge extends StatelessWidget {
  const OrderStatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    // Dark Mode cleanup: every call site (Orders list, Order Details,
    // Tracking) already opted in to the theme-aware colour via the old
    // `themeAware: true` parameter, so the parameter and the legacy fixed-
    // colour branch it gated are now dead code — removed rather than kept
    // as an unused second code path.
    final color = _orderStatusColor(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: HatlySpacing.sm, vertical: HatlySpacing.xs),
      // Polish pass: radius was a literal `12`, diverging from
      // `HatlyRadius.badge` (8) — the shared `HatlyBadge` widget already
      // uses the correct token. `withOpacity` (deprecated) -> `withValues`,
      // matching the rest of this feature (checkout_screen.dart etc).
      decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(HatlyRadius.badge)),
      child: Text(
        orderStatusLabel(context, status),
        style:
            TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
