import 'package:hatly_customer/features/notifications/data/notifications_api.dart';
import 'package:hatly_customer/features/notifications/domain/customer_notification.dart';

Map<String, dynamic> notificationJson({
  String id = 'n1',
  String type = 'ORDER_CONFIRMED',
  String orderId = 'order-1',
  String orderNumber = 'HT-100501',
  bool isRead = false,
  String createdAt = '2026-10-14T10:00:00.000Z',
}) =>
    {
      'id': id,
      'type': type,
      'orderId': orderId,
      'orderNumber': orderNumber,
      'title': 'server title',
      'body': 'server body',
      'isRead': isRead,
      'readAt': isRead ? createdAt : null,
      'createdAt': createdAt,
    };

/// A scriptable backend for the notifications endpoints; every call is recorded.
class FakeNotificationsApi implements NotificationsApi {
  FakeNotificationsApi({List<Map<String, dynamic>>? items})
      : items = items ?? [];

  /// The server-side rows, newest first.
  List<Map<String, dynamic>> items;
  final calls = <String>[];
  Object? listError;
  Object? markReadError;
  Object? markAllError;
  Object? countError;
  int? countOverride;

  int get unread => items.where((e) => e['isRead'] != true).length;

  @override
  Future<NotificationsPage> list({int page = 1, int limit = 20}) async {
    calls.add('list:$page:$limit');
    if (listError != null) throw listError!;
    final start = (page - 1) * limit;
    final slice = items.skip(start).take(limit).toList();
    return NotificationsPage.fromJson({
      'data': slice,
      'meta': {
        'page': page,
        'limit': limit,
        'total': items.length,
        'unreadCount': unread,
      },
    });
  }

  @override
  Future<int> unreadCount() async {
    calls.add('count');
    if (countError != null) throw countError!;
    return countOverride ?? unread;
  }

  @override
  Future<void> markRead(String id) async {
    calls.add('read:$id');
    if (markReadError != null) throw markReadError!;
    for (final e in items) {
      if (e['id'] == id) e['isRead'] = true;
    }
  }

  @override
  Future<void> markAllRead() async {
    calls.add('read-all');
    if (markAllError != null) throw markAllError!;
    for (final e in items) {
      e['isRead'] = true;
    }
  }
}
