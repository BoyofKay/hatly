import '../../../core/network/api_client.dart';
import '../domain/sector.dart';

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
}
