import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../domain/vendor.dart';
import '../domain/vendor_details.dart';
import 'vendor_repository.dart';
import 'api_vendor_repository.dart';

/// The single place that decides which VendorRepository implementation
/// is active. Now the real, API-backed implementation — see
/// ApiVendorRepository's own comment for the one remaining fixture
/// delegation (vendor DETAILS only; listing is fully real).
final vendorRepositoryProvider = Provider<VendorRepository>((ref) {
  return ApiVendorRepository(ref.watch(apiClientProvider));
});

/// Vendor list for a given category filter (null = all). `.family` so
/// Home's unfiltered preview and the full Vendor List screen's
/// filtered/unfiltered views are independently cached and can each
/// show their own loading/error state without stepping on each other.
/// Unchanged by the Discovery phase — Home's own preview doesn't need
/// sort/search/pagination; see [vendorListControllerProvider] for that.
final vendorListProvider =
    FutureProvider.autoDispose.family<List<Vendor>, String?>((
  ref,
  category,
) {
  return ref.watch(vendorRepositoryProvider).getVendors(category: category);
});

/// CONFIRMED (Discovery & Ranking): the paginated/sortable/searchable
/// marketplace listing — a new key means a brand-new controller
/// instance (Riverpod `.family` semantics), which is exactly correct
/// when the customer changes sort/search: start over from page 1
/// rather than trying to merge incompatible result sets.
///
/// LAUNCH TRACK L1-A: `latitude`/`longitude` are part of the key too —
/// a real coordinate change (the customer picks a different saved
/// address) is exactly the same kind of "start over from page 1"
/// event as a sort/search change, for the same reason.
typedef VendorListKey = ({
  String sectorId,
  String? sort,
  String? search,
  double? latitude,
  double? longitude,
  // Consolidated customer-commerce milestone, Part E: part of the key
  // for the same reason sort/search are — selecting a different
  // subcategory is exactly the same kind of "start over from page 1"
  // event.
  String? subcategoryId,
  // Filters V1: same "changing it means start over from page 1" reasoning.
  bool openNow,
  bool hasOffers,
  double? minRating,
});

class VendorListController extends StateNotifier<AsyncValue<List<Vendor>>> {
  VendorListController(this._repository, this._key)
      : super(const AsyncValue.loading()) {
    _loadFirstPage();
  }

  final VendorRepository _repository;
  final VendorListKey _key;
  static const _limit = 20;

  int _page = 1;
  bool _hasMore = true;
  bool _isLoadingMore = false;

  bool get hasMore => _hasMore;

  Future<void> _loadFirstPage() async {
    state = const AsyncValue.loading();
    try {
      final result = await _repository.getVendorsPage(
        _key.sectorId,
        sort: _key.sort,
        search: _key.search,
        page: 1,
        limit: _limit,
        latitude: _key.latitude,
        longitude: _key.longitude,
        subcategoryId: _key.subcategoryId,
        openNow: _key.openNow,
        hasOffers: _key.hasOffers,
        minRating: _key.minRating,
      );
      _page = 1;
      _hasMore = result.hasMore;
      state = AsyncValue.data(result.data);
    } catch (error, stackTrace) {
      state = AsyncValue.error(error, stackTrace);
    }
  }

  Future<void> refresh() => _loadFirstPage();

  /// Deliberately swallows a load-more failure — same convention as
  /// OrderHistoryController: the already-loaded page stays visible.
  Future<void> loadMore() async {
    if (_isLoadingMore || !_hasMore) return;
    final current = state.valueOrNull;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final nextPage = _page + 1;
      final result = await _repository.getVendorsPage(
        _key.sectorId,
        sort: _key.sort,
        search: _key.search,
        page: nextPage,
        limit: _limit,
        latitude: _key.latitude,
        longitude: _key.longitude,
        subcategoryId: _key.subcategoryId,
        openNow: _key.openNow,
        hasOffers: _key.hasOffers,
        minRating: _key.minRating,
      );
      _page = nextPage;
      _hasMore = result.hasMore;
      state = AsyncValue.data([...current, ...result.data]);
    } catch (_) {
      // See doc comment above.
    } finally {
      _isLoadingMore = false;
    }
  }
}

final vendorListControllerProvider = StateNotifierProvider.autoDispose
    .family<VendorListController, AsyncValue<List<Vendor>>, VendorListKey>(
        (ref, key) {
  return VendorListController(ref.watch(vendorRepositoryProvider), key);
});

/// Full details (vendor profile + branch) for one vendor id, used by
/// VendorDetailsScreen.
final vendorDetailsProvider =
    FutureProvider.autoDispose.family<VendorDetails, String>((
  ref,
  vendorId,
) {
  return ref.watch(vendorRepositoryProvider).getVendorDetails(vendorId);
});
