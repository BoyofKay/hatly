import '../../../core/network/api_client.dart';
import '../domain/catalog_product.dart';
import 'catalog_repository.dart';

/// Real implementation of [CatalogRepository] over the Catalog Foundation endpoints.
class ApiCatalogRepository implements CatalogRepository {
  ApiCatalogRepository(this._client);

  final ApiClient _client;

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
