import '../../../core/network/api_client.dart';
import '../domain/favorite_vendor.dart';

/// Calls the real `/favorites` endpoints (favorites.controller.ts /
/// favorites.service.ts, Favorites Chunk 1) — Vendor-based only, no
/// Product/VendorBranch favorite concept exists on either side.
/// Mirrors `AddressesApi`'s exact request/mapping shape.
class FavoritesApi {
  FavoritesApi(this._client);

  final ApiClient _client;

  Future<List<FavoriteVendor>> getFavorites() {
    return _client.request(
      (dio) => dio.get('/favorites'),
      parseFavoritesPayload,
    );
  }

  /// The backend returns 204 No Content for both add and remove (see
  /// favorites.controller.ts) — never a body to parse — so the
  /// updated list is never returned directly from these calls; the
  /// controller (Chunk 3) is expected to call refresh() afterward via
  /// FavoritesController, exactly like every other mutation in this
  /// app that doesn't get a fresh object back inline.
  Future<void> addFavorite(String vendorId) {
    return _client.request<void>(
      (dio) => dio.post('/favorites', data: {'vendorId': vendorId}),
      (data) {},
    );
  }

  Future<void> removeFavorite(String vendorId) {
    return _client.request<void>(
      (dio) => dio.delete('/favorites/$vendorId'),
      (data) {},
    );
  }
}

/// `GET /favorites` answers with the bare list (favorites.controller.ts returns the service's array unwrapped), unlike
/// most endpoints' `{data: [...]}` envelope. Both shapes are accepted, so the screen works with either backend shape
/// instead of failing on a type error.
List<FavoriteVendor> parseFavoritesPayload(dynamic data) {
  final list =
      data is List ? data : (data as Map<String, dynamic>)['data'] as List;
  return list
      .map((e) => FavoriteVendor.fromJson(e as Map<String, dynamic>))
      .toList();
}
