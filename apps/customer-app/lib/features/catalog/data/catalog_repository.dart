import '../domain/catalog_product.dart';

/// Marketplace catalog-product data (a product shared across several vendor listings). Additive to
/// the vendor-scoped [ProductRepository]; nothing here changes how a listing is fetched, configured
/// or added to the cart.
///
/// `getSectorProducts` (`GET /products?sectorId=`, the product-first category listing) was removed
/// from here: category navigation is vendor-first everywhere in this app (no category opens a
/// product listing directly — see `home_category_section.dart`'s `categoryListingRoute()`), so that
/// endpoint had no remaining caller.
abstract class CatalogRepository {
  /// `GET /catalog-products/:id` — the identity plus the vendor listings for the vendor selector.
  Future<CatalogProductDetails> getCatalogProduct(
    String catalogProductId, {
    double? latitude,
    double? longitude,
  });
}
