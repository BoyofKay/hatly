import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/providers.dart';
import 'favorites_api.dart';
import '../domain/favorite_vendor.dart';

final favoritesApiProvider =
    Provider<FavoritesApi>((ref) => FavoritesApi(ref.watch(apiClientProvider)));

/// Favorites Chunk 2. Single source of truth for the Customer's
/// favorited Vendors — mirrors CartController's shape (a
/// `StateNotifier<AsyncValue<T>>` with a `refresh()` plus mutation
/// methods returning `Future<ApiException?>`, null meaning success),
/// not `savedAddressesProvider`'s simpler read-only
/// `FutureProvider.autoDispose` — Favorites needs owned mutation
/// methods with duplicate-call protection, which the Cart shape
/// already solves, so it's the closer precedent here despite
/// Addresses being the more superficially similar feature.
///
/// Unlike CartController's mutation endpoints (which return the full
/// updated Cart inline), the backend's POST/DELETE `/favorites`
/// endpoints return 204 No Content (Chunk 1) — so a successful
/// mutation here calls `refresh()` afterward to re-fetch the real
/// list, rather than trusting a returned object that doesn't exist.
/// This is a deliberate, minimal deviation from CartController's
/// exact inline-update shape, not an invented new pattern — no
/// optimistic local mutation is performed, per this chunk's own
/// instruction not to introduce optimistic UI unless the existing
/// architecture already standardizes on it (CartController does not).
class FavoritesController
    extends StateNotifier<AsyncValue<List<FavoriteVendor>>> {
  FavoritesController(this._api) : super(const AsyncValue.loading()) {
    refresh();
  }

  final FavoritesApi _api;

  // In-flight tracking, local to this controller — prevents a second
  // add/remove call for the same vendorId while one is already
  // running (e.g. a rapid double-tap on a heart icon), the same
  // reasoning already used for the Saved Addresses delete action's
  // own `_deletingIds` set, adapted here to the provider layer since
  // this chunk's mutation methods live here, not in a widget's local
  // state.
  final Set<String> _pendingVendorIds = {};

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final favorites = await _api.getFavorites();
      state = AsyncValue.data(favorites);
    } catch (error, stackTrace) {
      state = AsyncValue.error(error, stackTrace);
    }
  }

  /// Local-only lookup — CONFIRMED never triggers a network request.
  /// Reads whatever is already held in `state` (populated once by the
  /// constructor's own `refresh()` call, then kept current by every
  /// mutation's own refresh below) rather than one request per
  /// VendorCard.
  bool isFavorited(String vendorId) {
    return state.valueOrNull?.any((f) => f.vendorId == vendorId) ?? false;
  }

  Future<ApiException?> add(String vendorId) {
    return _mutate(vendorId, () => _api.addFavorite(vendorId));
  }

  Future<ApiException?> remove(String vendorId) {
    return _mutate(vendorId, () => _api.removeFavorite(vendorId));
  }

  Future<ApiException?> _mutate(
      String vendorId, Future<void> Function() call) async {
    if (_pendingVendorIds.contains(vendorId)) {
      // Already in flight for this Vendor — CONFIRMED no second
      // concurrent API call is made; the caller simply gets no
      // (further) error from this attempt.
      return null;
    }
    _pendingVendorIds.add(vendorId);
    try {
      await call();
      await refresh();
      return null;
    } on ApiException catch (e) {
      return e;
    } catch (e) {
      // Anything else (e.g. a response-parsing failure) is wrapped,
      // never left to propagate uncaught — same convention as
      // CartController's own _mutate.
      return ApiException(code: 'UNKNOWN_ERROR', message: e.toString());
    } finally {
      _pendingVendorIds.remove(vendorId);
    }
  }
}

final favoritesControllerProvider = StateNotifierProvider<FavoritesController,
    AsyncValue<List<FavoriteVendor>>>((ref) {
  return FavoritesController(ref.watch(favoritesApiProvider));
});
