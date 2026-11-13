// What the platform has recorded about the driver's money (`GET driver/earnings`, `GET driver/transactions`). All amounts are whole minor
// units; NOTHING here is computed by the app — the backend computes every figure with the same code the Admin courier closing uses
// (COD and electronic orders kept apart). Fields added on 2026-11-13 are optional, so an older backend never crashes the app, and periods
// closed before then carry no breakdown (shown as stored, marked legacy).

int _i(dynamic v) => (v as num?)?.toInt() ?? 0;

/// The money parts of one order or one period, as the backend computed them (one value each — never combined).
class MoneyBreakdown {
  const MoneyBreakdown({
    required this.feeEntitlementMinor,
    required this.commissionMinor,
    required this.courierCompensationMinor,
    required this.goodsPaidToStoresMinor,
    required this.goodsPassThroughMinor,
    required this.goodsReimbursementMinor,
    required this.cashCollectedMinor,
    required this.cashHeldMinor,
    required this.changeKeptMinor,
    required this.netToCourierMinor,
    this.paymentFlow,
  });

  /// 'COD' or 'ELECTRONIC' for one order; null for a period total.
  final String? paymentFlow;
  final int feeEntitlementMinor;
  final int commissionMinor;
  final int courierCompensationMinor;
  final int goodsPaidToStoresMinor;

  /// COD: goods collected from the customer and paid to the store — shown for reconciliation, EXCLUDED from the net.
  final int goodsPassThroughMinor;

  /// Goods Hatly owes back to the courier (electronic orders, or the non-cash part of a COD order).
  final int goodsReimbursementMinor;
  final int cashCollectedMinor;

  /// Cash still with the courier after paying the stores (normally the delivery fee) — set against his compensation, never paid again.
  final int cashHeldMinor;
  final int changeKeptMinor;

  /// > 0: Hatly owes the courier; < 0: the courier owes Hatly.
  final int netToCourierMinor;

  bool get isCod => paymentFlow == 'COD';

  static MoneyBreakdown? maybe(dynamic j) {
    if (j is! Map<String, dynamic>) return null;
    return MoneyBreakdown(
      paymentFlow: j['paymentFlow'] as String?,
      feeEntitlementMinor: _i(j['feeEntitlementMinor']),
      commissionMinor: _i(j['commissionMinor']),
      courierCompensationMinor: _i(j['courierCompensationMinor']),
      goodsPaidToStoresMinor: _i(j['goodsPaidToStoresMinor']),
      goodsPassThroughMinor: _i(j['goodsPassThroughMinor']),
      goodsReimbursementMinor: _i(j['goodsReimbursementMinor']),
      cashCollectedMinor: _i(j['cashCollectedMinor']),
      cashHeldMinor: _i(j['cashHeldMinor']),
      changeKeptMinor: _i(j['changeKeptMinor']),
      netToCourierMinor: _i(j['netToCourierMinor']),
    );
  }
}

/// A delivered order that cannot be settled yet, and why (shown so the driver knows what is pending and why).
class ExcludedOrder {
  const ExcludedOrder({required this.orderNumber, required this.reason});
  final String orderNumber;
  final String reason;
  factory ExcludedOrder.fromJson(Map<String, dynamic> j) => ExcludedOrder(orderNumber: j['orderNumber'] as String? ?? '', reason: j['reason'] as String? ?? '');
}

class OpenPeriod {
  const OpenPeriod({
    required this.periodStart,
    required this.deliveries,
    required this.earningsMinor,
    required this.commissionMinor,
    required this.reimbursementsMinor,
    required this.netMinor,
    this.breakdown,
    this.excluded = const [],
    this.inProgress = 0,
  });
  final DateTime? periodStart;
  final int deliveries;
  final int earningsMinor;
  final int commissionMinor;
  final int reimbursementsMinor;
  final int netMinor;

  /// Null from an older backend (then only the four legacy figures exist).
  final MoneyBreakdown? breakdown;
  final List<ExcludedOrder> excluded;
  final int inProgress;

  factory OpenPeriod.fromJson(Map<String, dynamic> j) => OpenPeriod(
        periodStart: j['periodStart'] == null ? null : DateTime.tryParse(j['periodStart'] as String),
        deliveries: _i(j['deliveries']),
        earningsMinor: _i(j['earningsMinor']),
        commissionMinor: _i(j['commissionMinor']),
        reimbursementsMinor: _i(j['reimbursementsMinor']),
        netMinor: _i(j['netMinor']),
        breakdown: MoneyBreakdown.maybe(j['breakdown']),
        excluded: ((j['excluded'] as List?) ?? const []).map((e) => ExcludedOrder.fromJson(e as Map<String, dynamic>)).toList(),
        inProgress: _i(j['inProgress']),
      );
}

class SettlementPayment {
  const SettlementPayment({required this.direction, required this.amountMinor, required this.method, required this.paidOn, required this.status});
  final String direction;
  final int amountMinor;
  final String method;
  final DateTime? paidOn;
  final String status;

  factory SettlementPayment.fromJson(Map<String, dynamic> j) => SettlementPayment(
        direction: j['direction'] as String? ?? '',
        amountMinor: _i(j['amountMinor']),
        method: j['method'] as String? ?? '',
        paidOn: j['paidOn'] == null ? null : DateTime.tryParse(j['paidOn'] as String),
        status: j['status'] as String? ?? '',
      );
}

class ClosedPeriod {
  const ClosedPeriod({
    required this.id,
    required this.frequency,
    required this.periodStart,
    required this.periodEnd,
    required this.earningsMinor,
    required this.commissionMinor,
    required this.reimbursementsMinor,
    required this.netMinor,
    required this.payments,
    this.reference,
    this.methodVersion = 1,
    this.breakdown,
    this.settledMinor,
    this.remainingMinor,
  });
  final String id;
  final String frequency;
  final DateTime periodStart;
  final DateTime periodEnd;
  final int earningsMinor;
  final int commissionMinor;
  final int reimbursementsMinor;
  final int netMinor;
  final List<SettlementPayment> payments;
  final String? reference;

  /// 1 = closed before 2026-11-13 (legacy totals, shown as stored); 2 = closed by orders (full breakdown).
  final int methodVersion;
  final MoneyBreakdown? breakdown;
  final int? settledMinor;
  final int? remainingMinor;
  bool get isLegacy => methodVersion != 2;

  factory ClosedPeriod.fromJson(Map<String, dynamic> j) => ClosedPeriod(
        id: j['id'] as String,
        frequency: j['frequency'] as String? ?? '',
        periodStart: DateTime.parse(j['periodStart'] as String),
        periodEnd: DateTime.parse(j['periodEnd'] as String),
        earningsMinor: _i(j['earningsMinor']),
        commissionMinor: _i(j['commissionMinor']),
        reimbursementsMinor: _i(j['reimbursementsMinor']),
        netMinor: _i(j['netMinor']),
        payments: ((j['payments'] as List?) ?? const []).map((e) => SettlementPayment.fromJson(e as Map<String, dynamic>)).toList(),
        reference: j['reference'] as String?,
        methodVersion: _i(j['methodVersion']) == 2 ? 2 : 1,
        breakdown: MoneyBreakdown.maybe(j['breakdown']),
        settledMinor: (j['settledMinor'] as num?)?.toInt(),
        remainingMinor: (j['remainingMinor'] as num?)?.toInt(),
      );
}

class DriverEarnings {
  const DriverEarnings({required this.open, required this.deliveredToday, required this.closedPeriods});
  final OpenPeriod open;
  final int deliveredToday;
  final List<ClosedPeriod> closedPeriods;

  factory DriverEarnings.fromJson(Map<String, dynamic> j) => DriverEarnings(
        open: OpenPeriod.fromJson(j['open'] as Map<String, dynamic>),
        deliveredToday: _i(j['deliveredToday']),
        closedPeriods: ((j['closedPeriods'] as List?) ?? const []).map((e) => ClosedPeriod.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

/// One delivered order in the driver's history, with its money state.
class DriverTransaction {
  const DriverTransaction({
    required this.id,
    required this.at,
    required this.orderId,
    required this.orderNumber,
    required this.paymentMethod,
    required this.cashDueAtDoorMinor,
    required this.earningsMinor,
    required this.commissionMinor,
    required this.reimbursementMinor,
    required this.netMinor,
    this.deliveryId,
    this.vendors,
    this.orderTotalMinor,
    this.settlementState,
    this.settlementReference,
    this.excludedReason,
    this.breakdown,
  });
  final String id;
  final DateTime at;
  final String orderId;
  final String orderNumber;
  final String paymentMethod;

  /// What the customer owed at the door for a cash order — a fact about the delivery, not a balance. Null for non-cash orders.
  final int? cashDueAtDoorMinor;
  final int earningsMinor;
  final int commissionMinor;
  final int reimbursementMinor;
  final int netMinor;

  /// The delivery to open (older backends: null — then the row opens nothing rather than a wrong screen).
  final String? deliveryId;
  final String? vendors;
  final int? orderTotalMinor;

  /// SETTLED / PENDING / EXCLUDED / LEGACY_SETTLED (null from an older backend).
  final String? settlementState;
  final String? settlementReference;
  final String? excludedReason;
  final MoneyBreakdown? breakdown;

  factory DriverTransaction.fromJson(Map<String, dynamic> j) => DriverTransaction(
        id: j['id'] as String,
        at: DateTime.tryParse((j['at'] ?? j['deliveredAt'] ?? '') as String) ?? DateTime.fromMillisecondsSinceEpoch(0),
        orderId: j['orderId'] as String,
        orderNumber: j['orderNumber'] as String? ?? '',
        paymentMethod: j['paymentMethod'] as String? ?? '',
        cashDueAtDoorMinor: (j['cashDueAtDoorMinor'] as num?)?.toInt(),
        earningsMinor: _i(j['earningsMinor']),
        commissionMinor: _i(j['commissionMinor']),
        reimbursementMinor: _i(j['reimbursementMinor']),
        netMinor: _i(j['netMinor']),
        deliveryId: j['deliveryId'] as String?,
        vendors: j['vendors'] as String?,
        orderTotalMinor: (j['orderTotalMinor'] as num?)?.toInt(),
        settlementState: j['settlementState'] as String?,
        settlementReference: j['settlementReference'] as String?,
        excludedReason: j['excludedReason'] as String?,
        breakdown: MoneyBreakdown.maybe(j['breakdown']),
      );
}

class TransactionsPage {
  const TransactionsPage({required this.items, required this.page, required this.limit, required this.total});
  final List<DriverTransaction> items;
  final int page;
  final int limit;
  final int total;
  bool get hasMore => page * limit < total;
}
