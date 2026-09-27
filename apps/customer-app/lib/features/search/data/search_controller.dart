import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../../home/data/home_address_provider.dart';
import 'search_api.dart';

final searchApiProvider =
    Provider<SearchApi>((ref) => SearchApi(ref.watch(apiClientProvider)));

enum SearchStatus { idle, loading, loaded, error }

class SearchState {
  const SearchState(
      {this.status = SearchStatus.idle, this.results, this.query = ''});

  final SearchStatus status;
  final SearchResults? results;
  final String query;

  SearchState copyWith(
      {SearchStatus? status, SearchResults? results, String? query}) {
    return SearchState(
        status: status ?? this.status,
        results: results ?? this.results,
        query: query ?? this.query);
  }
}

/// Customer Search. Reuses `homeActiveAddressProvider` (L1-A) as the
/// SOLE source of location — never a second address state, never
/// fabricated coordinates. A lightweight debounce (400ms) avoids
/// firing one backend request per keystroke — no existing debounce
/// utility was found elsewhere in this app to reuse, so a small
/// `Timer`-based one is used here, matching this app's already-light
/// dependency footprint rather than adding a debounce package.
class SearchController extends StateNotifier<SearchState> {
  SearchController(this._ref) : super(const SearchState());

  final Ref _ref;
  Timer? _debounce;

  static const int minQueryLength =
      2; // mirrors the backend's MIN_SEARCH_QUERY_LENGTH exactly

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void onQueryChanged(String query) {
    _debounce?.cancel();
    state = state.copyWith(query: query);

    if (query.trim().length < minQueryLength) {
      // Below the minimum — CONFIRMED, no expensive request issued,
      // matching the backend's own gate exactly.
      state = state.copyWith(status: SearchStatus.idle, results: null);
      return;
    }

    _debounce =
        Timer(const Duration(milliseconds: 400), () => _runSearch(query));
  }

  Future<void> _runSearch(String query) async {
    state = state.copyWith(status: SearchStatus.loading);
    try {
      final address = _ref.read(homeActiveAddressProvider).valueOrNull;
      final results = await _ref.read(searchApiProvider).search(
            q: query,
            latitude: address?.latitude,
            longitude: address?.longitude,
          );
      state = state.copyWith(status: SearchStatus.loaded, results: results);
    } catch (_) {
      state = state.copyWith(status: SearchStatus.error);
    }
  }

  void retry() {
    if (state.query.trim().length >= minQueryLength) {
      _runSearch(state.query);
    }
  }
}

final searchControllerProvider =
    StateNotifierProvider.autoDispose<SearchController, SearchState>(
  (ref) => SearchController(ref),
);
