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
      // The Favorites controller returns a RAW array (unlike most API
      // controllers that wrap records in {data: ...}). Accept either form
      // to support existing deployed servers without breaking saved hearts.
      (data) {
        final records = data is List ? data : (data as Map<String, dynamic>)['data'] as List;
        return records.map((e) => FavoriteVendor.fromJson(e as Map<String, dynamic>)).toList();
      },
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
