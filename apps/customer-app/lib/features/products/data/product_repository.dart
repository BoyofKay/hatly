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
  /// `'newest'`, `'price_asc'`, `'price_desc'` (mirrors the backend's
  /// own `ProductSortOption` exactly — see
  /// `discovery.constants.ts`). Omitting all four reproduces the
  /// original pre-Discovery "whole menu, newest first" behavior
  /// exactly, so existing call sites remain valid unchanged.
  Future<List<Product>> getProducts(
    String vendorBranchId, {
    String? categoryId,
    String? sort,
    String? search,
    int? page,
    int? limit,
  });

  Future<Product> getProductDetails(String productId);
}
