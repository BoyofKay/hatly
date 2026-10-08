import '../domain/product.dart';
import '../domain/product_category.dart';

/// The only thing the UI/providers depend on. Real, API-backed
/// implementation: [ApiProductRepository] (see that file).
abstract class ProductRepository {
  Future<List<ProductCategoryInfo>> getCategories(String vendorBranchId);

  /// [categoryId] filters to one of the vendor's own menu sections, or
  /// null for the vendor's full product list.
  ///
  /// [sort]/[search]/[page]/[limit] — Discovery & Ranking additions,
  /// all optional. [sort] is one of `'highestRated'`, `'bestSelling'`,
  /// `'newest'`, `'price_asc'`, `'price_desc'`, `'offers'` (Filters V1
  /// addition) — mirrors the backend's own `ProductSortOption` exactly
  /// (see `discovery.constants.ts`). Omitting all four reproduces the
  /// original pre-Discovery "whole menu, newest first" behavior
  /// exactly, so existing call sites remain valid unchanged.
  ///
  /// Filters V1: [availableOnly]/[hasOffers]/[minPriceMinor]/
  /// [maxPriceMinor] — all OPTIONAL, all real backend data
  /// (`Product.isAvailable`, real active `Offer` targeting,
  /// `Product.priceMinor`). Omitting all four reproduces the exact
  /// pre-Filters-V1 listing.
  Future<List<Product>> getProducts(
    String vendorBranchId, {
    String? categoryId,
    String? sort,
    String? search,
    int? page,
    int? limit,
    bool? availableOnly,
    bool? hasOffers,
    int? minPriceMinor,
    int? maxPriceMinor,
  });

  Future<Product> getProductDetails(String productId);
}
