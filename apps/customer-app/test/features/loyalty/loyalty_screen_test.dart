import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/loyalty/data/loyalty_api.dart';
import 'package:hatly_customer/features/loyalty/data/loyalty_providers.dart';
import 'package:hatly_customer/features/loyalty/domain/loyalty_transaction.dart';
import 'package:hatly_customer/features/loyalty/presentation/loyalty_screen.dart';
import 'package:hatly_customer/features/wallet/data/wallet_api.dart';
import 'package:hatly_customer/features/wallet/data/wallet_providers.dart';
import 'package:hatly_customer/features/wallet/domain/wallet_transaction.dart';

import '../../support/test_app.dart';

/// Customer Loyalty (Profile) — consolidated customer-commerce
/// milestone, Parts C/D. `_FakeLoyaltyApi` mirrors the established
/// `WalletScreen` test's own `_FakeWalletApi` pattern exactly. Every
/// assertion checks that what renders is EXACTLY what the fake
/// "server" returned — never a value recomputed client-side —
/// matching the same "server-authoritative" discipline `WalletScreen`
/// is already tested for.
class _FakeLoyaltyApi implements LoyaltyApi {
  _FakeLoyaltyApi({
    this.pointsBalance = 0,
    List<CustomerLoyaltyTransaction>? transactions,
  }) : transactions = transactions ?? [];

  int pointsBalance;
  List<CustomerLoyaltyTransaction> transactions;
  Object? balanceFailure;
  Object? transactionsFailure;
  Object? convertFailure;
  LoyaltyConversionResult? convertResult;
  final convertCalls = <({int points, String idempotencyKey})>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<LoyaltyBalance> getBalance() async {
    if (balanceFailure != null) throw balanceFailure!;
    return LoyaltyBalance(pointsBalance: pointsBalance);
  }

  @override
  Future<LoyaltyTransactionPage> getTransactions(
      {int page = 1, int limit = 20}) async {
    if (transactionsFailure != null) throw transactionsFailure!;
    final start = (page - 1) * limit;
    final end = (start + limit).clamp(0, transactions.length);
    final slice = start >= transactions.length
        ? <CustomerLoyaltyTransaction>[]
        : transactions.sublist(start, end);
    return LoyaltyTransactionPage(
      transactions: slice,
      page: page,
      limit: limit,
      total: transactions.length,
    );
  }

  @override
  Future<LoyaltyConversionResult> convert(
      {required int points, required String idempotencyKey}) async {
    convertCalls.add((points: points, idempotencyKey: idempotencyKey));
    if (convertFailure != null) throw convertFailure!;
    return convertResult ??
        LoyaltyConversionResult(
          convertedPoints: points,
          walletCreditMinor: (points ~/ 100) * 100,
          pointsBalance: pointsBalance - points,
          walletBalance: 0,
        );
  }
}

class _FakeWalletApi implements WalletApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<WalletBalance> getBalance() async => const WalletBalance(balanceMinor: 0);

  @override
  Future<WalletTransactionPage> getTransactions({int page = 1, int limit = 20}) async {
    return const WalletTransactionPage(transactions: [], page: 1, limit: 20, total: 0);
  }
}

CustomerLoyaltyTransaction _tx(
  String id, {
  required int pointsDelta,
  String type = 'EARNING',
  String? orderId,
  String? reason,
  DateTime? createdAt,
}) {
  return CustomerLoyaltyTransaction(
    id: id,
    pointsDelta: pointsDelta,
    type: type,
    createdAt: createdAt ?? DateTime(2026, 1, 1, 12),
    orderId: orderId,
    reason: reason,
  );
}

Future<void> _pump(WidgetTester tester, _FakeLoyaltyApi api) async {
  await tester.pumpWidget(hatlyTestApp(
    const LoyaltyScreen(),
    locale: const Locale('en'),
    overrides: [
      loyaltyApiProvider.overrideWithValue(api),
      walletApiProvider.overrideWithValue(_FakeWalletApi()),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('LoyaltyScreen — balance', () {
    testWidgets('renders exactly the server-returned points balance', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 750);
      await _pump(tester, api);

      expect(find.byKey(const Key('loyalty-balance-amount')), findsOneWidget);
      expect(find.text('750 pts'), findsOneWidget);
    });

    testWidgets('a balance-fetch failure shows the generic error text, not a fabricated balance', (tester) async {
      final api = _FakeLoyaltyApi()..balanceFailure = Exception('down');
      await _pump(tester, api);

      expect(find.byKey(const Key('loyalty-balance-error')), findsOneWidget);
      expect(find.byKey(const Key('loyalty-balance-amount')), findsNothing);
    });
  });

  group('LoyaltyScreen — history: empty / error / rendering', () {
    testWidgets('empty history state when there is no points activity', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 0, transactions: []);
      await _pump(tester, api);

      expect(find.text('No points activity yet'), findsOneWidget);
    });

    testWidgets('error + retry when history fails to load', (tester) async {
      final api = _FakeLoyaltyApi()..transactionsFailure = Exception('down');
      await _pump(tester, api);

      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('an EARNING credit renders with a "+" and the earned label, never the raw type string', (tester) async {
      final api = _FakeLoyaltyApi(transactions: [
        _tx('t1', pointsDelta: 500, type: 'EARNING', orderId: 'order-1'),
      ]);
      await _pump(tester, api);

      expect(find.text('+500 pts'), findsOneWidget);
      expect(find.text('Points earned'), findsOneWidget);
      expect(find.text('EARNING'), findsNothing);
    });

    testWidgets('a REDEMPTION debit renders with a "−" and the converted-to-wallet label', (tester) async {
      final api = _FakeLoyaltyApi(transactions: [
        _tx('t1', pointsDelta: -500, type: 'REDEMPTION'),
      ]);
      await _pump(tester, api);

      expect(find.text('−500 pts'), findsOneWidget);
      expect(find.text('Converted to Wallet'), findsOneWidget);
    });

    testWidgets('an EARNING_REVERSED debit shows the reversal label, never displayed as a plain earning', (tester) async {
      final api = _FakeLoyaltyApi(transactions: [
        _tx('t1', pointsDelta: -120, type: 'EARNING_REVERSED', reason: 'Order partially refunded'),
      ]);
      await _pump(tester, api);

      expect(find.text('Points reversed (refund)'), findsOneWidget);
      expect(find.text('Order partially refunded'), findsOneWidget);
    });
  });

  group('LoyaltyScreen — convert to Wallet', () {
    testWidgets('opens the convert sheet and submits a valid amount, then shows a success snackbar', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 1000);
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('loyalty-convert-action')));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('loyalty-convert-amount-field')), '500');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Convert'));
      await tester.pumpAndSettle();

      expect(api.convertCalls, hasLength(1));
      expect(api.convertCalls.single.points, 500);
      expect(find.textContaining('Converted to your Hatly Wallet'), findsOneWidget);
    });

    testWidgets('retrying after a failure reuses the SAME idempotency key, never a fresh one', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 1000)
        ..convertFailure = const ApiException(code: 'BAD_REQUEST', message: 'nope', details: {'code': 'INSUFFICIENT_POINTS'});
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('loyalty-convert-action')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('loyalty-convert-amount-field')), '500');
      await tester.pumpAndSettle();

      await tester.tap(find.text('Convert'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('loyalty-convert-error')), findsOneWidget);

      await tester.tap(find.text('Convert'));
      await tester.pumpAndSettle();

      expect(api.convertCalls, hasLength(2));
      expect(api.convertCalls[0].idempotencyKey, api.convertCalls[1].idempotencyKey);
    });

    testWidgets('INSUFFICIENT_POINTS maps to a clear, specific message', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 0)
        ..convertFailure = const ApiException(code: 'BAD_REQUEST', message: 'nope', details: {'code': 'INSUFFICIENT_POINTS'});
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('loyalty-convert-action')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('loyalty-convert-amount-field')), '500');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Convert'));
      await tester.pumpAndSettle();

      expect(find.text("You don't have enough points for this conversion."), findsOneWidget);
    });

    testWidgets('BELOW_MINIMUM_CONVERSION maps to a clear, specific message', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 1000)
        ..convertFailure = const ApiException(code: 'BAD_REQUEST', message: 'nope', details: {'code': 'BELOW_MINIMUM_CONVERSION', 'minimum': 500});
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('loyalty-convert-action')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('loyalty-convert-amount-field')), '100');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Convert'));
      await tester.pumpAndSettle();

      expect(find.text('Enter at least 500 points.'), findsOneWidget);
    });

    testWidgets('INVALID_CONVERSION_MULTIPLE maps to a clear, specific message', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 1000)
        ..convertFailure = const ApiException(code: 'BAD_REQUEST', message: 'nope', details: {'code': 'INVALID_CONVERSION_MULTIPLE', 'multipleOf': 100});
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('loyalty-convert-action')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('loyalty-convert-amount-field')), '550');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Convert'));
      await tester.pumpAndSettle();

      expect(find.text('Enter an amount in multiples of 100 points.'), findsOneWidget);
    });

    testWidgets('the Convert button stays disabled until a positive amount is entered', (tester) async {
      final api = _FakeLoyaltyApi(pointsBalance: 1000);
      await _pump(tester, api);

      await tester.tap(find.byKey(const Key('loyalty-convert-action')));
      await tester.pumpAndSettle();

      final button = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Convert'));
      expect(button.onPressed, isNull);

      await tester.enterText(find.byKey(const Key('loyalty-convert-amount-field')), '500');
      await tester.pumpAndSettle();
      final enabledButton = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Convert'));
      expect(enabledButton.onPressed, isNotNull);
    });
  });
}
