import '../../../core/network/api_client.dart';
import '../domain/customer_notification.dart';

/// Calls the real `customer/notifications` endpoints. The owner is the authenticated session — no customer id is ever sent.
class NotificationsApi {
  NotificationsApi(this._client);

  final ApiClient _client;

  Future<NotificationsPage> list({int page = 1, int limit = 20}) {
    return _client.request(
      (dio) => dio.get('/customer/notifications',
          queryParameters: {'page': page, 'limit': limit}),
      (data) => NotificationsPage.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<int> unreadCount() {
    return _client.request(
      (dio) => dio.get('/customer/notifications/unread-count'),
      (data) =>
          ((data['data'] as Map<String, dynamic>)['count'] as num).toInt(),
    );
  }

  Future<void> markRead(String id) {
    return _client.request(
      (dio) => dio.post('/customer/notifications/$id/read'),
      (_) {},
    );
  }

  Future<void> markAllRead() {
    return _client.request(
      (dio) => dio.post('/customer/notifications/read-all'),
      (_) {},
    );
  }
}
