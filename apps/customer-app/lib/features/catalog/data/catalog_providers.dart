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

/// Key of one product-first sector listing. A new key (different sort/search/coordinates) is a brand-new
/// controller that starts again from page 1 — exactly like the vendor listing. Coordinates are real
/// saved-address values or null, never fabricated.
typedef SectorProductsKey = ({
  String sectorId,
  String? sort,
  String? search,
  double? latitude,
  double? longitude,
});

/// Paginated product-first listing (`GET /products?sectorId=`): first page on creation, `loadMore()` for
/// the next, `refresh()` to reload. Ordering, filtering and grouping are the backend's — nothing is
/// ranked or merged on the client.
class SectorProductsController
    extends StateNotifier<AsyncValue<List<CatalogProductSummary>>> {
  SectorProductsController(this._repository, this._key)
      : super(const AsyncValue.loading()) {
    _loadFirstPage();
  }

  final CatalogRepository _repository;
  final SectorProductsKey _key;
  static const _limit = 20;

  int _page = 1;
  bool _hasMore = true;
  bool _isLoadingMore = false;

  bool get hasMore => _hasMore;

  Future<void> _loadFirstPage() async {
    state = const AsyncValue.loading();
    try {
      final result = await _fetch(1);
      _page = 1;
      _hasMore = result.hasMore;
      state = AsyncValue.data(result.data);
    } catch (error, stackTrace) {
      state = AsyncValue.error(error, stackTrace);
    }
  }

  Future<CatalogProductPage> _fetch(int page) => _repository.getSectorProducts(
        _key.sectorId,
        sort: _key.sort,
        search: _key.search,
        page: page,
        limit: _limit,
        latitude: _key.latitude,
        longitude: _key.longitude,
      );

  Future<void> refresh() => _loadFirstPage();

  /// A load-more failure is swallowed on purpose (the loaded page stays visible) — same convention as the
  /// vendor and order lists.
  Future<void> loadMore() async {
    if (_isLoadingMore || !_hasMore) return;
    final current = state.valueOrNull;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final next = _page + 1;
      final result = await _fetch(next);
      _page = next;
      _hasMore = result.hasMore;
      state = AsyncValue.data([...current, ...result.data]);
    } catch (_) {
      // see above
    } finally {
      _isLoadingMore = false;
    }
  }
}

final sectorProductsControllerProvider = StateNotifierProvider.autoDispose
    .family<SectorProductsController, AsyncValue<List<CatalogProductSummary>>,
        SectorProductsKey>((ref, key) {
  return SectorProductsController(ref.watch(catalogRepositoryProvider), key);
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
