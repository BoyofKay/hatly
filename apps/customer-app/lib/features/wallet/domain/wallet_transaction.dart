/// Mirrors the backend's `GET /customer/wallet` /
/// `GET /customer/wallet/transactions` response shapes field-for-field
/// (see `customer-wallet.controller.ts` / `wallet.service.ts`). The
/// balance is never derived on the Flutter side from cached
/// transactions — it always comes straight from [WalletBalance],
/// itself always freshly summed server-side from the same immutable
/// ledger these transactions are read from.
class WalletBalance {
  const WalletBalance({required this.balanceMinor});

  final int balanceMinor;

  factory WalletBalance.fromJson(Map<String, dynamic> json) =>
      WalletBalance(balanceMinor: (json['balanceMinor'] as num).toInt());
}

/// One immutable Wallet ledger row, exactly as the backend returns it
/// (see `WalletTransaction` entity / `WalletTransactionType` enum) —
/// `createdByUserId` (the internal staff actor for an admin credit) is
/// deliberately never sent to the customer at all, so there is no
/// field for it here.
class CustomerWalletTransaction {
  const CustomerWalletTransaction({
    required this.id,
    required this.amountDeltaMinor,
    required this.type,
    required this.createdAt,
    this.orderId,
    this.reason,
  });

  final String id;

  /// Signed — positive is a credit (refund, admin credit, loyalty
  /// redemption, ...), negative is a debit (order payment,
  /// expiration). Never re-derived or re-signed on this side.
  final int amountDeltaMinor;

  /// One of `WalletTransactionType` (`ORDER_PAYMENT`, `ORDER_REFUND`,
  /// `ADMIN_CREDIT`, `LOYALTY_REDEMPTION`, `DRIVER_CASH_REMAINDER`,
  /// `ADJUSTMENT`, `EXPIRATION`) — shown via a small, closed label map
  /// in the UI (see `wallet_screen.dart`), never displayed raw.
  final String type;
  final DateTime createdAt;
  final String? orderId;
  final String? reason;

  bool get isCredit => amountDeltaMinor > 0;

  factory CustomerWalletTransaction.fromJson(Map<String, dynamic> json) {
    return CustomerWalletTransaction(
      id: json['id'] as String,
      amountDeltaMinor: (json['amountDeltaMinor'] as num).toInt(),
      type: json['type'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      orderId: json['orderId'] as String?,
      reason: json['reason'] as String?,
    );
  }
}

/// One page of the paginated `GET /customer/wallet/transactions` list —
/// same `{ data, meta: { page, limit, total } }` contract already
/// established by `OrderHistoryPage` (Customer Order History); `hasMore`
/// is computed the identical way.
class WalletTransactionPage {
  const WalletTransactionPage({
    required this.transactions,
    required this.page,
    required this.limit,
    required this.total,
  });

  final List<CustomerWalletTransaction> transactions;
  final int page;
  final int limit;
  final int total;

  bool get hasMore => page * limit < total;

  factory WalletTransactionPage.fromJson(Map<String, dynamic> json) {
    final meta = json['meta'] as Map<String, dynamic>;
    return WalletTransactionPage(
      transactions: (json['data'] as List)
          .map((e) =>
              CustomerWalletTransaction.fromJson(e as Map<String, dynamic>))
          .toList(),
      page: meta['page'] as int,
      limit: meta['limit'] as int,
      total: meta['total'] as int,
    );
  }
}
