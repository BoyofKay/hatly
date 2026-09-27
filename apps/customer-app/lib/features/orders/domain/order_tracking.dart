import 'order_details.dart';

class TrackingSegment {
  const TrackingSegment({
    required this.id,
    this.vendorName,
    required this.status,
    this.expectedReadyAt,
    this.preparationEstimateMinutes,
  });

  final String id;
  final String? vendorName;
  final String status;

  /// When this vendor expects to have the order ready — an operational estimate, never financial.
  final DateTime? expectedReadyAt;
  final int? preparationEstimateMinutes;

  factory TrackingSegment.fromJson(Map<String, dynamic> json) =>
      TrackingSegment(
        id: json['id'] as String,
        vendorName: json['vendorName'] as String?,
        status: json['status'] as String,
        expectedReadyAt: json['expectedReadyAt'] != null
            ? DateTime.tryParse(json['expectedReadyAt'] as String)
            : null,
        preparationEstimateMinutes:
            (json['preparationEstimateMinutes'] as num?)?.toInt(),
      );
}

/// `GET /orders/:id/tracking` — Tracking V1: what is happening now. No live map, no driver card, no location.
class OrderTracking {
  const OrderTracking({
    required this.orderId,
    required this.orderNumber,
    required this.status,
    required this.fulfillmentType,
    required this.eta,
    required this.timeline,
    required this.segments,
    required this.paymentMethod,
    this.electronicPaymentMethod,
    this.paymentStatus,
    required this.awaitingPaymentApproval,
    required this.customerCanCancel,
    this.cancellationReason,
  });

  final String orderId;

  /// The customer-facing reference (`HT-100234`) — show THIS, never [orderId].
  final String orderNumber;
  final String status;
  final String fulfillmentType;
  final OrderEta eta;
  final List<OrderTimelineEntry> timeline;
  final List<TrackingSegment> segments;
  final String paymentMethod;
  final String? electronicPaymentMethod;
  final String? paymentStatus;
  final bool awaitingPaymentApproval;
  final bool customerCanCancel;
  final String? cancellationReason;

  bool get isPickup => fulfillmentType == 'PICKUP';

  factory OrderTracking.fromJson(Map<String, dynamic> json) {
    final payment = (json['payment'] as Map<String, dynamic>?) ?? const {};
    return OrderTracking(
      orderId: json['orderId'] as String,
      orderNumber: json['orderNumber'] as String,
      status: json['status'] as String,
      fulfillmentType: (json['fulfillmentType'] as String?) ?? 'DELIVERY',
      eta: OrderEta.fromJson(json['eta'] as Map<String, dynamic>?),
      timeline: (json['timeline'] as List? ?? [])
          .map((e) => OrderTimelineEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      segments: (json['segments'] as List? ?? [])
          .map((e) => TrackingSegment.fromJson(e as Map<String, dynamic>))
          .toList(),
      paymentMethod: (payment['method'] as String?) ?? '',
      electronicPaymentMethod: payment['electronicMethod'] as String?,
      paymentStatus: payment['status'] as String?,
      awaitingPaymentApproval: payment['awaitingApproval'] as bool? ?? false,
      customerCanCancel: json['customerCanCancel'] as bool? ?? false,
      cancellationReason: json['cancellationReason'] as String?,
    );
  }
}
