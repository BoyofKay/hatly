import '../../../core/network/api_client.dart';
import '../domain/product.dart';
import '../domain/product_option.dart';
import '../domain/product_category.dart';
import 'product_repository.dart';

/// Real implementation of [ProductRepository] — calls the real,
/// already-implemented backend endpoints
/// (`vendor-branches/:branchId/categories`,
/// `vendor-branches/:branchId/products`, `products/:id`).
///
/// CONFIRMED (Discovery & Ranking): needed as a prerequisite for this
/// phase specifically — the new backend sort/search/pagination query
/// parameters have no effect at all against
/// [FixtureProductRepository], which ignores them entirely. "The
/// backend remains the sole source of truth" / "do not implement
/// client-side ranking" only holds if the client actually calls the
/// real backend — so this swap is a genuine, necessary integration
/// point for this chunk, mirroring the identical `ApiVendorRepository`
/// swap made in the Marketplace Sector Taxonomy phase.
class ApiProductRepository implements ProductRepository {
  ApiProductRepository(this._client);

  final ApiClient _client;

  @override
  Future<List<ProductCategoryInfo>> getCategories(String vendorBranchId) {
    return _client.request(
      (dio) => dio.get('/vendor-branches/$vendorBranchId/categories'),
      (data) => (data['data'] as List)
          .map((e) => _toCategory(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// [sort]/[search]/[page]/[limit] are the new Discovery parameters —
  /// all optional, all additive; omitting them reproduces the exact
  /// pre-Discovery "whole menu, newest first" behavior.
  @override
  Future<List<Product>> getProducts(
    String vendorBranchId, {
    String? categoryId,
    String? sort,
    String? search,
    int? page,
    int? limit,
  }) {
    return _client.request(
      (dio) => dio.get(
        '/vendor-branches/$vendorBranchId/products',
        queryParameters: {
          if (categoryId != null) 'categoryId': categoryId,
          if (sort != null) 'sort': sort,
          if (search != null && search.isNotEmpty) 'search': search,
          if (page != null) 'page': page,
          if (limit != null) 'limit': limit,
        },
      ),
      (data) => (data['data'] as List)
          .map((e) => _toProduct(e as Map<String, dynamic>))
          .toList(),
    );
  }

  @override
  Future<Product> getProductDetails(String productId) {
    return _client.request(
      (dio) => dio.get('/products/$productId'),
      (data) => _toProduct(data['data'] as Map<String, dynamic>),
    );
  }

  ProductCategoryInfo _toCategory(Map<String, dynamic> json) {
    return ProductCategoryInfo(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
    );
  }

  Product _toProduct(Map<String, dynamic> json) {
    return Product(
      id: json['id'] as String,
      vendorBranchId: json['vendorBranchId'] as String,
      categoryId: json['categoryId'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      description: json['description'] as String?,
      descriptionAr: json['descriptionAr'] as String?,
      imageUrl: json['imageUrl'] as String?,
      priceMinor: json['priceMinor'] as int,
      isAvailable: json['isAvailable'] as bool,
      pricingUnit: json['pricingUnit'] as String? ?? 'PIECE',
      inventoryMode: json['inventoryMode'] as String? ?? 'OPEN',
      quantity: json['quantity'] as int?,
      options: ((json['options'] as List?) ?? [])
          .map((e) => _toOption(e as Map<String, dynamic>))
          .toList(),
      activeOffer: json['activeOffer'] != null
          ? ActiveOffer.fromJson(json['activeOffer'] as Map<String, dynamic>)
          : null,
      // Additive fields (only present on GET /products/:id).
      catalogProductId: json['catalogProductId'] as String?,
      vendor: json['vendor'] != null
          ? ProductVendorSummary.fromJson(
              json['vendor'] as Map<String, dynamic>)
          : null,
    );
  }

  ProductOption _toOption(Map<String, dynamic> json) {
    return ProductOption(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      isRequired: json['isRequired'] as bool,
      allowsMultiple: json['allowsMultiple'] as bool,
      values: ((json['values'] as List?) ?? [])
          .map((e) => _toOptionValue(e as Map<String, dynamic>))
          .toList(),
    );
  }

  ProductOptionValue _toOptionValue(Map<String, dynamic> json) {
    return ProductOptionValue(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      priceDeltaMinor: (json['priceDeltaMinor'] as num?)?.toInt() ?? 0,
    );
  }
}
