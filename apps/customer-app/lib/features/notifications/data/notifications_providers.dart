import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../../auth/presentation/auth_gate.dart';
import '../domain/customer_notification.dart';
import 'notifications_api.dart';

final notificationsApiProvider = Provider<NotificationsApi>(
    (ref) => NotificationsApi(ref.watch(apiClientProvider)));

/// The unread count behind the bell. A guest has no notifications and never triggers an authenticated request. A failed read
/// shows no badge (never a stale or invented number).
///
/// There is no push-driven badge (push is a separate channel), so the count is re-read when: the bell first appears, the app
/// returns to the foreground, the customer comes back from the list, an order is placed or cancelled, and Home is pulled to
/// refresh. No background polling.
final unreadNotificationsCountProvider =
    FutureProvider.autoDispose<int>((ref) async {
  if (!ref.watch(isSignedInProvider)) return 0;
  try {
    return await ref.watch(notificationsApiProvider).unreadCount();
  } catch (_) {
    return 0;
  }
});

/// The notification list: pages are appended ([loadMore]) and [refresh] starts over. The unread count is the SERVER's
/// (`meta.unreadCount`), never derived from the loaded pages.
class NotificationsController
    extends StateNotifier<AsyncValue<List<CustomerNotification>>> {
  NotificationsController(this._api, this._onChanged)
      : super(const AsyncValue.loading()) {
    refresh();
  }

  final NotificationsApi _api;
  final void Function() _onChanged;
  static const _limit = 20;

  int _page = 1;
  bool _hasMore = false;
  bool _loadingMore = false;
  int _unread = 0;

  bool get hasMore => _hasMore;
  int get unreadCount => _unread;

  Future<void> refresh() async {
    _page = 1;
    state = const AsyncValue.loading();
    try {
      final result = await _api.list(page: 1, limit: _limit);
      _hasMore = result.items.length < result.total;
      _unread = result.unreadCount;
      if (!mounted) return;
      state = AsyncValue.data(result.items);
      _onChanged();
    } catch (error, stackTrace) {
      if (!mounted) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }

  /// A failed load-more keeps what is already shown; the customer can scroll again.
  Future<void> loadMore() async {
    final current = state.valueOrNull;
    if (_loadingMore || !_hasMore || current == null) return;
    _loadingMore = true;
    try {
      final result = await _api.list(page: _page + 1, limit: _limit);
      if (!mounted) return;
      _page += 1;
      final known = {for (final n in current) n.id};
      final merged = [
        ...current,
        ...result.items.where((n) => !known.contains(n.id)),
      ];
      _hasMore = merged.length < result.total && result.items.isNotEmpty;
      _unread = result.unreadCount;
      state = AsyncValue.data(merged);
    } catch (_) {
      // keep the loaded pages
    } finally {
      _loadingMore = false;
    }
  }

  /// Marks one read. The row flips at once (the server is the source of truth and is told in the background; a failure puts
  /// the row back, so the screen never claims something the server did not do).
  Future<void> markRead(CustomerNotification notification) async {
    if (notification.isRead) return;
    final before = state.valueOrNull;
    if (before == null) return;
    state = AsyncValue.data([
      for (final n in before) n.id == notification.id ? n.asRead() : n,
    ]);
    _unread = _unread > 0 ? _unread - 1 : 0;
    _onChanged();
    try {
      await _api.markRead(notification.id);
    } catch (_) {
      if (!mounted) return;
      state = AsyncValue.data(before);
      _unread += 1;
      _onChanged();
    } finally {
      if (mounted) _onChanged();
    }
  }

  Future<void> markAllRead() async {
    final before = state.valueOrNull;
    if (before == null || before.every((n) => n.isRead) && _unread == 0) return;
    final previousUnread = _unread;
    state = AsyncValue.data([for (final n in before) n.asRead()]);
    _unread = 0;
    _onChanged();
    try {
      await _api.markAllRead();
    } catch (_) {
      if (!mounted) return;
      state = AsyncValue.data(before);
      _unread = previousUnread;
    } finally {
      if (mounted) _onChanged();
    }
  }
}

final notificationsControllerProvider = StateNotifierProvider.autoDispose<
    NotificationsController, AsyncValue<List<CustomerNotification>>>((ref) {
  return NotificationsController(ref.watch(notificationsApiProvider),
      () => ref.invalidate(unreadNotificationsCountProvider));
});
