import '../../../core/network/api_client.dart';
import '../domain/sector.dart';
import '../domain/subcategory.dart';

/// Calls the real `GET /sectors` endpoint implemented in this same
/// phase (public-sectors.controller.ts / sectors.service.ts) — already
/// filters to active, non-deleted sectors, ordered by `sortOrder`;
/// this class does no filtering/sorting of its own.
class SectorsApi {
  SectorsApi(this._client);

  final ApiClient _client;

  Future<List<MarketplaceSector>> getSectors() {
    return _client.request(
      (dio) => dio.get('/sectors'),
      (data) => (data['data'] as List)
          .map((e) => MarketplaceSector.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Consolidated customer-commerce milestone, Part E — calls the real
  /// `GET /sectors/:sectorId/subcategories` endpoint
  /// (public-subcategories.controller.ts /
  /// subcategories.service.ts.listActiveForSector) — already filters
  /// to active, non-deleted subcategories of an active sector, ordered
  /// by `sortOrder`; this class does no filtering/sorting of its own.
  Future<List<MarketplaceSubcategory>> getSubcategories(String sectorId) {
    return _client.request(
      (dio) => dio.get('/sectors/$sectorId/subcategories'),
      (data) => (data['data'] as List)
          .map((e) =>
              MarketplaceSubcategory.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
