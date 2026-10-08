import '../../../core/network/api_client.dart';
import '../domain/delivery_zone.dart';
import '../domain/saved_address.dart';

/// Calls the real `/addresses` endpoints implemented in this same
/// phase (addresses.controller.ts / addresses.service.ts).
class AddressesApi {
  AddressesApi(this._client);

  final ApiClient _client;

  Future<List<SavedAddress>> getAddresses() {
    return _client.request(
      (dio) => dio.get('/addresses'),
      (data) => (data['data'] as List)
          .map((e) => SavedAddress.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  Future<SavedAddress> createAddress(AddressInput input) {
    return _client.request(
      (dio) => dio.post('/addresses', data: input.toJson()),
      (data) => SavedAddress.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// `GET /delivery-zones` — the active zones the customer can choose from (PD-009). Never hardcoded in the app.
  Future<List<DeliveryZone>> getDeliveryZones() {
    return _client.request(
      (dio) => dio.get('/delivery-zones'),
      (data) => (data['data'] as List)
          .map((e) => DeliveryZone.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Makes an address the default WITHOUT resending its other fields — so it also works for an address saved before zones
  /// existed (the server only accepts zone-less edits of the label / default flag).
  Future<SavedAddress> setDefaultAddress(String addressId) {
    return _client.request(
      (dio) => dio.patch('/addresses/$addressId', data: {'isDefault': true}),
      (data) => SavedAddress.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<void> deactivateAddress(String addressId) {
    return _client.request<void>(
      (dio) => dio.delete('/addresses/$addressId'),
      (data) {},
    );
  }

  /// `PATCH /addresses/:id` — partial update; ownership is enforced server-side. The zone is always sent; the pin only when
  /// the customer set one (or explicitly removed it) — never a fabricated default.
  Future<SavedAddress> updateAddress(String addressId, AddressInput input) {
    return _client.request(
      (dio) => dio.patch('/addresses/$addressId', data: input.toJson()),
      (data) => SavedAddress.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  /// Assistive reverse geocoding through the server (the map key never ships in the app for this). Null = no suggestion —
  /// the customer types the address themselves; this never blocks anything.
  Future<String?> reverseGeocode(double latitude, double longitude) {
    return _client.request(
      (dio) => dio.get('/geo/reverse',
          queryParameters: {'latitude': latitude, 'longitude': longitude}),
      (data) =>
          (data['data'] as Map<String, dynamic>)['formattedAddress'] as String?,
    );
  }

  /// Assistive forward geocoding: where a typed address is. Null = nothing found. The result only moves the pin — the
  /// customer confirms the final position.
  Future<({double latitude, double longitude})?> searchAddress(String query) {
    return _client.request(
      (dio) => dio.get('/geo/search', queryParameters: {'q': query}),
      (data) {
        final point = data['data'];
        if (point is! Map) return null;
        return (
          latitude: (point['latitude'] as num).toDouble(),
          longitude: (point['longitude'] as num).toDouble(),
        );
      },
    );
  }
}
