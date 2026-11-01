import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../domain/order_summary.dart';
import '../domain/order_details.dart';
import '../domain/order_tracking.dart';
import '../domain/item_unavailability.dart';
import '../../checkout/data/checkout_api.dart';

/// Calls the real `/orders` endpoints implemented in this same phase
/// (orders.controller.ts / customer-orders.service.ts) — every method
/// here corresponds to exactly one backend route. Ownership is always
/// determined by the authenticated session's token (attached
/// automatically by [ApiClient]) — this class never sends a customer
/// id anywhere.
class OrdersApi {
  OrdersApi(this._client);

  final ApiClient _client;

  Future<OrderHistoryPage> getOrders(
      {int page = 1, int limit = 20, String? status, OrderListTab? tab}) {
    return _client.request(
      (dio) => dio.get(
        '/orders',
        queryParameters: {
          'page': page,
          'limit': limit,
          if (status != null) 'status': status,
          if (tab != null) 'tab': tab.apiValue,
        },
      ),
      (data) => OrderHistoryPage.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<OrderDetails> getOrderDetails(String orderId) {
    return _client.request(
      (dio) => dio.get('/orders/$orderId'),
      (data) => OrderDetails.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// `GET /orders/:id/item-unavailability` — the open question about unavailable items, or null when there is none (an older server answers 404).
  Future<ItemUnavailability?> getItemUnavailability(String orderId) async {
    try {
      return await _client.request(
        (dio) => dio.get('/orders/$orderId/item-unavailability'),
        (data) {
          final raw = data['data'];
          return raw is Map<String, dynamic> ? ItemUnavailability.fromJson(raw) : null;
        },
      );
    } on ApiException catch (e) {
      if (e.statusCode == 404) return null;
      rethrow;
    }
  }

  /// The customer's one answer: `CONTINUE_WITHOUT` or `CANCEL_ORDER`. The server records it; a cancel request is carried out by Hatly staff.
  Future<void> respondToItemUnavailability(String orderId, String exceptionId, String decision) {
    return _client.request<void>(
      (dio) => dio.post('/orders/$orderId/item-unavailability/$exceptionId/respond', data: {'decision': decision}),
      (data) {},
    );
  }

  Future<OrderTracking> getTracking(String orderId) {
    return _client.request(
      (dio) => dio.get('/orders/$orderId/tracking'),
      (data) => OrderTracking.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Customer cancellation of the WHOLE order (never a single vendor segment). The server decides whether it is still
  /// allowed; the app only offers the action when `customerCanCancel` is true. Returns the refreshed order.
  Future<OrderDetails> cancelOrder(String orderId, {String? reason}) {
    return _client.request(
      (dio) => dio.post('/orders/$orderId/cancel', data: {
        if (reason != null && reason.isNotEmpty) 'cancellationReason': reason
      }),
      (data) => OrderDetails.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// `POST /orders` — atomic order creation from the customer's active cart. The address, fee, discounts and payment split
  /// are all decided server-side (the request carries the customer's CHOICES and the confirmed quote token, never an
  /// amount). A stale quote is refused with `QUOTE_STALE` and the current quote.
  ///
  /// Deliberately returns only `id`/`totalMinor`/`paymentMethod`: the response is the raw `Order` entity, a narrower shape
  /// than [OrderDetails]; callers needing the full view call [getOrderDetails].
  Future<CreatedOrderResult> createOrder(CheckoutRequest request) {
    return _client.request(
      (dio) => dio.post('/orders', data: request.toJson(includeToken: true)),
      (data) {
        final order = data['data'] as Map<String, dynamic>;
        return CreatedOrderResult(
          id: order['id'] as String,
          orderNumber: order['orderNumber'] as String,
          totalMinor: (order['totalMinor'] as num?)?.toInt(),
          paymentMethod: order['paymentMethod'] as String,
          electronicPaymentMethod: order['electronicPaymentMethod'] as String?,
          walletAmountMinor: (order['walletAmountMinor'] as num?)?.toInt() ?? 0,
          amountDueMinor: (order['amountDueMinor'] as num?)?.toInt(),
        );
      },
    );
  }
}

/// The minimal, AUTHORITATIVE result of order creation — `totalMinor`
/// here is computed entirely server-side (never a client-supplied
/// amount), the exact value the payable-amount instructions/WhatsApp
/// message must use.
class CreatedOrderResult {
  const CreatedOrderResult({
    required this.id,
    required this.orderNumber,
    required this.totalMinor,
    required this.paymentMethod,
    this.electronicPaymentMethod,
    this.walletAmountMinor = 0,
    this.amountDueMinor,
  });

  final String id;

  /// The customer-facing reference (`HT-100234`) — show THIS, never [id].
  final String orderNumber;
  final int? totalMinor;
  final String paymentMethod;
  final String? electronicPaymentMethod;
  final int walletAmountMinor;
  final int? amountDueMinor;
}
