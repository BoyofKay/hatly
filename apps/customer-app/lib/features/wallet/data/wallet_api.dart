import '../../../core/network/api_client.dart';
import '../domain/wallet_transaction.dart';

/// Calls the real `GET /customer/wallet` / `GET
/// /customer/wallet/transactions` endpoints (Profile — Wallet). The
/// first public read of the pre-existing Wallet ledger
/// (`WalletService`, previously only read internally by checkout/order
/// refund) — no second financial model, no client-side balance
/// calculation. Ownership is always the authenticated session's token
/// (attached automatically by [ApiClient]) — this class never sends a
/// customer id anywhere, mirroring `OrdersApi`'s own convention exactly.
class WalletApi {
  WalletApi(this._client);

  final ApiClient _client;

  Future<WalletBalance> getBalance() {
    return _client.request(
      (dio) => dio.get('/customer/wallet'),
      (data) => WalletBalance.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<WalletTransactionPage> getTransactions({int page = 1, int limit = 20}) {
    return _client.request(
      (dio) => dio.get(
        '/customer/wallet/transactions',
        queryParameters: {'page': page, 'limit': limit},
      ),
      (data) => WalletTransactionPage.fromJson(data as Map<String, dynamic>),
    );
  }
}
