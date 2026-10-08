import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/checkout/data/checkout_controller.dart';
import 'package:hatly_customer/features/checkout/presentation/checkout_screen.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';
import '../../support/router_test_app.dart';

/// U2 (approved): a new PICKUP order is paid in cash at the counter. `POST /checkout/quote` for a pickup offers COD only —
/// no Pay at Delivery, Manual Transfer unavailable (`PICKUP_CASH_ONLY`), wallet unavailable — and the server refuses any
/// other method anyway. The screen must not offer them at all (hidden, not merely disabled) and must say why.
Map<String, dynamic> pickupQuoteJson() {
  final q = quoteJson(fee: 0);
  q['fulfillment'] = {
    'type': 'PICKUP',
    'pickupAvailable': true,
    'pickupUnavailableReason': null,
    'pickupBranch': null,
  };
  q['payment'] = {
    'selected': {'method': 'COD', 'electronicMethod': null},
    'awaitsPaymentApproval': false,
    'wallet': {'balanceMinor': 5000, 'appliedMinor': 0, 'available': false},
    'options': {
      'cod': true,
      'payAtDelivery': false,
      'manualTransfer': {'available': false, 'reason': 'PICKUP_CASH_ONLY'},
      'electronicMethods': ['INSTAPAY', 'VODAFONE_CASH'],
    },
  };
  return q;
}

class _Harness {
  final checkout = FakeCheckoutApi();
  final orders = FakeOrdersApi();
  final cartApi = FakeCartApi();
}

Future<_Harness> _pump(WidgetTester tester, _Harness h,
    {Locale locale = const Locale('ar')}) async {
  tester.view.physicalSize = const Size(390 * 3, 2600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    initialLocation: '/checkout',
    locale: locale,
    overrides: [
      checkoutApiProvider.overrideWithValue(h.checkout),
      ordersApiProvider.overrideWithValue(h.orders),
      cartApiProvider.overrideWithValue(h.cartApi),
    ],
    routes: [
      GoRoute(path: '/', builder: (c, s) => const Scaffold(body: Text('home'))),
      GoRoute(path: '/checkout', builder: (c, s) => const CheckoutScreen()),
      probeRoute('/checkout/address'),
      GoRoute(
          path: '/checkout/success/:orderId',
          builder: (c, s) =>
              Scaffold(body: Text('success ${s.pathParameters['orderId']}'))),
    ],
  ));
  await tester.pumpAndSettle();
  return h;
}

void main() {
  testWidgets(
      'a pickup checkout offers ONLY cash: no Pay at Delivery, no Manual Transfer, no wallet — and explains it',
      (tester) async {
    final h = _Harness()..checkout.respond = (_) => pickupQuoteJson();
    await _pump(tester, h);
    expect(find.byKey(const Key('payment-cod')), findsOneWidget);
    expect(find.byKey(const Key('payment-pay-at-delivery')), findsNothing);
    expect(find.byKey(const Key('payment-manual-transfer')), findsNothing);
    expect(find.byKey(const Key('checkout-wallet-switch')), findsNothing);
    expect(find.byKey(const Key('checkout-pickup-cash-note')), findsOneWidget);
    expect(find.text('طلبات الاستلام تُدفع نقدًا في الفرع عند استلامها.'),
        findsOneWidget);
  });

  testWidgets('English: the cash-at-the-branch note is translated',
      (tester) async {
    final h = _Harness()..checkout.respond = (_) => pickupQuoteJson();
    await _pump(tester, h, locale: const Locale('en'));
    expect(
        find.text(
            'Pickup orders are paid in cash at the branch when you collect them.'),
        findsOneWidget);
  });

  testWidgets(
      'placing a pickup order sends COD with no wallet and no electronic method',
      (tester) async {
    final h = _Harness()..checkout.respond = (_) => pickupQuoteJson();
    await _pump(tester, h);
    await tester.tap(find.byKey(const Key('checkout-confirm')));
    await tester.pumpAndSettle();
    expect(h.orders.created, hasLength(1));
    final json = h.orders.created.single.toJson(includeToken: true);
    expect(json['paymentMethod'], 'COD');
    expect(json['useWallet'], anyOf(isNull, isFalse));
    expect(json['electronicPaymentMethod'], isNull);
  });

  testWidgets(
      'a DELIVERY checkout is unchanged: every method and the wallet are still offered',
      (tester) async {
    final h = _Harness()..checkout.respond = (_) => quoteJson();
    await _pump(tester, h);
    expect(find.byKey(const Key('payment-pay-at-delivery')), findsOneWidget);
    expect(find.byKey(const Key('payment-manual-transfer')), findsOneWidget);
    expect(find.byKey(const Key('checkout-wallet-switch')), findsOneWidget);
    expect(find.byKey(const Key('checkout-pickup-cash-note')), findsNothing);
  });
}
