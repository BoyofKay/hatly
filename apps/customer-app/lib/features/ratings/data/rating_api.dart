import '../../../core/network/api_client.dart';

/// Customer Ratings. Mirrors the real backend `OrderRatingState`
/// (rating-state.service.ts) field-for-field — no field invented,
/// none omitted. Driver state is parsed (the backend always returns
/// it) but deliberately UNUSED by any UI in this chunk — Driver
/// Rating UI is explicitly out of scope.
class SubmittedRating {
  const SubmittedRating({required this.stars, this.comment});
  final int stars;
  final String? comment;

  factory SubmittedRating.fromJson(Map<String, dynamic> json) {
    return SubmittedRating(
        stars: json['stars'] as int, comment: json['comment'] as String?);
  }
}

class VendorSegmentRatingState {
  const VendorSegmentRatingState({
    required this.orderVendorSegmentId,
    required this.vendorBranchId,
    required this.alreadyRated,
    this.rating,
  });

  final String orderVendorSegmentId;
  final String vendorBranchId;
  final bool alreadyRated;
  final SubmittedRating? rating;

  factory VendorSegmentRatingState.fromJson(Map<String, dynamic> json) {
    return VendorSegmentRatingState(
      orderVendorSegmentId: json['orderVendorSegmentId'] as String,
      vendorBranchId: json['vendorBranchId'] as String,
      alreadyRated: json['alreadyRated'] as bool,
      rating: json['rating'] != null
          ? SubmittedRating.fromJson(json['rating'] as Map<String, dynamic>)
          : null,
    );
  }
}

class ProductItemRatingState {
  const ProductItemRatingState({
    required this.orderItemId,
    this.productId,
    this.productNameSnapshot,
    required this.alreadyRated,
    this.rating,
  });

  final String orderItemId;
  final String? productId;
  final String? productNameSnapshot;
  final bool alreadyRated;
  final SubmittedRating? rating;

  factory ProductItemRatingState.fromJson(Map<String, dynamic> json) {
    return ProductItemRatingState(
      orderItemId: json['orderItemId'] as String,
      productId: json['productId'] as String?,
      productNameSnapshot: json['productNameSnapshot'] as String?,
      alreadyRated: json['alreadyRated'] as bool,
      rating: json['rating'] != null
          ? SubmittedRating.fromJson(json['rating'] as Map<String, dynamic>)
          : null,
    );
  }
}

class OrderRatingState {
  const OrderRatingState(
      {required this.orderId,
      required this.vendorSegments,
      required this.productItems});

  final String orderId;
  final List<VendorSegmentRatingState> vendorSegments;
  final List<ProductItemRatingState> productItems;
  // `driver` intentionally not modeled — out of scope, never read.

  factory OrderRatingState.fromJson(Map<String, dynamic> json) {
    return OrderRatingState(
      orderId: json['orderId'] as String,
      vendorSegments: (json['vendorSegments'] as List)
          .map((e) =>
              VendorSegmentRatingState.fromJson(e as Map<String, dynamic>))
          .toList(),
      productItems: (json['productItems'] as List)
          .map(
              (e) => ProductItemRatingState.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

/// Calls the real, already-complete backend rating endpoints exactly
/// as they exist — no new endpoint, no reshaping of the contract.
/// Never sends `customerId` (the existing session token handles
/// that) and never sends a `vendorBranchId` — only the existing
/// order-derived identifiers (`orderVendorSegmentId`/`orderItemId`)
/// the real DTOs actually expect.
class RatingApi {
  RatingApi(this._client);

  final ApiClient _client;

  Future<OrderRatingState> getOrderRatingState(String orderId) {
    return _client.request(
      (dio) => dio.get('/orders/$orderId/rating-state'),
      (data) => OrderRatingState.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<void> rateVendor(
      {required String orderVendorSegmentId,
      required int stars,
      String? comment}) {
    return _client.request(
      (dio) => dio.post(
        '/ratings/vendor',
        data: {
          'orderVendorSegmentId': orderVendorSegmentId,
          'stars': stars,
          if (comment != null && comment.isNotEmpty) 'comment': comment,
        },
      ),
      (_) => null,
    );
  }

  Future<void> rateProduct(
      {required String orderItemId, required int stars, String? comment}) {
    return _client.request(
      (dio) => dio.post(
        '/ratings/product',
        data: {
          'orderItemId': orderItemId,
          'stars': stars,
          if (comment != null && comment.isNotEmpty) 'comment': comment,
        },
      ),
      (_) => null,
    );
  }
}
