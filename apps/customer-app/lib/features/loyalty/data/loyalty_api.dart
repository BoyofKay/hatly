import '../../../core/network/api_client.dart';
import '../domain/loyalty_transaction.dart';

/// Calls the real `GET /customer/loyalty` / `GET
/// /customer/loyalty/transactions` / `POST /customer/loyalty/convert`
/// endpoints (consolidated customer-commerce milestone, Parts C/D —
/// Loyalty V1 + conversion to Hatly Wallet). Mirrors `WalletApi`'s own
/// conventions exactly — ownership is always the authenticated
/// session's token (attached automatically by [ApiClient]); this class
/// never sends a customer id anywhere.
class LoyaltyApi {
  LoyaltyApi(this._client);

  final ApiClient _client;

  Future<LoyaltyBalance> getBalance() {
    return _client.request(
      (dio) => dio.get('/customer/loyalty'),
      (data) => LoyaltyBalance.fromJson(data['data'] as Map<String, dynamic>),
    );
  }

  Future<LoyaltyTransactionPage> getTransactions(
      {int page = 1, int limit = 20}) {
    return _client.request(
      (dio) => dio.get(
        '/customer/loyalty/transactions',
        queryParameters: {'page': page, 'limit': limit},
      ),
      (data) => LoyaltyTransactionPage.fromJson(data as Map<String, dynamic>),
    );
  }

  /// [idempotencyKey] must be generated ONCE per logical conversion
  /// attempt and reused across every retry of that SAME attempt (a
  /// timeout retry, or the customer tapping "try again" after a
  /// transient failure) — never a fresh key per tap. See
  /// `loyalty_screen.dart`'s `_ConvertSheet` for where it's created and
  /// held. This is what makes a lost response (request succeeded
  /// server-side, but the reply never arrived) safe to retry: the
  /// backend recognizes the same key and replays the original result
  /// instead of converting twice.
  Future<LoyaltyConversionResult> convert({
    required int points,
    required String idempotencyKey,
  }) {
    return _client.request(
      (dio) => dio.post(
        '/customer/loyalty/convert',
        data: {'points': points, 'idempotencyKey': idempotencyKey},
      ),
      (data) => LoyaltyConversionResult.fromJson(
          data['data'] as Map<String, dynamic>),
    );
  }
}
