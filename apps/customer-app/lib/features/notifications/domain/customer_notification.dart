/// One in-app notification about one of the customer's orders (`GET /customer/notifications`). The server only sends facts
/// (`type`, order reference, state); the wording shown is rendered by the app from `type` (see notification_text.dart) —
/// [title]/[body] are the server's English fallback for a type this app version does not know yet.
class CustomerNotification {
  const CustomerNotification({
    required this.id,
    required this.type,
    required this.orderId,
    required this.orderNumber,
    required this.title,
    required this.body,
    required this.isRead,
    required this.createdAt,
  });

  final String id;
  final String type;
  final String orderId;
  final String orderNumber;
  final String title;
  final String body;
  final bool isRead;
  final DateTime createdAt;

  CustomerNotification asRead() => CustomerNotification(
        id: id,
        type: type,
        orderId: orderId,
        orderNumber: orderNumber,
        title: title,
        body: body,
        isRead: true,
        createdAt: createdAt,
      );

  factory CustomerNotification.fromJson(Map<String, dynamic> json) {
    return CustomerNotification(
      id: json['id'] as String,
      type: json['type'] as String,
      orderId: json['orderId'] as String,
      orderNumber: json['orderNumber'] as String,
      title: (json['title'] as String?) ?? '',
      body: (json['body'] as String?) ?? '',
      isRead: json['isRead'] as bool? ?? false,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}

class NotificationsPage {
  const NotificationsPage({
    required this.items,
    required this.page,
    required this.total,
    required this.unreadCount,
    required this.limit,
  });

  final List<CustomerNotification> items;
  final int page;
  final int limit;
  final int total;
  final int unreadCount;

  factory NotificationsPage.fromJson(Map<String, dynamic> json) {
    final meta = (json['meta'] as Map<String, dynamic>?) ?? const {};
    return NotificationsPage(
      items: [
        for (final e in (json['data'] as List? ?? const []))
          CustomerNotification.fromJson(e as Map<String, dynamic>),
      ],
      page: (meta['page'] as num?)?.toInt() ?? 1,
      limit: (meta['limit'] as num?)?.toInt() ?? 20,
      total: (meta['total'] as num?)?.toInt() ?? 0,
      unreadCount: (meta['unreadCount'] as num?)?.toInt() ?? 0,
    );
  }
}
