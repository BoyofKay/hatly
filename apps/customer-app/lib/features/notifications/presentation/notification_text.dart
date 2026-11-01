import 'package:flutter/material.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../domain/customer_notification.dart';

/// What to show for a notification: the app's own localized wording for the types it knows, the server's English text
/// otherwise (an app older than a new server-side type still shows something truthful).
class NotificationText {
  const NotificationText(this.title, this.body, this.icon);
  final String title;
  final String body;
  final IconData icon;
}

NotificationText notificationText(
    AppLocalizations l10n, CustomerNotification n) {
  final no = n.orderNumber;
  switch (n.type) {
    case 'ORDER_PLACED':
      return NotificationText(l10n.notificationOrderPlacedTitle,
          l10n.notificationOrderPlacedBody(no), Icons.receipt_long_outlined);
    case 'ORDER_CONFIRMED':
      return NotificationText(l10n.notificationOrderConfirmedTitle,
          l10n.notificationOrderConfirmedBody(no), Icons.check_circle_outline);
    case 'ORDER_PREPARING':
      return NotificationText(l10n.notificationOrderPreparingTitle,
          l10n.notificationOrderPreparingBody(no), Icons.soup_kitchen_outlined);
    case 'ORDER_READY_FOR_PICKUP':
      return NotificationText(
          l10n.notificationOrderReadyForPickupTitle,
          l10n.notificationOrderReadyForPickupBody(no),
          Icons.storefront_outlined);
    case 'ORDER_ON_THE_WAY':
      return NotificationText(l10n.notificationOrderOnTheWayTitle,
          l10n.notificationOrderOnTheWayBody(no), Icons.two_wheeler_outlined);
    case 'ORDER_DELIVERED':
      return NotificationText(l10n.notificationOrderDeliveredTitle,
          l10n.notificationOrderDeliveredBody(no), Icons.inventory_2_outlined);
    case 'ORDER_COLLECTED':
      return NotificationText(l10n.notificationOrderCollectedTitle,
          l10n.notificationOrderCollectedBody(no), Icons.shopping_bag_outlined);
    case 'ORDER_CANCELLED':
      return NotificationText(l10n.notificationOrderCancelledTitle,
          l10n.notificationOrderCancelledBody(no), Icons.cancel_outlined);
    case 'ORDER_PART_CANCELLED':
      return NotificationText(
          l10n.notificationOrderPartCancelledTitle,
          l10n.notificationOrderPartCancelledBody(no),
          Icons.remove_shopping_cart_outlined);
    case 'ORDER_ITEM_UNAVAILABLE':
      return NotificationText(
          l10n.notificationItemUnavailableTitle,
          l10n.notificationItemUnavailableBody(no),
          Icons.remove_shopping_cart_outlined);
    case 'ORDER_FAILED_DELIVERY':
      return NotificationText(
          l10n.notificationOrderFailedDeliveryTitle,
          l10n.notificationOrderFailedDeliveryBody(no),
          Icons.report_gmailerrorred_outlined);
    default:
      return NotificationText(
          n.title.isEmpty ? l10n.notificationsTitle : n.title,
          n.body,
          Icons.notifications_none_rounded);
  }
}
