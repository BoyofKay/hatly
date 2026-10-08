import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/checkout/data/checkout_controller.dart';
import 'package:hatly_customer/features/checkout/domain/checkout_quote.dart';
import 'package:hatly_customer/features/checkout/presentation/checkout_screen.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';
import '../../support/router_test_app.dart';

const _pendingSentence = 'سيتم تأكيد السعر أثناء تجهيز الطلب';

/// What `POST /checkout/quote` returns for a Hatly Service request whose price is not confirmed yet: pending flag, subtotal 0
/// only because nothing is priced, total / amount due unknown (null — never 0), COD the only option, wallet unavailable.
Map<String, dynamic> pendingQuoteJson(
    {bool canPlace = true, List<Map<String, dynamic>> blockers = const []}) {
  final q = quoteJson(subtotal: 0, fee: 11000, canPlace: canPlace);
  q['hasPendingPricing'] = true;
  q['blockers'] = blockers;
  q['summary'] = {
    'subtotalMinor': 0,
    'discountMinor': 0,
    'deliveryFeeMinor': 11000,
    'totalMinor': null,
    'walletAppliedMinor': 0,
    'amountDueMinor': null,
  };
  q['vendors'] = [
    {
      'vendorBranchId': null,
      'name': 'صيدلية الزاوية',
      'subtotalMinor': 0,
      'discountMinor': 0,
      'itemCount': 1,
      'preparationMinutes': null,
      'couponApplied': false
    },
  ];
  q['payment'] = {
    'selected': {'method': 'COD', 'electronicMethod': null},
    'awaitsPaymentApproval': false,
    'wallet': {'balanceMinor': 5000, 'appliedMinor': 0, 'available': false},
    'options': {
      'cod': true,
      'payAtDelivery': false,
      'manualTransfer': {'available': false, 'reason': 'UNPRICED_ORDER'},
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

Future<_Harness> _pump(WidgetTester tester,
    {_Harness? harness,
    Locale locale = const Locale('ar'),
    double scale = 1.0,
    double width = 390}) async {
  final h = harness ?? _Harness();
  tester.view.physicalSize = Size(width * 3, 2600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    initialLocation: '/checkout',
    locale: locale,
    textScale: scale,
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

bool _confirmEnabled(WidgetTester tester) =>
    tester
        .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
        .onPressed !=
    null;

void main() {
  group('CheckoutQuote model', () {
    test('the pending flag is read explicitly and defaults to false', () {
      expect(
          CheckoutQuote.fromJson(pendingQuoteJson()).hasPendingPricing, isTrue);
      expect(CheckoutQuote.fromJson(quoteJson()).hasPendingPricing, isFalse);
      final q = CheckoutQuote.fromJson(pendingQuoteJson());
      expect(q.summary!.totalMinor, isNull,
          reason: 'unknown, never a numeric 0');
      expect(q.summary!.amountDueMinor, isNull);
      expect(q.summary!.subtotalMinor, 0);
    });
  });

  group(
      'a Hatly Service request with NO confirmed price does not block checkout',
      () {
    testWidgets(
        'the place-order button is enabled and nothing in the blockers area stops the customer',
        (tester) async {
      final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
      await _pump(tester, harness: h);
      expect(_confirmEnabled(tester), isTrue);
      expect(find.byKey(const Key('checkout-cta-hint')), findsNothing);
      expect(find.text('حدث خطأ ما'), findsNothing);
    });

    testWidgets(
        'placing it creates the order with COD, no wallet, no electronic method — and goes to the success screen (creation is not payment)',
        (tester) async {
      final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
      await _pump(tester, harness: h);
      await tester.tap(find.byKey(const Key('checkout-confirm')));
      await tester.pumpAndSettle();
      expect(h.orders.created, hasLength(1));
      final json = h.orders.created.single.toJson(includeToken: true);
      expect(json['paymentMethod'], 'COD');
      expect(json['useWallet'], anyOf(isNull, isFalse));
      expect(json['electronicPaymentMethod'], isNull);
      expect(json['quoteToken'], 'token-1');
      expect(find.text('success order-1'), findsOneWidget);
    });
  });

  group('the pending price is shown as an explicit state, never as 0', () {
    testWidgets(
        'subtotal, total and the bottom bar all say the price will be confirmed while the order is prepared',
        (tester) async {
      final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
      await _pump(tester, harness: h);
      await tester.ensureVisible(find.byKey(const Key('checkout-totals')));
      await tester.pumpAndSettle();
      expect(
          find.byKey(const Key('checkout-subtotal-pending')), findsOneWidget);
      expect(find.text(_pendingSentence), findsWidgets);
      expect(find.byKey(const Key('checkout-total')), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('checkout-total'))).data,
          _pendingSentence);
      // The delivery fee IS known and is shown as a number; no "0 ج.م" is shown anywhere as a price.
      expect(find.text('110 ج.م'), findsWidgets);
      expect(find.text('0 ج.م'), findsNothing);
      expect(find.text('٠ ج.م'), findsNothing);
    });

    testWidgets('the request line in the summary says its price is pending',
        (tester) async {
      final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
      h.cartApi.cart = hatlyServiceCart();
      await _pump(tester, harness: h);
      await tester
          .ensureVisible(find.byKey(const Key('checkout-item-price-pending')));
      expect(
          find.byKey(const Key('checkout-item-price-pending')), findsOneWidget);
    });

    testWidgets(
        'a normal (priced) order is unchanged: no pending text, real numbers',
        (tester) async {
      await _pump(tester);
      expect(find.text(_pendingSentence), findsNothing);
      expect(find.byKey(const Key('checkout-subtotal-pending')), findsNothing);
      expect(
          find.descendant(
              of: find.byKey(const Key('checkout-total')),
              matching: find.text('115 ج.م')),
          findsOneWidget);
      expect(find.byKey(const Key('checkout-total')), findsOneWidget);
    });
  });

  group('payment options: cash on delivery is the only way to pay', () {
    testWidgets(
        'COD is offered and selected; Pay at Delivery is not offered; Manual Transfer is disabled with the reason; the wallet cannot be used',
        (tester) async {
      final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
      await _pump(tester, harness: h);
      expect(find.byKey(const Key('payment-cod')), findsOneWidget);
      expect(find.byKey(const Key('payment-pay-at-delivery')), findsNothing);
      expect(
          find.text('غير متاح لأن سعر الطلب لم يُحدَّد بعد'), findsOneWidget);
      expect(find.byKey(const Key('checkout-hatly-service-cod-note')),
          findsOneWidget);
      expect(find.textContaining('تُدفع عند الاستلام فقط'), findsOneWidget);

      // Tapping the disabled Manual Transfer option does nothing (no electronic chooser appears, selection stays COD).
      await tester.tap(find.byKey(const Key('payment-manual-transfer')),
          warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('electronic-INSTAPAY')), findsNothing);
      expect(h.checkout.requests.last.toJson()['paymentMethod'], 'COD');

      final wallet = find.byKey(const Key('checkout-wallet-switch'));
      if (wallet.evaluate().isNotEmpty) {
        expect(tester.widget<Switch>(wallet).onChanged, isNull,
            reason: 'the wallet is disabled for an unpriced order');
      }
      expect(
          find.text(
              'لا يمكن استخدام المحفظة مع هذا الطلب لأن سعره النهائي غير محدد بعد'),
          findsOneWidget);
    });

    testWidgets('a normal order does not show the Hatly Service COD note',
        (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('checkout-hatly-service-cod-note')),
          findsNothing);
    });
  });

  group(
      'known server rejections show a specific Arabic message (never the generic one)',
      () {
    testWidgets('a missing delivery address while placing the order',
        (tester) async {
      final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
      await _pump(tester, harness: h);
      h.orders.failWith = const ApiException(
          code: 'BAD_REQUEST',
          message: 'A delivery address is required.',
          details: {'code': 'DELIVERY_ADDRESS_REQUIRED'},
          statusCode: 400);
      await tester.tap(find.byKey(const Key('checkout-confirm')));
      await tester.pumpAndSettle();
      expect(find.text('اختر عنوان التوصيل أولًا ثم أعد المحاولة.'),
          findsOneWidget);
      expect(find.text('حدث خطأ ما'), findsNothing);
      expect(find.text('A delivery address is required.'), findsNothing);
    });

    testWidgets(
        'the Hatly Service price setting is not configured: "service unavailable" — not the generic error, not the setting name',
        (tester) async {
      final h = _Harness()
        ..checkout.respond =
            (_) => pendingQuoteJson(canPlace: false, blockers: [
                  {
                    'code': 'BUSINESS_CONFIG_NOT_SET',
                    'message':
                        'Required business configuration value "HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER" has not been set.',
                    'details': {
                      'code': 'BUSINESS_CONFIG_NOT_SET',
                      'key': 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER'
                    }
                  },
                ]);
      await _pump(tester, harness: h);
      expect(_confirmEnabled(tester), isFalse);
      expect(
          find.text(
              'هذه الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا أو التواصل مع هاتلي.'),
          findsOneWidget);
      expect(find.textContaining('HATLY_SERVICE'), findsNothing);
      expect(find.text('حدث خطأ ما'), findsNothing);
    });

    testWidgets(
        'a Hatly Service request that was saved without its pickup place gets the specific "add it again with the place" message',
        (tester) async {
      final h = _Harness()
        ..checkout.respond =
            (_) => pendingQuoteJson(canPlace: false, blockers: [
                  {
                    'code': 'BUY_FROM_PLACE_PICKUP_REQUIRED',
                    'message': 'x',
                    'details': {'code': 'BUY_FROM_PLACE_PICKUP_REQUIRED'}
                  },
                ]);
      await _pump(tester, harness: h);
      expect(find.textContaining('بدون موقع استلام'), findsOneWidget);
    });
  });

  testWidgets(
      'narrow screen, large text, English: the pending wording does not overflow',
      (tester) async {
    final h = _Harness()..checkout.respond = (_) => pendingQuoteJson();
    await _pump(tester,
        harness: h, width: 320, scale: 2.0, locale: const Locale('en'));
    expect(tester.takeException(), isNull);
    expect(
        find.text(
            'The price will be confirmed while your order is being prepared'),
        findsWidgets);
  });
}
