import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import '../../wallet/data/wallet_providers.dart';
import 'loyalty_api.dart';
import '../domain/loyalty_transaction.dart';

final loyaltyApiProvider =
    Provider<LoyaltyApi>((ref) => LoyaltyApi(ref.watch(apiClientProvider)));

/// The authoritative Loyalty points balance — always freshly read from
/// the server (never derived from
/// [loyaltyTransactionsControllerProvider]'s locally-accumulated
/// pages). Auto-disposed so re-opening Loyalty (or Profile) always
/// shows the current balance, same convention as
/// `walletBalanceProvider`.
final loyaltyBalanceProvider =
    FutureProvider.autoDispose<LoyaltyBalance>((ref) {
  return ref.watch(loyaltyApiProvider).getBalance();
});

/// Loyalty transaction history — page + limit only, no cursor
/// pagination, mirroring `WalletTransactionsController` exactly (same
/// "flatten loaded pages into one growing list, loadMore appends,
/// refresh resets to page 1" shape, same "swallow a load-more failure,
/// keep the already-loaded page visible" discipline).
class LoyaltyTransactionsController
    extends StateNotifier<AsyncValue<List<CustomerLoyaltyTransaction>>> {
  LoyaltyTransactionsController(this._api)
      : super(const AsyncValue.loading()) {
    refresh();
  }

  final LoyaltyApi _api;
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
      // See WalletTransactionsController's own comment — a load-more
      // failure never replaces the already-loaded page with an error
      // state.
    } finally {
      _isLoadingMore = false;
    }
  }
}

final loyaltyTransactionsControllerProvider = StateNotifierProvider<
    LoyaltyTransactionsController,
    AsyncValue<List<CustomerLoyaltyTransaction>>>(
  (ref) => LoyaltyTransactionsController(ref.watch(loyaltyApiProvider)),
);

/// Refreshes both Loyalty AND Wallet balances after a successful
/// conversion — a conversion moves value from one ledger into the
/// other, so both provider caches would otherwise show stale numbers
/// until the customer separately re-opens each screen.
void invalidateLoyaltyAndWalletBalances(WidgetRef ref) {
  ref.invalidate(loyaltyBalanceProvider);
  ref.invalidate(walletBalanceProvider);
}
