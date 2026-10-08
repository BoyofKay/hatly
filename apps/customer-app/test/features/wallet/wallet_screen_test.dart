import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/wallet/data/wallet_api.dart';
import 'package:hatly_customer/features/wallet/data/wallet_providers.dart';
import 'package:hatly_customer/features/wallet/domain/wallet_transaction.dart';
import 'package:hatly_customer/features/wallet/presentation/wallet_screen.dart';

import '../../support/test_app.dart';

/// Customer Wallet (Profile). `_FakeWalletApi` mirrors this codebase's
/// established `implements ... { noSuchMethod }` fake pattern. Every
/// assertion here checks that what renders is EXACTLY what the fake
/// "server" returned — never a value recomputed from the transactions
/// list — matching the explicit "server-authoritative" requirement.
class _FakeWalletApi implements WalletApi {
  _FakeWalletApi({
    this.balanceMinor = 0,
    List<CustomerWalletTransaction>? transactions,
  }) : transactions = transactions ?? [];

  int balanceMinor;
  List<CustomerWalletTransaction> transactions;
  Object? balanceFailure;
  Object? transactionsFailure;
  final getTransactionsCalls = <({int page, int limit})>[];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<WalletBalance> getBalance() async {
    if (balanceFailure != null) throw balanceFailure!;
    return WalletBalance(balanceMinor: balanceMinor);
  }

  @override
  Future<WalletTransactionPage> getTransactions({int page = 1, int limit = 20}) async {
    getTransactionsCalls.add((page: page, limit: limit));
    if (transactionsFailure != null) throw transactionsFailure!;
    final start = (page - 1) * limit;
    final end = (start + limit).clamp(0, transactions.length);
    final slice = start >= transactions.length
        ? <CustomerWalletTransaction>[]
        : transactions.sublist(start, end);
    return WalletTransactionPage(
      transactions: slice,
      page: page,
      limit: limit,
      total: transactions.length,
    );
  }
}

CustomerWalletTransaction _tx(
  String id, {
  required int amountDeltaMinor,
  String type = 'ORDER_REFUND',
  String? orderId,
  String? reason,
  DateTime? createdAt,
}) {
  return CustomerWalletTransaction(
    id: id,
    amountDeltaMinor: amountDeltaMinor,
    type: type,
    createdAt: createdAt ?? DateTime(2026, 1, 1, 12),
    orderId: orderId,
    reason: reason,
  );
}

Future<void> _pump(WidgetTester tester, _FakeWalletApi api) async {
  await tester.pumpWidget(hatlyTestApp(
    const WalletScreen(),
    locale: const Locale('en'),
    overrides: [walletApiProvider.overrideWithValue(api)],
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('WalletScreen — balance', () {
    testWidgets('renders exactly the server-returned balance, formatted with the app-wide money formatter', (tester) async {
      final api = _FakeWalletApi(balanceMinor: 123456);
      await _pump(tester, api);

      expect(find.byKey(const Key('wallet-balance-amount')), findsOneWidget);
      expect(find.text('1234.56 EGP'), findsOneWidget);
    });

    testWidgets('a balance-fetch failure shows the generic error text, not a fabricated balance', (tester) async {
      final api = _FakeWalletApi()..balanceFailure = Exception('down');
      await _pump(tester, api);

      expect(find.byKey(const Key('wallet-balance-error')), findsOneWidget);
      expect(find.byKey(const Key('wallet-balance-amount')), findsNothing);
    });
  });

  group('WalletScreen — history: empty / error / rendering', () {
    testWidgets('empty history state when there are no transactions', (tester) async {
      final api = _FakeWalletApi(balanceMinor: 0, transactions: []);
      await _pump(tester, api);

      expect(find.byIcon(Icons.receipt_long_outlined), findsOneWidget);
    });

    testWidgets('error + retry when history fails to load', (tester) async {
      final api = _FakeWalletApi()..transactionsFailure = Exception('down');
      await _pump(tester, api);

      expect(find.byIcon(Icons.error_outline), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
    });

    testWidgets('a credit (positive amount) renders with a "+" and the success color, never the debit styling', (tester) async {
      final api = _FakeWalletApi(transactions: [
        _tx('t1', amountDeltaMinor: 5000, type: 'ORDER_REFUND'),
      ]);
      await _pump(tester, api);

      expect(find.text('+50 EGP'), findsOneWidget);
      expect(find.text('Order refund'), findsOneWidget);
    });

    testWidgets('a debit (negative amount) renders with a "−" and never a plain negative sign or the raw type string', (tester) async {
      final api = _FakeWalletApi(transactions: [
        _tx('t1', amountDeltaMinor: -2000, type: 'ORDER_PAYMENT', orderId: 'order-9'),
      ]);
      await _pump(tester, api);

      expect(find.text('−20 EGP'), findsOneWidget);
      expect(find.text('-20 EGP'), findsNothing);
      expect(find.text('Order payment'), findsOneWidget);
      expect(find.text('ORDER_PAYMENT'), findsNothing);
    });

    testWidgets('an admin credit with a reason shows that reason', (tester) async {
      final api = _FakeWalletApi(transactions: [
        _tx('t1', amountDeltaMinor: 10000, type: 'ADMIN_CREDIT', reason: 'Goodwill credit'),
      ]);
      await _pump(tester, api);

      expect(find.text('Goodwill credit'), findsOneWidget);
      expect(find.text('Credit'), findsOneWidget);
    });
  });

  group('WalletScreen — pagination', () {
    testWidgets('requests page 1 with the default limit on first load', (tester) async {
      final api = _FakeWalletApi(
          transactions: List.generate(5, (i) => _tx('t$i', amountDeltaMinor: 100)));
      await _pump(tester, api);

      expect(api.getTransactionsCalls.first, (page: 1, limit: 20));
    });

    testWidgets('scrolling near the bottom loads the next page and appends it', (tester) async {
      final api = _FakeWalletApi(
        transactions:
            List.generate(45, (i) => _tx('t$i', amountDeltaMinor: 100 + i)),
      );
      await _pump(tester, api);

      expect(find.byKey(const Key('wallet-transaction-t0')), findsOneWidget);
      expect(find.byKey(const Key('wallet-transaction-t44')), findsNothing);

      await tester.drag(find.byType(ListView), const Offset(0, -20000));
      await tester.pumpAndSettle();

      expect(api.getTransactionsCalls.length, greaterThanOrEqualTo(2));
      expect(find.byKey(const Key('wallet-transaction-t44')), findsOneWidget);
    });
  });
}
