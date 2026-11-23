import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_driver/core/localization/bilingual.dart';
import 'package:hatly_driver/core/network/providers.dart';
import 'package:hatly_driver/core/storage/token_storage.dart';
import 'package:hatly_driver/features/deliveries/data/driver_api.dart';
import 'package:hatly_driver/features/deliveries/data/driver_providers.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/features/deliveries/presentation/delivery_detail_screen.dart';
import 'package:hatly_driver/features/deliveries/presentation/driver_location_service.dart';
import 'package:hatly_driver/features/earnings/domain/earnings.dart';
import 'package:hatly_driver/features/earnings/presentation/earnings_screen.dart';
import 'package:hatly_driver/features/history/presentation/history_screen.dart';
import 'package:hatly_driver/features/profile/presentation/profile_screen.dart';
import 'package:hatly_driver/features/shell/driver_shell.dart';

const _delegates = [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate];

class _Api implements DriverApi {
  @override
  Future<bool?> getOnlineStatus() async => null;
  @override
  Future<String?> getProfileName() async => 'Test driver';
  @override
  Future<Delivery> acknowledgeDelivery(String id) async => throw UnimplementedError();

  @override
  Future<String?> getOperationsPhone() async => null;

  _Api({Delivery? delivery}) : delivery = delivery ?? _delivery();
  Delivery delivery;
  DriverEarnings? earnings;
  final List<TransactionsPage> pages = [];
  final List<TransactionsPage> previousPages = [];
  final pagesRequested = <int>[];
  final scopesRequested = <String?>[];
  final statusCalls = <String>[];
  final purchaseCalls = <int>[];
  /// When set, updateDeliveryStatus applies the change (or not) and then throws this.
  DioException? statusError;
  bool applyBeforeError = false;

  @override
  Future<Delivery> getDelivery(String id) async => delivery;
  @override
  Future<List<Delivery>> listDeliveries() async => [delivery];
  @override
  Future<DriverEarnings> getEarnings() async => earnings!;
  @override
  Future<TransactionsPage> getTransactions({int page = 1, int limit = 20, String? scope}) async {
    pagesRequested.add(page);
    scopesRequested.add(scope);
    return scope == 'previous' && previousPages.isNotEmpty ? previousPages[page - 1] : pages[page - 1];
  }

  @override
  Future<void> updateDeliveryStatus(String deliveryId, String status, {DriverFailedDeliveryReason? failureReason, String? proofPhotoUrl, String? recipientName}) async {
    statusCalls.add(status);
    if (statusError != null) {
      if (applyBeforeError) delivery = _delivery(status: status);
      throw statusError!;
    }
    delivery = _delivery(status: status);
  }

  @override
  Future<void> recordPurchaseAmount(String orderItemId, int amountMinor) async => purchaseCalls.add(amountMinor);
  @override
  Future<void> recordWeight(String orderItemId, int weightGrams) async {}
  @override
  Future<void> setOnlineStatus(bool isOnline) async {}
  @override
  Future<void> updateLocation({required double latitude, required double longitude}) async {}
  @override
  Future<String> uploadProofPhoto(List<int> bytes, String filename) async => 'https://x/y.jpg';
  @override
  Future<void> submitCashRemainder(String deliveryId, int cashReceivedMinor) async {}
  @override
  Future<T> retryTransient<T>(Future<T> Function() op, {int attempts = 3, Duration pause = const Duration(milliseconds: 800)}) => op();
}

// R16: these tests exercise the steps AFTER the driver confirmed having seen the order (an unacknowledged one offers only that button).
Delivery _delivery({String status = 'ASSIGNED_TO_DRIVER'}) => Delivery(
      acknowledgedAt: DateTime(2026, 11, 6, 12),
      id: 'd1',
      orderId: 'o1',
      orderNumber: 'HT-1001',
      orderStatus: status,
      fulfillmentType: 'DELIVERY',
      paymentMethod: 'COD',
      totalMinor: 10000,
      amountDueMinor: 10000,
      customerName: 'Jane',
      deliveryAddress: const DeliveryAddress(line1: '12 Market St', latitude: 30.1, longitude: 31.2),
      segments: const [
        DeliverySegment(id: 's1', groupType: 'VENDOR', status: 'READY', vendorBranchName: 'Branch A', vendorNoteSnapshot: 'Ask for Sami', items: [
          DeliverySegmentItem(id: 'i-adhoc', quantity: 1, optionsSnapshot: [], freeTextDescriptionSnapshot: 'Medicine', imageUrlsSnapshot: []),
        ]),
      ],
    );

DriverEarnings _earnings() => DriverEarnings(
      open: const OpenPeriod(periodStart: null, deliveries: 3, earningsMinor: 9000, commissionMinor: 1500, reimbursementsMinor: 2000, netMinor: 9500),
      deliveredToday: 2,
      closedPeriods: [
        ClosedPeriod(id: 'p1', frequency: 'WEEKLY', periodStart: DateTime.utc(2026, 10, 1), periodEnd: DateTime.utc(2026, 10, 8), earningsMinor: 5000, commissionMinor: 500, reimbursementsMinor: 0, netMinor: 4500, payments: [
          SettlementPayment(direction: 'PAYOUT', amountMinor: 4500, method: 'CASH', paidOn: DateTime.utc(2026, 10, 9), status: 'RECORDED'),
        ]),
      ],
    );

DriverTransaction _tx(String id, int net) => DriverTransaction(id: id, at: DateTime.utc(2026, 10, 5, 12), orderId: 'o-$id', orderNumber: 'HT-$id', paymentMethod: 'COD', cashDueAtDoorMinor: 10000, earningsMinor: net, commissionMinor: 0, reimbursementMinor: 0, netMinor: net);

Widget _app(_Api api, Widget home, {Locale? locale, List<Override> extra = const []}) => ProviderScope(
      overrides: [driverApiProvider.overrideWithValue(api), ...extra],
      child: MaterialApp(locale: locale, supportedLocales: const [Locale('ar'), Locale('en')], localizationsDelegates: _delegates, home: home),
    );

class _Tokens extends TokenStorage {
  bool cleared = false;
  @override
  Future<String?> get accessToken async => null;
  @override
  Future<void> clear() async => cleared = true;
}

class _Gps extends DriverLocationService {
  bool stopped = false;
  @override
  void stop() => stopped = true;
}

void main() {
  group('Earnings', () {
    testWidgets('shows the open-period preview and the closed periods with their recorded payments, in English', (tester) async {
      final api = _Api()..earnings = _earnings();
      await tester.pumpWidget(_app(api, const EarningsScreen()));
      await tester.pumpAndSettle();
      expect(find.text('95.00 EGP'), findsOneWidget); // owed to you (older backend: the four legacy figures only)
      expect(find.text('Owed to you'), findsNWidgets(2)); // open shift + the legacy closed period's net
      expect(find.text('90.00 EGP'), findsOneWidget);
      expect(find.text('- 15.00 EGP'), findsOneWidget);
      expect(find.textContaining('Preview of your open shift'), findsOneWidget);
      expect(find.byKey(const Key('closed-legacy')), findsOneWidget); // a period closed before 2026-11-13 is shown as recorded
      expect(find.byKey(const Key('closed-period-p1')), findsOneWidget);
      expect(find.textContaining('Paid to you: 45.00 EGP'), findsOneWidget);
    });

    testWidgets('Arabic: the same figures, Arabic labels and currency', (tester) async {
      final api = _Api()..earnings = _earnings();
      await tester.pumpWidget(_app(api, const EarningsScreen(), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('الأرباح'), findsOneWidget);
      expect(find.text('95.00 ج.م'), findsOneWidget);
      expect(find.textContaining('دُفع لك'), findsOneWidget);
    });

    testWidgets('a failed load shows a retry, not a blank page', (tester) async {
      final api = _Api(); // earnings == null → the fake throws
      await tester.pumpWidget(_app(api, const EarningsScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Could not load your earnings.'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });
  });

  group('History', () {
    testWidgets('loads a page at a time and appends the next on request', (tester) async {
      final api = _Api()
        ..pages.addAll([
          TransactionsPage(items: [_tx('1', 3000), _tx('2', 2000)], page: 1, limit: 2, total: 3),
          TransactionsPage(items: [_tx('3', 1000)], page: 2, limit: 2, total: 3),
        ]);
      await tester.pumpWidget(_app(api, const HistoryScreen()));
      await tester.pumpAndSettle();
      expect(find.text('HT-1'), findsOneWidget);
      expect(find.text('HT-2'), findsOneWidget);
      expect(find.text('HT-3'), findsNothing);
      await tester.tap(find.byKey(const Key('history-load-more')));
      await tester.pumpAndSettle();
      expect(api.pagesRequested, [1, 2]);
      expect(find.text('HT-3'), findsOneWidget);
      expect(find.byKey(const Key('history-load-more')), findsNothing);
    });

    testWidgets('current shift and previous ask the backend for separate scopes', (tester) async {
      final api = _Api()
        ..pages.add(TransactionsPage(items: [_tx('1', 3000)], page: 1, limit: 20, total: 1))
        ..previousPages.add(TransactionsPage(items: [_tx('2', 1000)], page: 1, limit: 20, total: 1));
      await tester.pumpWidget(_app(api, const HistoryScreen()));
      await tester.pumpAndSettle();
      expect(api.scopesRequested, ['current']);
      expect(find.text('HT-1'), findsOneWidget);
      await tester.tap(find.text('Previous'));
      await tester.pumpAndSettle();
      expect(api.scopesRequested, ['current', 'previous']);
      expect(find.text('HT-2'), findsOneWidget);
      expect(find.text('HT-1'), findsNothing);
    });

    testWidgets('empty history is an explicit empty state', (tester) async {
      final api = _Api()..pages.add(const TransactionsPage(items: [], page: 1, limit: 20, total: 0));
      await tester.pumpWidget(_app(api, const HistoryScreen()));
      await tester.pumpAndSettle();
      expect(find.text('No delivered orders in this shift yet.'), findsOneWidget);
    });
  });

  group('Earnings — COD and electronic shown separately (backend figures, nothing computed on the phone)', () {
    const cod = MoneyBreakdown(
      paymentFlow: null, feeEntitlementMinor: 4000, commissionMinor: 1000, courierCompensationMinor: 3000, goodsPaidToStoresMinor: 30000,
      goodsPassThroughMinor: 30000, goodsReimbursementMinor: 0, cashCollectedMinor: 34000, cashHeldMinor: 4000, changeKeptMinor: 0, netToCourierMinor: -1000,
    );
    const electronic = MoneyBreakdown(
      paymentFlow: null, feeEntitlementMinor: 4000, commissionMinor: 1000, courierCompensationMinor: 3000, goodsPaidToStoresMinor: 30000,
      goodsPassThroughMinor: 0, goodsReimbursementMinor: 30000, cashCollectedMinor: 0, cashHeldMinor: 0, changeKeptMinor: 0, netToCourierMinor: 33000,
    );
    DriverEarnings withOpen(MoneyBreakdown b, {List<ExcludedOrder> excluded = const []}) => DriverEarnings(
          open: OpenPeriod(periodStart: null, deliveries: 1, earningsMinor: b.feeEntitlementMinor, commissionMinor: b.commissionMinor, reimbursementsMinor: b.goodsReimbursementMinor, netMinor: b.netToCourierMinor, breakdown: b, excluded: excluded),
          deliveredToday: 1,
          closedPeriods: const [],
        );

    testWidgets('COD 300 + 40, commission 10: owes Hatly 10; goods shown as excluded; no extra 30 payable; no goods reimbursement', (tester) async {
      final api = _Api()..earnings = withOpen(cod);
      await tester.pumpWidget(_app(api, const EarningsScreen()));
      await tester.pumpAndSettle();
      expect(find.text('You owe Hatly'), findsOneWidget);
      expect(find.text('10.00 EGP'), findsOneWidget);
      expect(find.byKey(const Key('mb-goods-pass-through')), findsOneWidget);
      expect(find.textContaining('not part of your net'), findsOneWidget);
      expect(find.byKey(const Key('mb-goods-reimbursement')), findsNothing);
      expect(find.byKey(const Key('mb-cash-held')), findsOneWidget);
      expect(find.text('30.00 EGP'), findsOneWidget); // compensation, shown once — never as a separate payable
    });

    testWidgets('electronic 300 + 40, commission 10: owed to the courier 330, every part separate', (tester) async {
      final api = _Api()..earnings = withOpen(electronic);
      await tester.pumpWidget(_app(api, const EarningsScreen()));
      await tester.pumpAndSettle();
      expect(find.text('Owed to you'), findsOneWidget);
      expect(find.text('330.00 EGP'), findsOneWidget);
      expect(find.text('+ 300.00 EGP'), findsOneWidget);
      expect(find.text('40.00 EGP'), findsOneWidget);
      expect(find.text('- 10.00 EGP'), findsOneWidget);
      expect(find.byKey(const Key('mb-goods-pass-through')), findsNothing);
    });

    testWidgets('Arabic labels; a delivered order without a commission rate is listed as held for the next closing with the reason', (tester) async {
      final api = _Api()..earnings = withOpen(cod, excluded: const [ExcludedOrder(orderNumber: 'HT-100009', reason: 'RATE_UNDEFINED')]);
      await tester.pumpWidget(_app(api, const EarningsScreen(), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('مستحق على المندوب'), findsOneWidget);
      expect(find.text('عمولة Hatly'), findsOneWidget);
      expect(find.text('رسوم التوصيل'), findsOneWidget);
      expect(find.text('تعويض المندوب'), findsOneWidget);
      expect(find.text('النقدية المحصلة من العميل'), findsOneWidget);
      expect(find.text('طلبات مؤجلة للتقفيلة التالية'), findsOneWidget);
      expect(find.text('HT-100009'), findsOneWidget);
      expect(find.textContaining('نسبة العمولة الخاصة بك غير محددة'), findsOneWidget);
    });

    testWidgets('a closed shift by orders shows its reference, settled and remaining', (tester) async {
      final api = _Api()
        ..earnings = DriverEarnings(open: const OpenPeriod(periodStart: null, deliveries: 0, earningsMinor: 0, commissionMinor: 0, reimbursementsMinor: 0, netMinor: 0), deliveredToday: 0, closedPeriods: [
          ClosedPeriod(id: 'p2', frequency: 'DAILY', periodStart: DateTime.utc(2026, 11, 13, 6), periodEnd: DateTime.utc(2026, 11, 13, 18), earningsMinor: 4000, commissionMinor: 1000, reimbursementsMinor: 30000, netMinor: 33000,
              payments: const [], reference: 'CS-20261113-ABC123', methodVersion: 2, breakdown: electronic, settledMinor: 20000, remainingMinor: 13000),
        ]);
      await tester.pumpWidget(_app(api, const EarningsScreen(), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('CS-20261113-ABC123'), findsOneWidget);
      expect(find.text('تم تسويته'), findsOneWidget);
      expect(find.text('المتبقي للتسوية'), findsOneWidget);
      expect(find.text('130.00 ج.م'), findsOneWidget);
      expect(find.byKey(const Key('closed-legacy')), findsNothing);
    });
  });

  group('History — delivered orders with their money state', () {
    testWidgets('settled, waiting and excluded orders each say so; the row opens the delivery by its delivery id', (tester) async {
      final settled = DriverTransaction(id: 'a', at: DateTime.utc(2026, 11, 13, 10), orderId: 'oa', orderNumber: 'HT-A', paymentMethod: 'COD', cashDueAtDoorMinor: 34000, earningsMinor: 4000, commissionMinor: 1000, reimbursementMinor: 0, netMinor: -1000,
          deliveryId: 'da', vendors: 'Store One', orderTotalMinor: 34000, settlementState: 'SETTLED', settlementReference: 'CS-20261113-ABC123');
      final pending = DriverTransaction(id: 'b', at: DateTime.utc(2026, 11, 13, 11), orderId: 'ob', orderNumber: 'HT-B', paymentMethod: 'MANUAL_TRANSFER', cashDueAtDoorMinor: null, earningsMinor: 4000, commissionMinor: 1000, reimbursementMinor: 30000, netMinor: 33000,
          deliveryId: 'db', settlementState: 'PENDING');
      final excluded = DriverTransaction(id: 'c', at: DateTime.utc(2026, 11, 13, 12), orderId: 'oc', orderNumber: 'HT-C', paymentMethod: 'COD', cashDueAtDoorMinor: 1000, earningsMinor: 0, commissionMinor: 0, reimbursementMinor: 0, netMinor: 0,
          deliveryId: 'dc', settlementState: 'EXCLUDED', excludedReason: 'RATE_UNDEFINED');
      final api = _Api()..pages.add(TransactionsPage(items: [settled, pending, excluded], page: 1, limit: 20, total: 3));
      await tester.pumpWidget(_app(api, const HistoryScreen()));
      await tester.pumpAndSettle();
      expect(find.textContaining('Settled · CS-20261113-ABC123'), findsOneWidget);
      expect(find.text('Waiting for the next closing'), findsOneWidget);
      expect(find.textContaining('commission rate is not set'), findsOneWidget);
      expect(find.byKey(const Key('tx-net-c')), findsNothing); // no amount is invented for an excluded order
      expect(find.textContaining('You owe 10.00 EGP'), findsOneWidget);
      expect(find.textContaining('Owed to you 330.00 EGP'), findsOneWidget);
    });

    test('an older backend row (no new fields) still parses', () {
      final t = DriverTransaction.fromJson({'id': 'x', 'at': '2026-11-01T10:00:00.000Z', 'orderId': 'o', 'orderNumber': 'HT-1', 'paymentMethod': 'COD', 'earningsMinor': 1, 'commissionMinor': 0, 'reimbursementMinor': 0, 'netMinor': 1});
      expect(t.settlementState, isNull);
      expect(t.deliveryId, isNull);
      expect(t.breakdown, isNull);
    });
  });

  group('Profile', () {
    testWidgets('switching the language is immediate and there is no accept/reject anywhere', (tester) async {
      await tester.pumpWidget(ProviderScope(
        overrides: [driverApiProvider.overrideWithValue(_Api()), localeProvider.overrideWith((ref) => LocaleController(initial: const Locale('ar')))],
        child: Consumer(builder: (context, ref, _) => MaterialApp(locale: ref.watch(localeProvider), supportedLocales: const [Locale('ar'), Locale('en')], localizationsDelegates: _delegates, home: const ProfileScreen())),
      ));
      await tester.pumpAndSettle();
      expect(find.text('تسجيل الخروج'), findsOneWidget);
      await tester.tap(find.text('English'));
      await tester.pumpAndSettle();
      expect(find.text('Sign out'), findsOneWidget);
      expect(find.textContaining(RegExp('accept|reject|decline', caseSensitive: false)), findsNothing);
    });

    testWidgets('sign out stops the location timer and clears the stored session', (tester) async {
      final tokens = _Tokens();
      final gps = _Gps();
      await tester.pumpWidget(_app(_Api(), const ProfileScreen(), extra: [tokenStorageProvider.overrideWithValue(tokens), driverLocationServiceProvider.overrideWithValue(gps)]));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('logout-button')));
      await tester.pumpAndSettle();
      expect(gps.stopped, isTrue);
      expect(tokens.cleared, isTrue);
    });
  });

  group('Delivery detail — failure and retry handling', () {
    DioException lostConnection() => DioException(requestOptions: RequestOptions(path: '/x'), type: DioExceptionType.connectionError);

    testWidgets('a lost answer after the server DID apply the change is treated as success, with no error shown', (tester) async {
      final api = _Api()
        ..statusError = lostConnection()
        ..applyBeforeError = true;
      await tester.pumpWidget(_app(api, const DeliveryDetailScreen(deliveryId: 'd1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Picked Up'));
      await tester.pumpAndSettle();
      expect(api.statusCalls, ['PICKED_UP']);
      expect(find.byKey(const Key('action-error')), findsNothing);
      // The screen now reflects the new state and offers the next step.
      expect(find.text('On The Way'), findsOneWidget);
    });

    testWidgets('a lost answer where the change was NOT applied says so and offers the same button again', (tester) async {
      final api = _Api()..statusError = lostConnection();
      await tester.pumpWidget(_app(api, const DeliveryDetailScreen(deliveryId: 'd1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Picked Up'));
      await tester.pumpAndSettle();
      expect(find.textContaining('may not have gone through'), findsOneWidget);
      expect(find.text('Picked Up'), findsOneWidget);
    });

    testWidgets('a refusal from the server (4xx) shows the server message and is not retried or reconciled', (tester) async {
      final api = _Api()
        ..statusError = DioException(requestOptions: RequestOptions(path: '/x'), response: Response(requestOptions: RequestOptions(path: '/x'), statusCode: 409, data: {'message': 'Record the actual weight first'}), type: DioExceptionType.badResponse);
      await tester.pumpWidget(_app(api, const DeliveryDetailScreen(deliveryId: 'd1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Picked Up'));
      await tester.pumpAndSettle();
      expect(find.text('Record the actual weight first'), findsOneWidget);
      expect(api.statusCalls, ['PICKED_UP']);
    });

    testWidgets('there is no Accept or Reject action on the order', (tester) async {
      await tester.pumpWidget(_app(_Api(), const DeliveryDetailScreen(deliveryId: 'd1')));
      await tester.pumpAndSettle();
      expect(find.textContaining(RegExp('accept|reject|decline', caseSensitive: false)), findsNothing);
    });

    testWidgets('purchase amounts are exact integer money: 19.99 is recorded as 1999, junk is refused', (tester) async {
      final api = _Api();
      await tester.pumpWidget(_app(api, const DeliveryDetailScreen(deliveryId: 'd1')));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byType(TextField).first);
      await tester.enterText(find.byType(TextField).first, '19.99');
      await tester.ensureVisible(find.text('Save').first);
      await tester.tap(find.text('Save').first);
      await tester.pumpAndSettle();
      expect(api.purchaseCalls, [1999]);
      await tester.enterText(find.byType(TextField).first, '1.999');
      await tester.tap(find.text('Save').first);
      await tester.pumpAndSettle();
      expect(api.purchaseCalls, [1999]);
      expect(find.text('Enter a valid amount.', skipOffstage: false), findsOneWidget);
    });

    testWidgets('the pickup note and the branch are shown, in Arabic too', (tester) async {
      await tester.pumpWidget(_app(_Api(), const DeliveryDetailScreen(deliveryId: 'd1'), locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('Branch A'), findsOneWidget);
      expect(find.textContaining('Ask for Sami'), findsOneWidget);
      expect(find.text('تم الاستلام من المتجر'), findsOneWidget);
      expect(find.textContaining('المبلغ المطلوب تحصيله: 100.00 ج.م'), findsOneWidget);
    });
  });

  testWidgets('the shell offers exactly four places: orders, history, earnings, profile', (tester) async {
    final router = GoRouter(routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => DriverShell(shell: shell),
        branches: [
          for (final p in ['/', '/history', '/earnings', '/profile']) StatefulShellBranch(routes: [GoRoute(path: p, builder: (_, __) => Text('page $p'))]),
        ],
      ),
    ]);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationDestination), findsNWidgets(4));
    await tester.tap(find.text('Earnings'));
    await tester.pumpAndSettle();
    expect(find.text('page /earnings'), findsOneWidget);
  });
}
