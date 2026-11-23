import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/network/api_client.dart';
import '../../core/network/providers.dart';
import '../earnings/domain/earnings.dart';

int _i(dynamic v) => (v as num?)?.toInt() ?? 0;
DateTime? _d(dynamic v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;

/// Thrown when the server does not have the round-2 overviews yet (older backend): the screens fall back to the previous ones.
class OverviewUnavailable implements Exception {}

class DateRange {
  const DateRange(this.from, this.to);
  final String from; // YYYY-MM-DD (Cairo)
  final String to;
  static DateRange? maybe(dynamic j) => j is Map<String, dynamic> ? DateRange(j['from'] as String, j['to'] as String) : null;
}

/// Driver app round 2 — Orders tab (Today | Previous).
class OrdersKpis {
  const OrdersKpis({required this.completed, required this.cancelled, required this.ignored, required this.accepted, this.acceptanceRatePercent});
  final int completed, cancelled, ignored, accepted;
  final int? acceptanceRatePercent;
}

class OrderRow {
  const OrderRow({required this.deliveryId, required this.orderNumber, required this.status, this.vendors, this.at, this.earnedMinor, this.settlementState, this.settlementReference});
  final String deliveryId, orderNumber, status;
  final String? vendors, settlementState, settlementReference;
  final DateTime? at;
  final int? earnedMinor;
}

class OrdersOverview {
  const OrdersOverview({required this.kpis, required this.items, required this.page, required this.total, this.range});
  final OrdersKpis kpis;
  final List<OrderRow> items;
  final int page, total;
  final DateRange? range;
  bool get hasMore => page * 20 < total;

  factory OrdersOverview.fromJson(Map<String, dynamic> j) {
    final k = j['kpis'] as Map<String, dynamic>;
    return OrdersOverview(
      kpis: OrdersKpis(
        completed: _i(k['completed']),
        cancelled: _i(k['cancelled']),
        ignored: _i(k['ignored']),
        accepted: _i(k['accepted']),
        acceptanceRatePercent: (k['acceptanceRatePercent'] as num?)?.toInt(),
      ),
      items: (j['items'] as List)
          .map((e) => e as Map<String, dynamic>)
          .map((e) => OrderRow(
                deliveryId: e['deliveryId'] as String,
                orderNumber: e['orderNumber'] as String? ?? '',
                status: e['status'] as String? ?? '',
                vendors: e['vendors'] as String?,
                at: _d(e['at']),
                earnedMinor: (e['earnedMinor'] as num?)?.toInt(),
                settlementState: e['settlementState'] as String?,
                settlementReference: e['settlementReference'] as String?,
              ))
          .toList(),
      page: _i(j['page']),
      total: _i(j['total']),
      range: DateRange.maybe(j['range']),
    );
  }
}

/// Earnings tab — Current shift.
class EarningRow {
  const EarningRow({required this.orderNumber, this.deliveredAt, required this.earnedMinor, required this.netMinor, this.breakdown});
  final String orderNumber;
  final DateTime? deliveredAt;
  final int earnedMinor, netMinor;
  final MoneyBreakdown? breakdown;
}

class CurrentEarnings {
  const CurrentEarnings({
    this.shiftStartedAt,
    required this.cashInPocketMinor,
    required this.revenueMinor,
    required this.loanMinor,
    required this.allowanceMinor,
    required this.balanceMinor,
    required this.unsettledOrders,
    required this.items,
    required this.held,
  });
  final DateTime? shiftStartedAt;
  final int cashInPocketMinor, revenueMinor, loanMinor, allowanceMinor, balanceMinor, unsettledOrders;
  final List<EarningRow> items;
  final List<String> held; // order numbers held back (cannot be settled yet)

  factory CurrentEarnings.fromJson(Map<String, dynamic> j) {
    final k = j['kpis'] as Map<String, dynamic>;
    return CurrentEarnings(
      shiftStartedAt: _d(j['shiftStartedAt']),
      cashInPocketMinor: _i(k['cashInPocketMinor']),
      revenueMinor: _i(k['revenueMinor']),
      loanMinor: _i(k['loanMinor']),
      allowanceMinor: _i(k['allowanceMinor']),
      balanceMinor: _i(k['balanceMinor']),
      unsettledOrders: _i(k['unsettledOrders']),
      items: (j['items'] as List)
          .map((e) => e as Map<String, dynamic>)
          .map((e) => EarningRow(
                orderNumber: e['orderNumber'] as String? ?? '',
                deliveredAt: _d(e['deliveredAt']),
                earnedMinor: _i(e['earnedMinor']),
                netMinor: _i(e['netMinor']),
                breakdown: MoneyBreakdown.maybe(e['breakdown']),
              ))
          .toList(),
      held: ((j['held'] as List?) ?? const []).map((e) => (e as Map<String, dynamic>)['orderNumber'] as String? ?? '').toList(),
    );
  }
}

/// Earnings tab — Previous (one row per closing).
class ClosingRow {
  const ClosingRow({
    required this.id,
    this.reference,
    this.closedAt,
    required this.orders,
    required this.minutesWorked,
    required this.revenueMinor,
    required this.netMinor,
    required this.allowanceReturnedMinor,
    required this.remainingMinor,
    required this.paymentStatus,
    this.breakdown,
  });
  final String id;
  final String? reference;
  final DateTime? closedAt;
  final int orders, minutesWorked, revenueMinor, netMinor, allowanceReturnedMinor, remainingMinor;
  final String paymentStatus;
  final MoneyBreakdown? breakdown;
}

class PreviousEarnings {
  const PreviousEarnings({required this.revenueMinor, required this.orders, required this.minutesWorked, required this.items, this.range});
  final int revenueMinor, orders, minutesWorked;
  final List<ClosingRow> items;
  final DateRange? range;

  factory PreviousEarnings.fromJson(Map<String, dynamic> j) {
    final k = j['kpis'] as Map<String, dynamic>;
    return PreviousEarnings(
      revenueMinor: _i(k['revenueMinor']),
      orders: _i(k['orders']),
      minutesWorked: _i(k['minutesWorked']),
      range: DateRange.maybe(j['range']),
      items: (j['items'] as List)
          .map((e) => e as Map<String, dynamic>)
          .map((e) => ClosingRow(
                id: e['id'] as String,
                reference: e['reference'] as String?,
                closedAt: _d(e['closedAt']),
                orders: _i(e['orders']),
                minutesWorked: _i(e['minutesWorked']),
                revenueMinor: _i(e['revenueMinor']),
                netMinor: _i(e['netMinor']),
                allowanceReturnedMinor: _i(e['allowanceReturnedMinor']),
                remainingMinor: _i(e['remainingMinor']),
                paymentStatus: e['paymentStatus'] as String? ?? '',
                breakdown: MoneyBreakdown.maybe(e['breakdown']),
              ))
          .toList(),
    );
  }
}

class OverviewApi {
  OverviewApi(this._client);
  final ApiClient _client;

  Future<Map<String, dynamic>> _get(String path, Map<String, dynamic> query) async {
    try {
      final r = await _client.dio.get(path, queryParameters: query..removeWhere((_, v) => v == null || v == ''));
      return r.data['data'] as Map<String, dynamic>;
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) throw OverviewUnavailable();
      rethrow;
    }
  }

  Future<OrdersOverview> orders({required String tab, String? from, String? to, String? status, String? search, int page = 1}) async =>
      OrdersOverview.fromJson(await _get('/driver/orders/overview', {'tab': tab, 'from': from, 'to': to, 'status': status, 'q': search, 'page': page}));

  Future<CurrentEarnings> currentEarnings() async => CurrentEarnings.fromJson(await _get('/driver/earnings/overview', {'tab': 'current'}));

  Future<PreviousEarnings> previousEarnings({String? from, String? to, String? status}) async =>
      PreviousEarnings.fromJson(await _get('/driver/earnings/overview', {'tab': 'previous', 'from': from, 'to': to, 'status': status}));

  /// "Forgot password?" — asks Hatly operations for a temporary password. The server answers the same for any phone.
  Future<void> requestPasswordReset(String phone) async {
    await _client.dio.post('/auth/password-reset/request', data: {'phone': phone});
  }

  /// Completes it (owner decision 2026-11-23): the temporary password Operations gave + a new password, on the same screen.
  /// Throws [DioException]; the refusal code is TEMP_PASSWORD_INVALID (with attemptsLeft), TEMP_PASSWORD_EXPIRED, TEMP_PASSWORD_LOCKED,
  /// WEAK_PASSWORD or PASSWORD_UNCHANGED.
  Future<void> completePasswordReset(String phone, String tempPassword, String newPassword) async {
    await _client.dio.post('/auth/password-reset/complete', data: {'phone': phone, 'tempPassword': tempPassword, 'newPassword': newPassword});
  }
}

final overviewApiProvider = Provider<OverviewApi>((ref) => OverviewApi(ref.watch(apiClientProvider)));
