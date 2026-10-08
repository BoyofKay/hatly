/// Mirrors the backend's `GET /customer/loyalty` /
/// `GET /customer/loyalty/transactions` response shapes field-for-field
/// (see `loyalty.controller.ts`). The balance is never derived on the
/// Flutter side from cached transactions — it always comes straight
/// from [LoyaltyBalance], itself always freshly summed server-side
/// from the same append-only ledger these transactions are read from
/// — same discipline as `WalletBalance`/`CustomerWalletTransaction`.
class LoyaltyBalance {
  const LoyaltyBalance({required this.pointsBalance});

  final int pointsBalance;

  factory LoyaltyBalance.fromJson(Map<String, dynamic> json) =>
      LoyaltyBalance(pointsBalance: (json['pointsBalance'] as num).toInt());
}

/// One immutable Loyalty ledger row, exactly as the backend returns it
/// (see `LoyaltyPointsTransaction` entity / `LoyaltyTransactionType`
/// enum). `createdByUserId` (the internal staff actor for an admin
/// adjustment) is deliberately never sent to the customer at all, so
/// there is no field for it here — same discipline as
/// `CustomerWalletTransaction`.
class CustomerLoyaltyTransaction {
  const CustomerLoyaltyTransaction({
    required this.id,
    required this.pointsDelta,
    required this.type,
    required this.createdAt,
    this.orderId,
    this.reason,
  });

  final String id;

  /// Signed — positive is a credit (an order's EARNING, or an ADMIN
  /// adjustment upward), negative is a debit (REDEMPTION/conversion to
  /// Wallet, or an EARNING_REVERSED refund reversal). Never re-derived
  /// or re-signed on this side.
  final int pointsDelta;

  /// One of `LoyaltyTransactionType` (`EARNING`, `EARNING_REVERSED`,
  /// `REDEMPTION`, `ADMIN_ADJUSTMENT`, `EXPIRATION`) — shown via a
  /// small, closed label map in the UI (see `loyalty_screen.dart`),
  /// never displayed raw.
  final String type;
  final DateTime createdAt;
  final String? orderId;
  final String? reason;

  bool get isCredit => pointsDelta > 0;

  factory CustomerLoyaltyTransaction.fromJson(Map<String, dynamic> json) {
    return CustomerLoyaltyTransaction(
      id: json['id'] as String,
      pointsDelta: (json['pointsDelta'] as num).toInt(),
      type: json['type'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      orderId: json['orderId'] as String?,
      reason: json['reason'] as String?,
    );
  }
}

/// One page of the paginated `GET /customer/loyalty/transactions` list
/// — same `{ data, meta: { page, limit, total } }` contract already
/// established by `WalletTransactionPage`; `hasMore` is computed the
/// identical way.
class LoyaltyTransactionPage {
  const LoyaltyTransactionPage({
    required this.transactions,
    required this.page,
    required this.limit,
    required this.total,
  });

  final List<CustomerLoyaltyTransaction> transactions;
  final int page;
  final int limit;
  final int total;

  bool get hasMore => page * limit < total;

  factory LoyaltyTransactionPage.fromJson(Map<String, dynamic> json) {
    final meta = json['meta'] as Map<String, dynamic>;
    return LoyaltyTransactionPage(
      transactions: (json['data'] as List)
          .map((e) => CustomerLoyaltyTransaction.fromJson(
              e as Map<String, dynamic>))
          .toList(),
      page: meta['page'] as int,
      limit: meta['limit'] as int,
      total: meta['total'] as int,
    );
  }
}

/// The result of a successful `POST /customer/loyalty/convert` —
/// mirrors `LoyaltyService.convertPointsToWallet`'s exact return shape
/// (see `loyalty.controller.ts`'s `convert` handler). Both balances are
/// returned by the SAME call so the UI never has to guess/derive them
/// or fire a second round trip just to refresh the numbers it already
/// has an authoritative answer for.
class LoyaltyConversionResult {
  const LoyaltyConversionResult({
    required this.convertedPoints,
    required this.walletCreditMinor,
    required this.pointsBalance,
    required this.walletBalance,
  });

  final int convertedPoints;
  final int walletCreditMinor;
  final int pointsBalance;
  final int walletBalance;

  factory LoyaltyConversionResult.fromJson(Map<String, dynamic> json) {
    return LoyaltyConversionResult(
      convertedPoints: (json['convertedPoints'] as num).toInt(),
      walletCreditMinor: (json['walletCreditMinor'] as num).toInt(),
      pointsBalance: (json['pointsBalance'] as num).toInt(),
      walletBalance: (json['walletBalance'] as num).toInt(),
    );
  }
}
