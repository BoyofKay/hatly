/// Mirrors `CustomerOrderDetailsView` / the `GET /orders/:id` response
/// shape on the backend field-for-field (see customer-orders.service.ts).
/// Every historical field here reads from the backend's own frozen
/// snapshot columns (productNameSnapshot, unitPriceMinor, etc.) — this
/// model never re-derives anything from a live catalog lookup, since
/// the backend itself never does either.
library;

import 'item_unavailability.dart';
import '../../hatly_service/domain/route_endpoint.dart';
import '../../checkout/domain/checkout_quote.dart';

/// Operational ETA (never financial). [state]: `ESTIMATED` · `UNAVAILABLE` (see [reason]) · `COMPLETED` · `CANCELLED`.
/// When estimated, the customer-facing range is [estimatedAt]..[estimatedUntil]; [delayed] means it is already past while
/// the order is still open.
class OrderEta {
  const OrderEta({
    required this.state,
    this.reason,
    this.estimatedAt,
    this.estimatedUntil,
    this.delayed = false,
  });

  final String state;
  final String? reason;
  final DateTime? estimatedAt;
  final DateTime? estimatedUntil;
  final bool delayed;

  bool get isEstimated => state == 'ESTIMATED' && estimatedAt != null;

  factory OrderEta.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const OrderEta(state: 'UNAVAILABLE');
    return OrderEta(
      state: (json['state'] as String?) ?? 'UNAVAILABLE',
      reason: json['reason'] as String?,
      estimatedAt: json['estimatedAt'] != null
          ? DateTime.tryParse(json['estimatedAt'] as String)
          : null,
      estimatedUntil: json['estimatedUntil'] != null
          ? DateTime.tryParse(json['estimatedUntil'] as String)
          : null,
      delayed: json['delayed'] as bool? ?? false,
    );
  }
}

/// One entry of the order's status history (the timeline source).
class OrderTimelineEntry {
  const OrderTimelineEntry(
      {required this.status, required this.at, this.actorRole});

  final String status;
  final DateTime at;
  final String? actorRole;

  factory OrderTimelineEntry.fromJson(Map<String, dynamic> json) =>
      OrderTimelineEntry(
        status: json['status'] as String,
        at: DateTime.parse(json['at'] as String),
        actorRole: json['actorRole'] as String?,
      );
}

class OrderCouponDetails {
  const OrderCouponDetails(
      {required this.code,
      required this.offerName,
      required this.discountMinor});

  final String code;
  final String offerName;
  final int discountMinor;

  factory OrderCouponDetails.fromJson(Map<String, dynamic> json) =>
      OrderCouponDetails(
        code: json['code'] as String,
        offerName: (json['offerName'] as String?) ?? json['code'] as String,
        discountMinor: (json['discountMinor'] as num).toInt(),
      );
}

/// The delivery fee as frozen when the order was placed.
class OrderDeliveryBreakdown {
  const OrderDeliveryBreakdown({
    required this.baseFeeMinor,
    required this.additionalVendorFeeMinor,
    required this.additionalVendorChargeMinor,
    required this.vendorCount,
    this.distanceMeters,
    this.pricingSource = 'DISTANCE',
    required this.frozenTotalFeeMinor,
  });

  final int baseFeeMinor;
  final int additionalVendorFeeMinor;
  final int additionalVendorChargeMinor;
  final int vendorCount;

  /// Null when the fee came from the address's Delivery Zone — no distance was part of the price (PD-009).
  final int? distanceMeters;

  /// `DISTANCE` · `DELIVERY_ZONE` (orders placed before zones are DISTANCE).
  final String pricingSource;
  final int frozenTotalFeeMinor;

  factory OrderDeliveryBreakdown.fromJson(Map<String, dynamic> json) =>
      OrderDeliveryBreakdown(
        baseFeeMinor: (json['baseFeeMinor'] as num).toInt(),
        additionalVendorFeeMinor:
            (json['additionalVendorFeeMinor'] as num).toInt(),
        additionalVendorChargeMinor:
            (json['additionalVendorChargeMinor'] as num).toInt(),
        vendorCount: (json['vendorCount'] as num).toInt(),
        distanceMeters: (json['distanceMeters'] as num?)?.toInt(),
        pricingSource: json['pricingSource'] as String? ?? 'DISTANCE',
        frozenTotalFeeMinor: (json['frozenTotalFeeMinor'] as num).toInt(),
      );
}

class OrderOptionSnapshot {
  const OrderOptionSnapshot(
      {required this.name,
      required this.valueName,
      required this.priceDeltaMinor});

  final String name;
  final String valueName;
  final int priceDeltaMinor;

  factory OrderOptionSnapshot.fromJson(Map<String, dynamic> json) {
    return OrderOptionSnapshot(
      name: json['name'] as String,
      valueName: json['valueName'] as String,
      priceDeltaMinor: json['priceDeltaMinor'] as int,
    );
  }
}

class OrderItemDetails {
  const OrderItemDetails({
    required this.id,
    this.productId,
    this.productNameSnapshot,
    this.productImageUrlSnapshot,
    required this.quantity,
    this.unitPriceMinor,
    required this.optionsSnapshot,
    this.notes,
    this.pricingUnitSnapshot,
    this.requestedWeightGrams,
    this.actualWeightGrams,
    this.estimatedAmountMinor,
    this.finalAmountMinor,
    this.freeTextDescriptionSnapshot,
    this.imageUrlsSnapshot,
    this.voiceNoteUrlSnapshot,
    this.offerMechanismSnapshot,
    this.offerSpecialPriceMinorSnapshot,
    this.actualAmountMinor,
    this.priceStatus,
  });

  final String id;
  final String? productId;
  final String? productNameSnapshot;

  /// The historical image snapshot (Weighted Products / Order History
  /// decision B) — never the live `Product.imageUrl`.
  final String? productImageUrlSnapshot;

  final int quantity;
  final int? unitPriceMinor;
  final List<OrderOptionSnapshot> optionsSnapshot;
  final String? notes;

  /// Null for a PIECE item and for an AD_HOC_SERVICE item — 'WEIGHT'
  /// only for a Weighted Products item.
  final String? pricingUnitSnapshot;
  final int? requestedWeightGrams;
  final int? actualWeightGrams;
  final int? estimatedAmountMinor;
  final int? finalAmountMinor;
  final String? freeTextDescriptionSnapshot;
  final List<String>? imageUrlsSnapshot;

  /// The custom request's voice note, frozen on the order (null = none).
  final String? voiceNoteUrlSnapshot;

  /// Customer Offers Integration. Historical FLASH_SALE snapshot —
  /// CONFIRMED read directly from the backend's frozen OrderItem
  /// columns, never re-derived from the current (possibly since-
  /// changed) Offer row. Null when no Flash Sale applied to this item.
  final String? offerMechanismSnapshot;
  final int? offerSpecialPriceMinorSnapshot;

  /// Vendor/Driver Deferred Pricing (Chunk 6 wiring). The real final
  /// operational amount for a product-less Custom Request, recorded
  /// by a Vendor or Driver after checkout — CONFIRMED read directly
  /// from the backend's existing `OrderItem.actualAmountMinor`
  /// exposure, never derived from `unitPriceMinor`/`Order.totalMinor`/
  /// anything else. Null until (and unless) a final price has been
  /// recorded. Only ever meaningful when `productId == null` — the
  /// backend never sets this for a normal catalog item.
  final int? actualAmountMinor;

  /// Explicit price state of a custom / Hatly Service item: `PENDING` (no final price recorded yet) or `CONFIRMED`; null for a normal
  /// catalog item. Older responses without the field fall back to the previous rule (product-less + no recorded amount = pending).
  final String? priceStatus;

  bool get isPricePending =>
      priceStatus == 'PENDING' ||
      (priceStatus == null && productId == null && actualAmountMinor == null);

  bool get hadFlashSale => offerMechanismSnapshot == 'FLASH_SALE';

  bool get isWeighted => pricingUnitSnapshot == 'WEIGHT';

  /// The amount this line actually reflects — for a WEIGHT item, the
  /// FINAL (actual-weight) amount once recorded, falling back to the
  /// estimate before that; for a PIECE item, the ordinary
  /// unit price x quantity. Mirrors the backend's own
  /// OrderItem.finalAmountMinor/estimatedAmountMinor precedence.
  int? get displayAmountMinor {
    if (isWeighted) return finalAmountMinor ?? estimatedAmountMinor;
    if (unitPriceMinor == null) return null;
    return unitPriceMinor! * quantity;
  }

  factory OrderItemDetails.fromJson(Map<String, dynamic> json) {
    return OrderItemDetails(
      id: json['id'] as String,
      productId: json['productId'] as String?,
      productNameSnapshot: json['productNameSnapshot'] as String?,
      productImageUrlSnapshot: json['productImageUrlSnapshot'] as String?,
      quantity: json['quantity'] as int,
      unitPriceMinor: json['unitPriceMinor'] as int?,
      optionsSnapshot: (json['optionsSnapshot'] as List? ?? [])
          .map((e) => OrderOptionSnapshot.fromJson(e as Map<String, dynamic>))
          .toList(),
      notes: json['notes'] as String?,
      pricingUnitSnapshot: json['pricingUnitSnapshot'] as String?,
      requestedWeightGrams: json['requestedWeightGrams'] as int?,
      actualWeightGrams: json['actualWeightGrams'] as int?,
      estimatedAmountMinor: json['estimatedAmountMinor'] as int?,
      finalAmountMinor: json['finalAmountMinor'] as int?,
      freeTextDescriptionSnapshot:
          json['freeTextDescriptionSnapshot'] as String?,
      voiceNoteUrlSnapshot: json['voiceNoteUrlSnapshot'] as String?,
      imageUrlsSnapshot: (json['imageUrlsSnapshot'] as List?)
          ?.map((e) => e as String)
          .toList(),
      offerMechanismSnapshot: json['offerMechanismSnapshot'] as String?,
      offerSpecialPriceMinorSnapshot:
          json['offerSpecialPriceMinorSnapshot'] as int?,
      actualAmountMinor: json['actualAmountMinor'] as int?,
      priceStatus: json['priceStatus'] as String?,
    );
  }
}

/// What has been given back on the order, assembled by the server from the real ledgers. A bank/wallet-transfer refund is only
/// reported as sent once Hatly operations marked it sent — the app never claims money moved earlier than the server does.
class OrderRefundSummary {
  const OrderRefundSummary({
    this.walletRefundedMinor = 0,
    this.transferRefundRecordedMinor = 0,
    this.transferRefundSentMinor = 0,
    this.pendingRefundMinor = 0,
    this.totalRefundMinor = 0,
  });

  final int walletRefundedMinor;
  final int transferRefundRecordedMinor;
  final int transferRefundSentMinor;
  final int pendingRefundMinor;
  final int totalRefundMinor;

  /// Recorded but not yet sent back to the customer.
  int get transferRefundAwaitingMinor =>
      transferRefundRecordedMinor - transferRefundSentMinor;

  bool get isEmpty => totalRefundMinor == 0 && pendingRefundMinor == 0;

  static OrderRefundSummary fromJson(Map<String, dynamic>? json) {
    if (json == null) return const OrderRefundSummary();
    int n(String key) => (json[key] as num?)?.toInt() ?? 0;
    return OrderRefundSummary(
      walletRefundedMinor: n('walletRefundedMinor'),
      transferRefundRecordedMinor: n('transferRefundRecordedMinor'),
      transferRefundSentMinor: n('transferRefundSentMinor'),
      pendingRefundMinor: n('pendingRefundMinor'),
      totalRefundMinor: n('totalRefundMinor'),
    );
  }
}

/// Some — not all — vendor parts of a multi-vendor order were rejected; the rest of the order continues.
class OrderPartialRejection {
  const OrderPartialRejection(
      {required this.rejectedSegmentCount, required this.activeSegmentCount});

  final int rejectedSegmentCount;
  final int activeSegmentCount;

  int get totalSegmentCount => rejectedSegmentCount + activeSegmentCount;

  static OrderPartialRejection? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final rejected = (json['rejectedSegmentCount'] as num?)?.toInt() ?? 0;
    final active = (json['activeSegmentCount'] as num?)?.toInt() ?? 0;
    if (rejected <= 0) return null;
    return OrderPartialRejection(
        rejectedSegmentCount: rejected, activeSegmentCount: active);
  }
}

class OrderSegmentDetails {
  const OrderSegmentDetails({
    required this.id,
    required this.groupType,
    this.vendorBranchId,
    this.vendorBranchName,
    required this.status,
    this.subtotalMinor,
    required this.items,
    this.offerDiscountTypeSnapshot,
    this.offerDiscountValueSnapshot,
    this.offerEligibleSubtotalMinorSnapshot,
    this.offerDiscountAmountMinor,
    this.branchAddress,
    this.couponCodeSnapshot,
    this.expectedReadyAt,
    this.preparationEstimateMinutes,
    this.adHocPlaceNameSnapshot,
    this.adHocServiceTypeSnapshot,
    this.adHocPickupLatitudeSnapshot,
    this.adHocPickupLongitudeSnapshot,
    this.adHocDestinationLatitudeSnapshot,
    this.adHocDestinationLongitudeSnapshot,
    this.rejectionReason,
    this.removedItems = const [],
  });

  final String id;
  final String groupType;
  final String? vendorBranchId;
  final String? vendorBranchName;
  final String status;
  final int? subtotalMinor;
  final List<OrderItemDetails> items;

  /// Items taken off this part because they were unavailable (PD-016); an older server never sends this.
  final List<RemovedOrderItem> removedItems;

  /// Why this vendor part was rejected (the vendor's or Hatly's reason); null unless the part is CANCELLED with a recorded reason.
  final String? rejectionReason;

  bool get isRejected => status == 'CANCELLED';

  /// Standalone Hatly Service (AD_HOC_SERVICE) snapshot fields — frozen
  /// on `OrderVendorSegment` at order-creation time exactly like every
  /// other `...Snapshot` field on this class, never re-derived from a
  /// live (possibly since-deleted) cart group. Null on a CATALOG
  /// segment. See `customer-orders.service.ts` on the backend.
  final String? adHocPlaceNameSnapshot;
  final String? adHocServiceTypeSnapshot;
  final double? adHocPickupLatitudeSnapshot;
  final double? adHocPickupLongitudeSnapshot;
  final double? adHocDestinationLatitudeSnapshot;
  final double? adHocDestinationLongitudeSnapshot;

  bool get isAdHocService => groupType == 'AD_HOC_SERVICE';

  /// "وصّلي لمكان" (Wasally): no product, the delivery fee is the whole charge.
  bool get isDeliveryOnly =>
      isAdHocService && adHocServiceTypeSnapshot == 'DELIVER_TO_PLACE';

  /// Customer Offers Integration. Historical SUBTOTAL_DISCOUNT
  /// snapshot — read directly from the backend's frozen
  /// OrderVendorSegment columns. Null when no Subtotal Discount
  /// applied to this segment.
  final String? offerDiscountTypeSnapshot;
  final int? offerDiscountValueSnapshot;
  final int? offerEligibleSubtotalMinorSnapshot;
  final int? offerDiscountAmountMinor;
  final String? branchAddress;
  final String? couponCodeSnapshot;

  /// Operational — may change; never affects any amount.
  final DateTime? expectedReadyAt;
  final int? preparationEstimateMinutes;

  bool get hadSubtotalDiscount =>
      offerDiscountAmountMinor != null && offerDiscountAmountMinor! > 0;

  factory OrderSegmentDetails.fromJson(Map<String, dynamic> json) {
    return OrderSegmentDetails(
      id: json['id'] as String,
      groupType: json['groupType'] as String,
      vendorBranchId: json['vendorBranchId'] as String?,
      vendorBranchName: json['vendorBranchName'] as String?,
      status: json['status'] as String,
      subtotalMinor: json['subtotalMinor'] as int?,
      items: (json['items'] as List)
          .map((e) => OrderItemDetails.fromJson(e as Map<String, dynamic>))
          .toList(),
      removedItems: ((json['removedItems'] as List?) ?? const [])
          .map((e) => RemovedOrderItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      offerDiscountTypeSnapshot: json['offerDiscountTypeSnapshot'] as String?,
      offerDiscountValueSnapshot: json['offerDiscountValueSnapshot'] as int?,
      offerEligibleSubtotalMinorSnapshot:
          json['offerEligibleSubtotalMinorSnapshot'] as int?,
      offerDiscountAmountMinor: json['offerDiscountAmountMinor'] as int?,
      branchAddress: json['branchAddress'] as String?,
      couponCodeSnapshot: json['couponCodeSnapshot'] as String?,
      expectedReadyAt: json['expectedReadyAt'] != null
          ? DateTime.tryParse(json['expectedReadyAt'] as String)
          : null,
      preparationEstimateMinutes:
          (json['preparationEstimateMinutes'] as num?)?.toInt(),
      adHocPlaceNameSnapshot: json['adHocPlaceNameSnapshot'] as String?,
      adHocServiceTypeSnapshot: json['adHocServiceTypeSnapshot'] as String?,
      adHocPickupLatitudeSnapshot:
          (json['adHocPickupLatitudeSnapshot'] as num?)?.toDouble(),
      adHocPickupLongitudeSnapshot:
          (json['adHocPickupLongitudeSnapshot'] as num?)?.toDouble(),
      adHocDestinationLatitudeSnapshot:
          (json['adHocDestinationLatitudeSnapshot'] as num?)?.toDouble(),
      adHocDestinationLongitudeSnapshot:
          (json['adHocDestinationLongitudeSnapshot'] as num?)?.toDouble(),
      rejectionReason: json['rejectionReason'] as String?,
    );
  }
}

class OrderPaymentDetails {
  const OrderPaymentDetails({
    required this.method,
    this.status,
    this.amountMinor,
    this.electronicMethod,
    this.walletAmountMinor = 0,
    this.amountDueMinor,
    this.awaitingApproval = false,
  });

  final String method;

  /// Transfer state (`PENDING` · `CUSTOMER_CLAIMED_TRANSFER` · `UNDER_REVIEW` · `PAID` · `REJECTED`); `DUE_ON_DELIVERY` for
  /// cash / pay-at-delivery; `PAID` for a wallet-paid order.
  final String? status;
  final int? amountMinor;
  final String? electronicMethod;
  final int walletAmountMinor;
  final int? amountDueMinor;

  /// A manual transfer the team has not approved yet — the order exists, the payment is not confirmed.
  final bool awaitingApproval;

  factory OrderPaymentDetails.fromJson(Map<String, dynamic> json) {
    return OrderPaymentDetails(
      method: json['method'] as String,
      status: json['status'] as String?,
      amountMinor: (json['amountMinor'] as num?)?.toInt(),
      electronicMethod: json['electronicMethod'] as String?,
      walletAmountMinor: (json['walletAmountMinor'] as num?)?.toInt() ?? 0,
      amountDueMinor: (json['amountDueMinor'] as num?)?.toInt(),
      awaitingApproval: json['awaitingApproval'] as bool? ?? false,
    );
  }
}

/// Name + phone only — deliberately nothing else (no live location; a
/// separate, unimplemented feature — see the backend's own comment).
class OrderDriverDetails {
  const OrderDriverDetails({required this.name, required this.phone});

  final String name;
  final String phone;

  factory OrderDriverDetails.fromJson(Map<String, dynamic> json) {
    return OrderDriverDetails(
        name: json['name'] as String, phone: json['phone'] as String);
  }
}

class OrderDetails {
  const OrderDetails({
    required this.id,
    required this.orderNumber,
    required this.createdAt,
    required this.status,
    required this.fulfillmentType,
    this.subtotalMinor,
    this.deliveryFeeMinor,
    this.discountMinor,
    this.totalMinor,
    this.hasPendingPricing = false,
    required this.paymentMethod,
    this.payment,
    this.cancellationReason,
    this.cancelledByRole,
    this.failureReason,
    this.failedAt,
    required this.segments,
    this.driver,
    this.deliveryAddress,
    this.electronicPaymentMethod,
    this.walletAmountMinor = 0,
    this.amountDueMinor,
    this.coupon,
    this.deliveryBreakdown,
    this.deliveryRoute,
    this.eta = const OrderEta(state: 'UNAVAILABLE'),
    this.timeline = const [],
    this.customerCanCancel = false,
    this.refundSummary = const OrderRefundSummary(),
    this.partialRejection,
  });

  final String id;

  /// The customer-facing reference (`HT-100234`) — show THIS, never [id].
  final String orderNumber;
  final DateTime createdAt;
  final String status;
  final String fulfillmentType;
  final int? subtotalMinor;
  final int? deliveryFeeMinor;
  final int? discountMinor;
  final int? totalMinor;

  /// A Hatly Service item still has no confirmed price: the subtotal shown by the server is only what is confirmed so far, and the
  /// total / amount due are unknown (null) — never to be read or rendered as 0.
  final bool hasPendingPricing;
  final String paymentMethod;
  final OrderPaymentDetails? payment;
  final String? cancellationReason;
  final String? cancelledByRole;

  /// FAILED_DELIVERY customer presentation. Both real, backend-
  /// sourced — never fabricated. Null on any non-failed order, and
  /// `failedAt` may be null even on a failed order (defensive, never
  /// assumed to always be set together with `failureReason`).
  final String? failureReason;
  final DateTime? failedAt;
  final List<OrderSegmentDetails> segments;

  /// Null until a Driver is actually assigned — never a placeholder.
  final OrderDriverDetails? driver;

  /// The immutable address snapshot taken when the order was placed (null for pickup) — never the live saved address.
  final QuoteAddressSnapshot? deliveryAddress;
  final String? electronicPaymentMethod;
  final int walletAmountMinor;
  final int? amountDueMinor;
  final OrderCouponDetails? coupon;
  final OrderDeliveryBreakdown? deliveryBreakdown;

  /// Hatly / Wasally only (PD-012): the route as it was frozen at checkout, origin → destination. Null for every other order.
  final ResolvedRoute? deliveryRoute;
  final OrderEta eta;
  final List<OrderTimelineEntry> timeline;

  /// The server's verdict on whether the whole order can be cancelled by the customer right now.
  final bool customerCanCancel;

  /// What has been given back so far (from the real ledgers) and whether only some vendor parts were rejected.
  final OrderRefundSummary refundSummary;
  final OrderPartialRejection? partialRejection;

  bool get isPickup => fulfillmentType == 'PICKUP';

  factory OrderDetails.fromJson(Map<String, dynamic> json) {
    return OrderDetails(
      id: json['id'] as String,
      orderNumber: json['orderNumber'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      status: json['status'] as String,
      fulfillmentType: json['fulfillmentType'] as String,
      subtotalMinor: json['subtotalMinor'] as int?,
      deliveryFeeMinor: json['deliveryFeeMinor'] as int?,
      discountMinor: json['discountMinor'] as int?,
      totalMinor: json['totalMinor'] as int?,
      hasPendingPricing: json['hasPendingPricing'] as bool? ?? false,
      paymentMethod: json['paymentMethod'] as String,
      payment: json['payment'] != null
          ? OrderPaymentDetails.fromJson(
              json['payment'] as Map<String, dynamic>)
          : null,
      cancellationReason: json['cancellationReason'] as String?,
      cancelledByRole: json['cancelledByRole'] as String?,
      failureReason: json['failureReason'] as String?,
      failedAt: json['failedAt'] != null
          ? DateTime.parse(json['failedAt'] as String)
          : null,
      segments: (json['segments'] as List)
          .map((e) => OrderSegmentDetails.fromJson(e as Map<String, dynamic>))
          .toList(),
      driver: json['driver'] != null
          ? OrderDriverDetails.fromJson(json['driver'] as Map<String, dynamic>)
          : null,
      deliveryAddress: json['deliveryAddressSnapshot'] is Map<String, dynamic>
          ? QuoteAddressSnapshot.fromJson(
              json['deliveryAddressSnapshot'] as Map<String, dynamic>)
          : null,
      electronicPaymentMethod: json['electronicPaymentMethod'] as String?,
      walletAmountMinor: (json['walletAmountMinor'] as num?)?.toInt() ?? 0,
      amountDueMinor: (json['amountDueMinor'] as num?)?.toInt(),
      coupon: json['coupon'] is Map<String, dynamic>
          ? OrderCouponDetails.fromJson(json['coupon'] as Map<String, dynamic>)
          : null,
      deliveryBreakdown: json['deliveryBreakdown'] is Map<String, dynamic>
          ? OrderDeliveryBreakdown.fromJson(
              json['deliveryBreakdown'] as Map<String, dynamic>)
          : null,
      deliveryRoute: ResolvedRoute.tryParse(json['deliveryRoute']),
      eta: OrderEta.fromJson(json['eta'] as Map<String, dynamic>?),
      timeline: (json['timeline'] as List? ?? [])
          .map((e) => OrderTimelineEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      customerCanCancel: json['customerCanCancel'] as bool? ?? false,
      refundSummary: OrderRefundSummary.fromJson(
          json['refundSummary'] as Map<String, dynamic>?),
      partialRejection: OrderPartialRejection.tryParse(json['partialRejection']),
    );
  }
}
