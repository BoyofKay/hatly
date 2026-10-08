import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'wallet_api.dart';
import '../domain/wallet_transaction.dart';

final walletApiProvider =
    Provider<WalletApi>((ref) => WalletApi(ref.watch(apiClientProvider)));

/// The authoritative Wallet balance — always freshly read from the
/// server (never derived from [walletTransactionsControllerProvider]'s
/// locally-accumulated pages). Auto-disposed so re-opening Wallet (or
/// Profile) always shows the current balance, same convention as
/// `orderDetailsProvider`.
final walletBalanceProvider =
    FutureProvider.autoDispose<WalletBalance>((ref) {
  return ref.watch(walletApiProvider).getBalance();
});

/// Wallet transaction history — page + limit only, no cursor
/// pagination, mirroring `OrderHistoryController` exactly (same
/// "flatten loaded pages into one growing list, loadMore appends,
/// refresh resets to page 1" shape, same "swallow a load-more failure,
/// keep the already-loaded page visible" discipline).
class WalletTransactionsController
    extends StateNotifier<AsyncValue<List<CustomerWalletTransaction>>> {
  WalletTransactionsController(this._api)
      : super(const AsyncValue.loading()) {
    refresh();
  }

  final WalletApi _api;
  static const _limit = 20;

  int _page = 1;
  bool _hasMore = true;
  bool _isLoadingMore = false;

  bool get hasMore => _hasMore;

  Future<void> refresh() async {
    _page = 1;
    state = const AsyncValue.loading();
    try {
      final result = await _api.getTransactions(page: _page, limit: _limit);
      _hasMore = result.hasMore;
      state = AsyncValue.data(result.transactions);
    } catch (error, stackTrace) {
      state = AsyncValue.error(error, stackTrace);
    }
  }

  Future<void> loadMore() async {
    if (_isLoadingMore || !_hasMore) return;
    final current = state.valueOrNull;
    if (current == null) return;

    _isLoadingMore = true;
    try {
      final nextPage = _page + 1;
      final result =
          await _api.getTransactions(page: nextPage, limit: _limit);
      _page = nextPage;
      _hasMore = result.hasMore;
      state = AsyncValue.data([...current, ...result.transactions]);
    } catch (_) {
      // See OrderHistoryController's own comment — a load-more failure
      // never replaces the already-loaded page with an error state.
    } finally {
      _isLoadingMore = false;
    }
  }
}

final walletTransactionsControllerProvider = StateNotifierProvider<
    WalletTransactionsController,
    AsyncValue<List<CustomerWalletTransaction>>>(
  (ref) => WalletTransactionsController(ref.watch(walletApiProvider)),
);
