import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/earnings/domain/earnings.dart';
import 'package:hatly_driver/features/overview/earnings_tabs_screen.dart';
import 'package:hatly_driver/features/overview/orders_screen.dart';
import 'package:hatly_driver/features/overview/overview_api.dart';
import 'package:hatly_driver/features/shift/shift_api.dart';

/// Driver app round 2 (owner decision 2026-11-22): Orders (Today | Previous) and Earnings (Current shift | Previous) with KPIs.
class _Api implements OverviewApi {
  @override
  Future<String> driverProfileName() async => 'Test Driver';

  final calls = <String>[];
  bool unavailable = false;
  @override
  Future<OrdersOverview> orders({required String tab, String? from, String? to, String? status, String? search, int page = 1}) async {
    calls.add('orders:$tab:${status ?? '-'}:${search ?? ''}');
    if (unavailable) throw OverviewUnavailable();
    final today = tab == 'today';
    return OrdersOverview(
      kpis: OrdersKpis(completed: today ? 3 : 12, cancelled: 1, ignored: 1, accepted: 3, acceptanceRatePercent: 75),
      items: [
        OrderRow(deliveryId: 'd1', orderNumber: today ? 'HT-100' : 'HT-090', status: 'DELIVERED', vendors: 'Tarweqa', at: DateTime(2026, 11, 23, 13, 5), earnedMinor: 2500, settlementState: today ? 'PENDING' : 'SETTLED'),
      ],
      page: 1,
      total: 1,
      range: today ? null : const DateRange('2026-11-21', '2026-11-27'),
    );
  }

  @override
  Future<CurrentEarnings> currentEarnings() async {
    calls.add('current');
    if (unavailable) throw OverviewUnavailable();
    return CurrentEarnings(
      shiftStartedAt: DateTime(2026, 11, 23, 9, 0),
      cashInPocketMinor: 4000,
      revenueMinor: 7500,
      loanMinor: 10000,
      allowanceMinor: 50000,
      balanceMinor: -47000,
      unsettledOrders: 3,
      items: const [
        EarningRow(
          orderNumber: 'HT-100',
          earnedMinor: 2500,
          netMinor: 3000,
          breakdown: MoneyBreakdown(paymentFlow: null, feeEntitlementMinor: 3000, commissionMinor: 500, courierCompensationMinor: 2500, goodsPaidToStoresMinor: 0, goodsPassThroughMinor: 0, goodsReimbursementMinor: 500, cashCollectedMinor: 0, cashHeldMinor: 0, changeKeptMinor: 0, netToCourierMinor: 3000),
        ),
      ],
      held: const [],
    );
  }

  @override
  Future<PreviousEarnings> previousEarnings({String? from, String? to, String? status}) async {
    calls.add('previous:${status ?? '-'}');
    return const PreviousEarnings(
      revenueMinor: 30000,
      orders: 12,
      minutesWorked: 545,
      range: DateRange('2026-11-21', '2026-11-27'),
      items: [ClosingRow(id: 'p1', reference: 'CS-20261122-ABC123', orders: 12, minutesWorked: 545, revenueMinor: 30000, netMinor: 1000, allowanceReturnedMinor: 50000, remainingMinor: 0, paymentStatus: 'PAID')],
    );
  }

  @override
  Future<void> requestPasswordReset(String phone) async {}
  @override
  Future<void> completePasswordReset(String phone, String tempPassword, String newPassword) async {}
}

Future<void> _pump(WidgetTester tester, _Api api, Widget screen) async {
  tester.view.physicalSize = const Size(420, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(overrides: [overviewApiProvider.overrideWithValue(api), shiftStateProvider.overrideWith((ref) async => null)], child: MaterialApp(home: screen)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Current shift quick filters and search; History has concluded shifts only', (tester) async {
    final api = _Api();
    await _pump(tester, api, Scaffold(body: ShiftOrdersList(tab: 'today', onUnavailable: () {})));
    expect(find.text('HT-100'), findsOneWidget);
    expect(find.text('3 / 1 · 75%'), findsNothing);
    expect(find.text('25.00 EGP'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('orders-search-today')), 'tarw');
    await tester.pump(const Duration(milliseconds: 500));
    await tester.pumpAndSettle();
    expect(api.calls, contains('orders:today:-:tarw'));
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    await _pump(tester, api, const OrdersScreen());
    expect(find.text('HT-090'), findsOneWidget);
    expect(find.textContaining('21/11 – 27/11'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
    expect(find.byKey(const Key('orders-tab-today')), findsNothing);
  });

  testWidgets('Current shift: status filter reaches the server', (tester) async {
    final api = _Api();
    await _pump(tester, api, Scaffold(body: ShiftOrdersList(tab: 'today', onUnavailable: () {})));
    await tester.tap(find.byKey(const Key('orders-filter-today')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('orders-status-cancelled')));
    await tester.tap(find.byKey(const Key('orders-filter-apply')));
    await tester.pumpAndSettle();
    expect(api.calls.last, 'orders:today:cancelled:');
    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
  });

  testWidgets('Earnings: current shift KPIs (allowance, balance, unsettled) and an expandable order; previous closings', (tester) async {
    final api = _Api();
    await _pump(tester, api, const EarningsTabsScreen());
    expect(find.text('500.00 EGP'), findsNothing); // collapsed by default
    expect(find.text('Current wallet balance'), findsOneWidget);
    await tester.tap(find.byKey(const Key('earnings-kpi-toggle')));
    await tester.pumpAndSettle();
    expect(find.text('500.00 EGP'), findsOneWidget); // daily allowance
    expect(find.text('470.00 EGP'), findsWidgets); // balance — he hands it over
    expect(find.text('Balance — you hand over'), findsOneWidget);
    expect(find.text('3'), findsOneWidget); // unsettled orders
    expect(find.byKey(const Key('mb-fee')), findsNothing);
    await tester.tap(find.byKey(const Key('earning-row-HT-100')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('mb-fee')), findsOneWidget);

    await tester.tap(find.byKey(const Key('earnings-tab-previous')));
    await tester.pumpAndSettle();
    expect(find.text('CS-20261122-ABC123'), findsOneWidget);
    expect(find.text('9 h 5 min'), findsWidgets);
  });

  testWidgets('older server (no overview endpoints) → the previous screens are shown, not an error', (tester) async {
    final api = _Api()..unavailable = true;
    await tester.pumpWidget(ProviderScope(overrides: [overviewApiProvider.overrideWithValue(api), shiftStateProvider.overrideWith((ref) async => null)], child: const MaterialApp(home: OrdersScreen())));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.byKey(const Key('orders-tab-today')), findsNothing); // the previous History screen took over
    expect(find.byType(OrdersScreen), findsOneWidget);
  });
}
