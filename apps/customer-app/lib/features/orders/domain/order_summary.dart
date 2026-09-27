import 'order_details.dart';

/// The three tabs of the orders list — the server owns which statuses belong to each.
enum OrderListTab {
  active,
  completed,
  cancelled;

  String get apiValue => name;
}

/// Mirrors `CustomerOrderSummaryView` / the `GET /orders` response
/// shape on the backend field-for-field (see customer-orders.service.ts).
class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.orderNumber,
    required this.createdAt,
    required this.status,
    required this.totalMinor,
    required this.paymentMethod,
    required this.vendorBranchNames,
    this.electronicPaymentMethod,
    this.awaitingPaymentApproval = false,
    this.fulfillmentType = 'DELIVERY',
    this.itemImageUrls = const [],
    this.itemCount = 0,
    this.eta = const OrderEta(state: 'UNAVAILABLE'),
  });

  final String id;

  /// The customer-facing reference (`HT-100234`) — show THIS, never [id].
  final String orderNumber;
  final DateTime createdAt;
  final String status;
  final int? totalMinor;
  final String paymentMethod;
  final String? electronicPaymentMethod;

  /// A manual transfer the team has not approved yet: "order created" is not "payment confirmed".
  final bool awaitingPaymentApproval;
  final String fulfillmentType;

  /// Up to three product images from the order's own snapshots.
  final List<String> itemImageUrls;
  final int itemCount;
  final OrderEta eta;

  /// Raw vendor/branch names, in segment order — presentation
  /// (e.g. "Pizza House + 2 others") is deliberately built in the UI
  /// layer, not here, per the approved decision that exact wording
  /// follows Flutter's own localization conventions.
  final List<String> vendorBranchNames;

  factory OrderSummary.fromJson(Map<String, dynamic> json) {
    return OrderSummary(
      id: json['id'] as String,
      orderNumber: json['orderNumber'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      status: json['status'] as String,
      totalMinor: (json['totalMinor'] as num?)?.toInt(),
      paymentMethod: json['paymentMethod'] as String,
      vendorBranchNames:
          (json['vendorBranchNames'] as List).map((e) => e as String).toList(),
      electronicPaymentMethod: json['electronicPaymentMethod'] as String?,
      awaitingPaymentApproval:
          json['awaitingPaymentApproval'] as bool? ?? false,
      fulfillmentType: (json['fulfillmentType'] as String?) ?? 'DELIVERY',
      itemImageUrls: (json['itemImageUrls'] as List? ?? [])
          .map((e) => e as String)
          .toList(),
      itemCount: (json['itemCount'] as num?)?.toInt() ?? 0,
      eta: OrderEta.fromJson(json['eta'] as Map<String, dynamic>?),
    );
  }
}

/// Mirrors the `{ data: [...], meta: { page, limit, total } }` envelope
/// returned by `GET /orders` exactly — see OrdersController.list().
class OrderHistoryPage {
  const OrderHistoryPage({
    required this.orders,
    required this.page,
    required this.limit,
    required this.total,
  });

  final List<OrderSummary> orders;
  final int page;
  final int limit;
  final int total;

  bool get hasMore => page * limit < total;

  factory OrderHistoryPage.fromJson(Map<String, dynamic> json) {
    final meta = json['meta'] as Map<String, dynamic>;
    return OrderHistoryPage(
      orders: (json['data'] as List)
          .map((e) => OrderSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      page: meta['page'] as int,
      limit: meta['limit'] as int,
      total: meta['total'] as int,
    );
  }
}
