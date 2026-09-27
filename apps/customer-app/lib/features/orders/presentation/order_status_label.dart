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
    case 'CANCELLED':
      return l10n.orderStatusCancelled;
    case 'FAILED_DELIVERY':
      return l10n.orderStatusFailedDelivery;
    default:
      return status;
  }
}

Color _orderStatusColor(String status) {
  switch (status) {
    case 'DELIVERED':
      return HatlyColors.success;
    case 'CANCELLED':
    case 'FAILED_DELIVERY':
      return HatlyColors.error;
    default:
      return HatlyColors.primaryOrange;
  }
}

/// Same mapping from the theme palette (`success` / `urgent` / `accent` — identical to the fixed colours above in
/// Light Mode, but readable on a dark surface).
Color _orderStatusPaletteColor(BuildContext context, String status) {
  final p = context.palette;
  switch (status) {
    case 'DELIVERED':
      return p.success;
    case 'CANCELLED':
    case 'FAILED_DELIVERY':
      return p.urgent;
    default:
      return p.accent;
  }
}

class OrderStatusBadge extends StatelessWidget {
  const OrderStatusBadge(
      {super.key, required this.status, this.themeAware = false});

  final String status;

  /// Off by default: screens still on legacy light-only surfaces (the Orders list) keep the fixed colours. Order
  /// Details sits on palette surfaces, so it opts in to theme-aware colours.
  final bool themeAware;

  @override
  Widget build(BuildContext context) {
    final color = themeAware
        ? _orderStatusPaletteColor(context, status)
        : _orderStatusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(12)),
      child: Text(
        orderStatusLabel(context, status),
        style:
            TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}
