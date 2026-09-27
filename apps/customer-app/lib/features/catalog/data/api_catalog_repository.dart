import '../../../core/network/api_client.dart';
import '../domain/catalog_product.dart';
import 'catalog_repository.dart';

/// Real implementation of [CatalogRepository] over the Catalog Foundation endpoints.
class ApiCatalogRepository implements CatalogRepository {
  ApiCatalogRepository(this._client);

  final ApiClient _client;

  @override
  Future<CatalogProductPage> getSectorProducts(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
  }) {
    // Same atomic-pair rule as the vendor listing: both coordinates or neither.
    final hasCoordinates = latitude != null && longitude != null;
    return _client.request(
      (dio) => dio.get(
        '/products',
        queryParameters: {
          'sectorId': sectorId,
          if (sort != null) 'sort': sort,
          if (search != null && search.isNotEmpty) 'search': search,
          'page': page,
          'limit': limit,
          if (hasCoordinates) 'latitude': latitude,
          if (hasCoordinates) 'longitude': longitude,
        },
      ),
      (data) => CatalogProductPage.fromJson(data),
    );
  }

  @override
  Future<CatalogProductDetails> getCatalogProduct(
    String catalogProductId, {
    double? latitude,
    double? longitude,
  }) {
    final hasCoordinates = latitude != null && longitude != null;
    return _client.request(
      (dio) => dio.get(
        '/catalog-products/$catalogProductId',
        queryParameters: {
          if (hasCoordinates) 'latitude': latitude,
          if (hasCoordinates) 'longitude': longitude,
        },
      ),
      (data) =>
          CatalogProductDetails.fromJson(data['data'] as Map<String, dynamic>),
    );
  }
}
