import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../domain/catalog_product.dart';
import 'api_catalog_repository.dart';
import 'catalog_repository.dart';

/// The single place that decides which [CatalogRepository] is active — same pattern as the vendor and
/// product repositories.
final catalogRepositoryProvider = Provider<CatalogRepository>((ref) {
  return ApiCatalogRepository(ref.watch(apiClientProvider));
});

/// Key of one catalog product's store list; the coordinates narrow the listings to the customer's
/// service area, exactly like the listing above.
typedef CatalogDetailsKey = ({
  String catalogProductId,
  double? latitude,
  double? longitude,
});

/// Catalog product + its vendor listings (`GET /catalog-products/:id`), fetched once per key and shared
/// by every screen that needs it.
final catalogProductDetailsProvider = FutureProvider.autoDispose
    .family<CatalogProductDetails, CatalogDetailsKey>((ref, key) {
  return ref.watch(catalogRepositoryProvider).getCatalogProduct(
        key.catalogProductId,
        latitude: key.latitude,
        longitude: key.longitude,
      );
});
