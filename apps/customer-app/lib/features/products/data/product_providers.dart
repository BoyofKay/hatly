import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../domain/product.dart';
import '../domain/product_category.dart';
import 'product_repository.dart';
import 'api_product_repository.dart';

/// The single place that decides which ProductRepository
/// implementation is active — same pattern as vendorRepositoryProvider.
/// Now the real, API-backed implementation (Discovery & Ranking phase)
/// — the fixture ignored sort/search/pagination entirely, so this swap
/// is required for those features to have any real effect.
final productRepositoryProvider = Provider<ProductRepository>((ref) {
  return ApiProductRepository(ref.watch(apiClientProvider));
});

final productCategoriesProvider =
    FutureProvider.autoDispose.family<List<ProductCategoryInfo>, String>((
  ref,
  vendorBranchId,
) {
  return ref.watch(productRepositoryProvider).getCategories(vendorBranchId);
});

/// CONFIRMED (Discovery & Ranking): [sort]/[search]/[page]/[limit]
/// added to the family key so different filter/sort/search
/// combinations are independently cached, mirroring how [categoryId]
/// already worked. Any call site that omits the new fields (all
/// default to null) gets the exact original behavior.
typedef ProductListParams = ({
  String vendorBranchId,
  String? categoryId,
  String? sort,
  String? search,
  int? page,
  int? limit,
});

final productListProvider = FutureProvider.autoDispose
    .family<List<Product>, ProductListParams>((ref, params) {
  return ref.watch(productRepositoryProvider).getProducts(
        params.vendorBranchId,
        categoryId: params.categoryId,
        sort: params.sort,
        search: params.search,
        page: params.page,
        limit: params.limit,
      );
});

final productDetailsProvider =
    FutureProvider.autoDispose.family<Product, String>((ref, productId) {
  return ref.watch(productRepositoryProvider).getProductDetails(productId);
});
