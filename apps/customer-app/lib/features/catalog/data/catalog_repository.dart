import '../domain/catalog_product.dart';

/// Product-first marketplace data. Additive to the vendor-scoped [ProductRepository]; nothing here changes
/// how a listing is fetched, configured or added to the cart.
abstract class CatalogRepository {
  /// `GET /products?sectorId=` — one item per catalog product (all its vendor listings) or per unlinked
  /// listing. [sort] is `'highestRated'`, `'bestSelling'`, `'newest'`, `'price_asc'` or `'price_desc'`.
  /// Coordinates are sent only as a pair, never a fabricated half.
  Future<CatalogProductPage> getSectorProducts(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
  });

  /// `GET /catalog-products/:id` — the identity plus the vendor listings for the vendor selector.
  Future<CatalogProductDetails> getCatalogProduct(
    String catalogProductId, {
    double? latitude,
    double? longitude,
  });
}
