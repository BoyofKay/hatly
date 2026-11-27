import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/providers.dart';
import '../../auth/presentation/auth_gate.dart';
import '../data/cart_api.dart';
import '../domain/cart.dart';
import '../domain/cart_compatibility.dart';
import '../../hatly_service/domain/route_endpoint.dart';
import '../domain/delivery_fee_quote.dart';

final cartApiProvider =
    Provider<CartApi>((ref) => CartApi(ref.watch(apiClientProvider)));

/// CONFIRMED (Cart & Checkout Stabilization, fix): every mutation
/// method now catches broadly (`catch (e)`, not `on ApiException`) so
/// a parsing failure — or any other unexpected error — can never
/// escape as an uncaught exception the way it previously could (the
/// approved Design Review's exact finding: `Cart.fromJson`'s type-cast
/// failure was not a `DioException`, so the old `on ApiException`
/// clause never caught it). A non-`ApiException` error is wrapped into
/// a generic `ApiException` so callers still only ever need to handle
/// one error type, matching this project's existing convention.
///
/// This is the SINGLE authoritative Cart source — CartScreen and
/// Checkout both watch [cartControllerProvider]; no second Cart
/// parser/provider exists anywhere in this feature.
class CartController extends StateNotifier<AsyncValue<Cart>> {
  /// [signedIn] false = a guest: the cart is simply empty and NOTHING is requested (the carts are per account; there is no
  /// anonymous cart). Guests cannot reach any mutation — the UI sends them to sign-in first.
  CartController(this._api, {bool signedIn = true})
      : super(signedIn
            ? const AsyncValue.loading()
            : const AsyncValue.data(Cart.empty)) {
    if (signedIn) refresh();
  }

  final CartApi _api;

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final cart = await _api.getCart();
      // The provider may have been invalidated (e.g. right after an order was placed) while this read was in flight.
      if (!mounted) return;
      state = AsyncValue.data(cart);
    } catch (error, stackTrace) {
      if (!mounted) return;
      state = AsyncValue.error(error, stackTrace);
    }
  }

  /// The server's verdict on adding [productId] to the current cart. Null when it could not be asked (offline, server error): the caller
  /// then simply tries the add, and the server's own refusal — authoritative either way — is shown instead.
  Future<CartCompatibility?> checkAdd(String productId) async {
    try {
      return await _api.checkAddItem(productId);
    } catch (_) {
      return null;
    }
  }

  Future<ApiException?> addItem({
    required String productId,
    required int quantity,
    List<String>? selectedOptionValueIds,
    String? notes,
    int? requestedWeightGrams,
  }) {
    return _mutate(() => _api.addItem(
          productId: productId,
          quantity: quantity,
          selectedOptionValueIds: selectedOptionValueIds,
          notes: notes,
          requestedWeightGrams: requestedWeightGrams,
        ));
  }

  Future<ApiException?> updateItemQuantity(
      {required String itemId, required int quantity}) {
    return _mutate(
        () => _api.updateItemQuantity(itemId: itemId, quantity: quantity));
  }

  Future<ApiException?> updateItemWeight(
      {required String itemId, required int requestedWeightGrams}) {
    return _mutate(() => _api.updateItemWeight(
        itemId: itemId, requestedWeightGrams: requestedWeightGrams));
  }

  Future<ApiException?> removeItem(String itemId) {
    return _mutate(() => _api.removeItem(itemId));
  }

  Future<ApiException?> clearCart() {
    return _mutate(() => _api.clearCart());
  }

  Future<ApiException?> setFulfillmentType(String fulfillmentType) {
    return _mutate(() => _api.setFulfillmentType(fulfillmentType));
  }

  Future<ApiException?> addAdHocItem({
    String? cartVendorGroupId,
    String? adHocPlaceName,
    String? adHocServiceType,
    double? pickupLatitude,
    double? pickupLongitude,
    double? destinationLatitude,
    double? destinationLongitude,
    String? pickupLabel,
    String? destinationLabel,
    String? freeTextDescription,
    required int quantity,
    List<String>? imageUrls,
    String? voiceNoteUrl,
  }) {
    return _mutate(() => _api.addAdHocItem(
          cartVendorGroupId: cartVendorGroupId,
          adHocPlaceName: adHocPlaceName,
          adHocServiceType: adHocServiceType,
          pickupLatitude: pickupLatitude,
          pickupLongitude: pickupLongitude,
          destinationLatitude: destinationLatitude,
          destinationLongitude: destinationLongitude,
          pickupLabel: pickupLabel,
          destinationLabel: destinationLabel,
          freeTextDescription: freeTextDescription,
          quantity: quantity,
          imageUrls: imageUrls,
          voiceNoteUrl: voiceNoteUrl,
        ));
  }

  /// Changes the Hatly / Wasally route origin and/or destination (each independently; `clear…` = back to the configured default).
  Future<ApiException?> updateAdHocRoute({
    RouteEndpoint? origin,
    bool clearOrigin = false,
    RouteEndpoint? destination,
    bool clearDestination = false,
  }) {
    return _mutate(() => _api.updateAdHocRoute(
          origin: origin,
          clearOrigin: clearOrigin,
          destination: destination,
          clearDestination: clearDestination,
        ));
  }

  /// Vendor/Pharmacy Custom Request. Mirrors [addAdHocItem]'s own
  /// wrapper shape exactly.
  Future<ApiException?> addVendorCustomItem({
    String? cartVendorGroupId,
    String? vendorBranchId,
    String? freeTextDescription,
    List<String>? imageUrls,
  }) {
    return _mutate(() => _api.addVendorCustomItem(
          cartVendorGroupId: cartVendorGroupId,
          vendorBranchId: vendorBranchId,
          freeTextDescription: freeTextDescription,
          imageUrls: imageUrls,
        ));
  }

  /// Deliberately does NOT overwrite `state` with an error on failure —
  /// a failed mutation (branch conflict, validation, weight-restriction,
  /// etc.) shouldn't blank out the cart the customer can already see;
  /// the caller shows the returned error inline instead. On success,
  /// `state` is always updated to the fresh, authoritative cart the
  /// mutation itself returned — never a locally-patched guess.
  Future<ApiException?> _mutate(Future<Cart> Function() call) async {
    try {
      final cart = await call();
      state = AsyncValue.data(cart);
      return null;
    } on ApiException catch (e) {
      return e;
    } catch (e) {
      // Anything else (e.g. a response-parsing failure) is wrapped,
      // never left to propagate uncaught.
      return ApiException(code: 'UNKNOWN_ERROR', message: e.toString());
    }
  }
}

final cartControllerProvider =
    StateNotifierProvider<CartController, AsyncValue<Cart>>((ref) {
  return CartController(ref.watch(cartApiProvider),
      signedIn: ref.watch(isSignedInProvider));
});

/// CONFIRMED (decision 2): a one-shot fetch, not a watched provider —
/// Checkout calls this once an address is selected and displays
/// whatever the backend returns directly; no local fee formula exists.
final deliveryFeeQuoteProvider = FutureProvider.autoDispose
    .family<DeliveryFeeQuote, ({double latitude, double longitude})>(
        (ref, coords) {
  return ref
      .watch(cartApiProvider)
      .quoteDeliveryFee(latitude: coords.latitude, longitude: coords.longitude);
});
