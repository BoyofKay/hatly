/// What the platform has recorded about the driver's money (`GET driver/earnings`, `GET driver/transactions`). All amounts are whole minor
/// units; nothing here is computed by the app — the open period is the server's preview, closed periods are as stored.
class OpenPeriod {
  const OpenPeriod({required this.periodStart, required this.deliveries, required this.earningsMinor, required this.commissionMinor, required this.reimbursementsMinor, required this.netMinor});
  final DateTime? periodStart;
  final int deliveries;
  final int earningsMinor;
  final int commissionMinor;
  final int reimbursementsMinor;
  final int netMinor;

  factory OpenPeriod.fromJson(Map<String, dynamic> j) => OpenPeriod(
        periodStart: j['periodStart'] == null ? null : DateTime.parse(j['periodStart'] as String),
        deliveries: (j['deliveries'] as num).toInt(),
        earningsMinor: (j['earningsMinor'] as num).toInt(),
        commissionMinor: (j['commissionMinor'] as num).toInt(),
        reimbursementsMinor: (j['reimbursementsMinor'] as num).toInt(),
        netMinor: (j['netMinor'] as num).toInt(),
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
        amountMinor: (j['amountMinor'] as num?)?.toInt() ?? 0,
        method: j['method'] as String? ?? '',
        paidOn: j['paidOn'] == null ? null : DateTime.tryParse(j['paidOn'] as String),
        status: j['status'] as String? ?? '',
      );
}

class ClosedPeriod {
  const ClosedPeriod({required this.id, required this.frequency, required this.periodStart, required this.periodEnd, required this.earningsMinor, required this.commissionMinor, required this.reimbursementsMinor, required this.netMinor, required this.payments});
  final String id;
  final String frequency;
  final DateTime periodStart;
  final DateTime periodEnd;
  final int earningsMinor;
  final int commissionMinor;
  final int reimbursementsMinor;
  final int netMinor;
  final List<SettlementPayment> payments;

  factory ClosedPeriod.fromJson(Map<String, dynamic> j) => ClosedPeriod(
        id: j['id'] as String,
        frequency: j['frequency'] as String? ?? '',
        periodStart: DateTime.parse(j['periodStart'] as String),
        periodEnd: DateTime.parse(j['periodEnd'] as String),
        earningsMinor: (j['earningsMinor'] as num).toInt(),
        commissionMinor: (j['commissionMinor'] as num).toInt(),
        reimbursementsMinor: (j['reimbursementsMinor'] as num).toInt(),
        netMinor: (j['netMinor'] as num).toInt(),
        payments: ((j['payments'] as List?) ?? const []).map((e) => SettlementPayment.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

class DriverEarnings {
  const DriverEarnings({required this.open, required this.deliveredToday, required this.closedPeriods});
  final OpenPeriod open;
  final int deliveredToday;
  final List<ClosedPeriod> closedPeriods;

  factory DriverEarnings.fromJson(Map<String, dynamic> j) => DriverEarnings(
        open: OpenPeriod.fromJson(j['open'] as Map<String, dynamic>),
        deliveredToday: (j['deliveredToday'] as num?)?.toInt() ?? 0,
        closedPeriods: ((j['closedPeriods'] as List?) ?? const []).map((e) => ClosedPeriod.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

class DriverTransaction {
  const DriverTransaction({required this.id, required this.at, required this.orderId, required this.orderNumber, required this.paymentMethod, required this.cashDueAtDoorMinor, required this.earningsMinor, required this.commissionMinor, required this.reimbursementMinor, required this.netMinor});
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

  factory DriverTransaction.fromJson(Map<String, dynamic> j) => DriverTransaction(
        id: j['id'] as String,
        at: DateTime.parse(j['at'] as String),
        orderId: j['orderId'] as String,
        orderNumber: j['orderNumber'] as String? ?? '',
        paymentMethod: j['paymentMethod'] as String? ?? '',
        cashDueAtDoorMinor: (j['cashDueAtDoorMinor'] as num?)?.toInt(),
        earningsMinor: (j['earningsMinor'] as num).toInt(),
        commissionMinor: (j['commissionMinor'] as num).toInt(),
        reimbursementMinor: (j['reimbursementMinor'] as num).toInt(),
        netMinor: (j['netMinor'] as num).toInt(),
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
