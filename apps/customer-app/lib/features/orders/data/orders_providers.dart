import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'orders_api.dart';
import '../domain/order_summary.dart';
import '../domain/order_details.dart';
import '../domain/order_tracking.dart';
import '../domain/item_unavailability.dart';
import '../../notifications/data/notifications_providers.dart';

final ordersApiProvider =
    Provider<OrdersApi>((ref) => OrdersApi(ref.watch(apiClientProvider)));

/// CONFIRMED business decision (Order History, decision C): page +
/// limit only, no cursor pagination. This controller keeps the
/// currently-loaded pages flattened into one growing list (the usual
/// "infinite scroll" shape) — [loadMore] appends, [refresh] resets to
/// page 1, e.g. after a pull-to-refresh or a status filter change.
///
/// One controller per list tab (ongoing · completed · cancelled): the server owns which statuses each tab holds, so the app
/// never classifies an order itself.
class OrderHistoryController
    extends StateNotifier<AsyncValue<List<OrderSummary>>> {
  OrderHistoryController(this._api, this.tab)
      : super(const AsyncValue.loading()) {
    refresh();
  }

  final OrdersApi _api;
  final OrderListTab tab;
  static const _limit = 20;

  int _page = 1;
  bool _hasMore = true;
  bool _isLoadingMore = false;
  String? _statusFilter;

  bool get hasMore => _hasMore;
  String? get statusFilter => _statusFilter;

  Future<void> refresh({String? status}) async {
    _statusFilter = status;
    _page = 1;
    state = const AsyncValue.loading();
    try {
      final result = await _api.getOrders(
          page: _page, limit: _limit, status: _statusFilter, tab: tab);
      _hasMore = result.hasMore;
      state = AsyncValue.data(result.orders);
    } catch (error, stackTrace) {
      state = AsyncValue.error(error, stackTrace);
    }
  }

  /// Re-reads the first page WITHOUT a loading state (the list stays on screen) — bug 2026-11-23: a delivered order stayed in "Active"
  /// because the list was read once and kept. Called when the tab is shown, when the app comes back, and every 30 s on the Active tab.
  /// A failure keeps what is shown.
  Future<void> reload() async {
    if (state.isLoading) return;
    try {
      final result = await _api.getOrders(page: 1, limit: _limit, status: _statusFilter, tab: tab);
      _page = 1;
      _hasMore = result.hasMore;
      if (mounted) state = AsyncValue.data(result.orders);
    } catch (_) {
      // keep the current list
    }
  }

  /// Deliberately swallows a load-more failure — the already-loaded
  /// page stays visible; the user can simply scroll again or
  /// pull-to-refresh, rather than the whole list being replaced with
  /// an error state over a single page-2 hiccup.
  Future<void> loadMore() async {
    if (_isLoadingMore || !_hasMore) return;
    final current = state.valueOrNull;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final nextPage = _page + 1;
      final result = await _api.getOrders(
          page: nextPage, limit: _limit, status: _statusFilter, tab: tab);
      _page = nextPage;
      _hasMore = result.hasMore;
      state = AsyncValue.data([...current, ...result.orders]);
    } catch (_) {
      // See doc comment above.
    } finally {
      _isLoadingMore = false;
    }
  }
}

final orderHistoryControllerProvider = StateNotifierProvider.family<
    OrderHistoryController, AsyncValue<List<OrderSummary>>, OrderListTab>(
  (ref, tab) => OrderHistoryController(ref.watch(ordersApiProvider), tab),
);

/// Keyed by orderId so navigating between two different orders' detail
/// screens never shows stale data from the other — same `.family`
/// pattern as `vendorDetailsProvider`/`productDetailsProvider`. Auto-disposed:
/// an order's status changes while it is open elsewhere, so every visit reads it fresh.
final orderDetailsProvider =
    FutureProvider.autoDispose.family<OrderDetails, String>((ref, orderId) {
  return ref.watch(ordersApiProvider).getOrderDetails(orderId);
});

/// Tracking V1 (status · ETA · timeline · per-vendor progress). Auto-disposed for the same reason as the details.
final orderTrackingProvider =
    FutureProvider.autoDispose.family<OrderTracking, String>((ref, orderId) {
  return ref.watch(ordersApiProvider).getTracking(orderId);
});

/// Everything that shows an order must re-read after the set of orders or an order's state changed (an order was placed or
/// cancelled): the three list tabs, and any open details/tracking. Pass `ref.invalidate` (works for both `Ref` and
/// `WidgetRef`).
void invalidateOrderCaches(void Function(ProviderOrFamily) invalidate,
    {String? orderId}) {
  invalidate(orderHistoryControllerProvider);
  // Placing or cancelling an order is a notification event on the server: the bell must re-read.
  invalidate(unreadNotificationsCountProvider);
  if (orderId != null) {
    invalidate(orderDetailsProvider(orderId));
    invalidate(orderTrackingProvider(orderId));
  }
}

/// The open "an item is unavailable" question of an order (PD-016), or null. Never blocks the rest of Order Details: a failure simply shows nothing.
final itemUnavailabilityProvider = FutureProvider.autoDispose.family<ItemUnavailability?, String>((ref, orderId) async {
  try {
    return await ref.watch(ordersApiProvider).getItemUnavailability(orderId);
  } catch (_) {
    return null;
  }
});
