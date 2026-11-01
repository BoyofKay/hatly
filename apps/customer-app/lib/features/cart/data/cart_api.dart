import '../../../core/network/api_client.dart';
import '../domain/cart.dart';
import '../domain/cart_compatibility.dart';
import '../../hatly_service/domain/route_endpoint.dart';
import '../domain/delivery_fee_quote.dart';

/// Calls the real `/cart` endpoints (cart.controller.ts) — every
/// method corresponds to exactly one backend route, and none of them
/// send a price (the backend computes every price server-side).
///
/// CONFIRMED (Cart & Checkout Stabilization): all five pre-existing
/// methods now parse the real groups-based `Cart.fromJson` — the
/// prior flat-`items` parsing failed on every real response (see the
/// approved Design Review's exact finding). Four previously-missing
/// real backend operations are added: [addAdHocItem], [updateItemWeight],
/// [setFulfillmentType], [quoteDeliveryFee].
class CartApi {
  CartApi(this._client);

  final ApiClient _client;

  Future<Cart> getCart() {
    return _client.request(
      (dio) => dio.get('/cart'),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// [requestedWeightGrams] is required for a WEIGHT product, omitted
  /// for a PIECE product — matches the backend's own
  /// `AddCartItemDto`/`CartService.addItem` XOR validation exactly;
  /// this method does not itself decide which is required, it just
  /// forwards whatever the caller supplies.
  /// Asks whether [productId] could be added to the current cart, without adding it.
  Future<CartCompatibility> checkAddItem(String productId) {
    return _client.request(
      (dio) => dio.post('/cart/items/check', data: {'productId': productId}),
      (data) => CartCompatibility.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<Cart> addItem({
    required String productId,
    required int quantity,
    List<String>? selectedOptionValueIds,
    String? notes,
    int? requestedWeightGrams,
  }) {
    return _client.request(
      (dio) => dio.post(
        '/cart/items',
        data: {
          'productId': productId,
          'quantity': quantity,
          if (selectedOptionValueIds != null)
            'selectedOptionValueIds': selectedOptionValueIds,
          if (notes != null) 'notes': notes,
          if (requestedWeightGrams != null)
            'requestedWeightGrams': requestedWeightGrams,
        },
      ),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<Cart> updateItemQuantity(
      {required String itemId, required int quantity}) {
    return _client.request(
      (dio) => dio.patch('/cart/items/$itemId', data: {'quantity': quantity}),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// The WEIGHT-item counterpart to [updateItemQuantity] — matches the
  /// backend's own `PATCH /cart/items/:itemId` branching on which
  /// field is present in the request body (see `CartController`'s own
  /// comment).
  Future<Cart> updateItemWeight(
      {required String itemId, required int requestedWeightGrams}) {
    return _client.request(
      (dio) => dio.patch('/cart/items/$itemId',
          data: {'requestedWeightGrams': requestedWeightGrams}),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<Cart> removeItem(String itemId) {
    return _client.request(
      (dio) => dio.delete('/cart/items/$itemId'),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<Cart> clearCart() {
    return _client.request(
      (dio) => dio.delete('/cart'),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Adds an item to a new or existing AD_HOC_SERVICE group (an
  /// unregistered place the customer describes in free text — see
  /// `AddAdHocCartItemDto`'s own comment for the exact
  /// cartVendorGroupId/adHocPlaceName XOR rule, enforced server-side).
  /// CONFIRMED scope: only the API method is added here — a full
  /// "describe an ad-hoc item + upload photos" creation UI is a
  /// separate feature (depends on the Uploads flow), not built as
  /// part of Cart stabilization.
  Future<Cart> addAdHocItem({
    String? cartVendorGroupId,
    String? adHocPlaceName,
    String? adHocServiceType,
    double? pickupLatitude,
    double? pickupLongitude,
    double? destinationLatitude,
    double? destinationLongitude,
    String? pickupLabel,
    String? destinationLabel,
    required String freeTextDescription,
    required int quantity,
    List<String>? imageUrls,
  }) {
    return _client.request(
      (dio) => dio.post(
        '/cart/adhoc-items',
        data: {
          if (cartVendorGroupId != null) 'cartVendorGroupId': cartVendorGroupId,
          if (adHocPlaceName != null) 'adHocPlaceName': adHocPlaceName,
          if (adHocServiceType != null) 'adHocServiceType': adHocServiceType,
          if (pickupLatitude != null) 'pickupLatitude': pickupLatitude,
          if (pickupLongitude != null) 'pickupLongitude': pickupLongitude,
          if (destinationLatitude != null)
            'destinationLatitude': destinationLatitude,
          if (destinationLongitude != null)
            'destinationLongitude': destinationLongitude,
          if (pickupLabel != null) 'pickupLabel': pickupLabel,
          if (destinationLabel != null) 'destinationLabel': destinationLabel,
          'freeTextDescription': freeTextDescription,
          'quantity': quantity,
          if (imageUrls != null) 'imageUrls': imageUrls,
        },
      ),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Changes the route origin and/or destination of the cart's Hatly / Wasally request (`PATCH /cart/adhoc-route`, PD-012). Each end
  /// is independent: an endpoint sets it, `clear…: true` returns it to the service's configured default, leaving it out changes
  /// nothing. The server resolves and prices the route; this only stores the customer's choice.
  Future<Cart> updateAdHocRoute({
    RouteEndpoint? origin,
    bool clearOrigin = false,
    RouteEndpoint? destination,
    bool clearDestination = false,
  }) {
    return _client.request(
      (dio) => dio.patch(
        '/cart/adhoc-route',
        data: {
          if (clearOrigin) 'origin': null else if (origin != null) 'origin': origin.toJson(),
          if (clearDestination) 'destination': null else if (destination != null) 'destination': destination.toJson(),
        },
      ),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Vendor/Pharmacy Custom Request. Reuses the real
  /// `POST /cart/vendor-custom-items` endpoint — targets an EXISTING
  /// CATALOG group via [cartVendorGroupId], or starts/reuses one for
  /// [vendorBranchId] when the customer has no catalog product from
  /// that vendor yet. Exactly one of the two is expected (enforced
  /// server-side, mirrored here only by making both optional). Never
  /// creates/uses an AD_HOC_SERVICE group — that remains
  /// [addAdHocItem]'s own, separate concern.
  Future<Cart> addVendorCustomItem({
    String? cartVendorGroupId,
    String? vendorBranchId,
    String? freeTextDescription,
    List<String>? imageUrls,
  }) {
    return _client.request(
      (dio) => dio.post(
        '/cart/vendor-custom-items',
        data: {
          if (cartVendorGroupId != null) 'cartVendorGroupId': cartVendorGroupId,
          if (vendorBranchId != null) 'vendorBranchId': vendorBranchId,
          if (freeTextDescription != null)
            'freeTextDescription': freeTextDescription,
          if (imageUrls != null) 'imageUrls': imageUrls,
        },
      ),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<Cart> setFulfillmentType(String fulfillmentType) {
    return _client.request(
      (dio) => dio.patch('/cart/fulfillment-type',
          data: {'fulfillmentType': fulfillmentType}),
      (data) => Cart.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// CONFIRMED (decision 2): the existing, real delivery-fee formula —
  /// never recomputed client-side.
  Future<DeliveryFeeQuote> quoteDeliveryFee(
      {required double latitude, required double longitude}) {
    return _client.request(
      (dio) => dio.post('/cart/delivery-fee-quote',
          data: {'latitude': latitude, 'longitude': longitude}),
      (data) => DeliveryFeeQuote.fromJson(data['data'] as Map<String, dynamic>),
    );
  }
}
