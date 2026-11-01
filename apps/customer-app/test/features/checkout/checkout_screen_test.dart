import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/checkout/data/checkout_controller.dart';
import 'package:hatly_customer/features/checkout/presentation/checkout_screen.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';
import '../../support/router_test_app.dart';

class _Harness {
  _Harness() {
    checkout = FakeCheckoutApi();
    orders = FakeOrdersApi();
    cartApi = FakeCartApi();
  }

  late FakeCheckoutApi checkout;
  late FakeOrdersApi orders;
  late FakeCartApi cartApi;
  final visited = <String>[];
}

Future<_Harness> _pump(
  WidgetTester tester, {
  bool dark = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
  double height = 2600,
  _Harness? harness,
}) async {
  final h = harness ?? _Harness();
  tester.view.physicalSize = Size(width * 3, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    initialLocation: '/checkout',
    dark: dark,
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
      probeRoute('/checkout/address', visited: h.visited),
      GoRoute(
        path: '/checkout/success/:orderId',
        builder: (c, s) {
          h.visited.add(s.uri.toString());
          return Scaffold(body: Text('success ${s.pathParameters['orderId']}'));
        },
      ),
    ],
  ));
  await tester.pumpAndSettle();
  return h;
}

/// The text shown by a (possibly LTR-wrapped) text widget identified by [key].
String? _textOf(WidgetTester tester, Key key) {
  final finder =
      find.descendant(of: find.byKey(key), matching: find.byType(Text));
  if (finder.evaluate().isNotEmpty) {
    return tester.widget<Text>(finder.first).data;
  }
  return tester.widget<Text>(find.byKey(key)).data;
}

/// Brings [key] on screen (above the pinned bar), then taps it.
Future<void> _tapVisible(WidgetTester tester, Key key) async {
  final finder = find.byKey(key);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  group('layout — sections in the approved order', () {
    testWidgets(
        'fulfilment → address → delivery estimate → payment → wallet → coupon → summary, with the CTA pinned',
        (tester) async {
      await _pump(tester);
      final order = [
        find.byKey(const Key('checkout-fulfillment')),
        find.byKey(const Key('checkout-address-card')),
        find.byKey(const Key('checkout-delivery-breakdown')),
        find.byKey(const Key('payment-cod')),
        find.byKey(const Key('checkout-wallet-switch')),
        find.byKey(const Key('checkout-coupon')),
        find.byKey(const Key('checkout-totals')),
      ];
      var lastTop = -1.0;
      for (final f in order) {
        expect(f, findsOneWidget);
        final top = tester.getTopLeft(f).dy;
        expect(top, greaterThan(lastTop),
            reason: '$f must come after the previous section');
        lastTop = top;
      }
      final cta =
          tester.getTopLeft(find.byKey(const Key('checkout-confirm'))).dy;
      expect(cta, greaterThan(lastTop),
          reason: 'the sticky bar sits below the scrolling content');
    });

    testWidgets(
        'shows the SERVER numbers: ETA range, delivery fee, total — nothing computed on the client',
        (tester) async {
      await _pump(tester);
      expect(find.text('من 35 إلى 45 دقيقة'), findsOneWidget);
      expect(find.byKey(const Key('checkout-delivery-fee')), findsOneWidget);
      expect(_textOf(tester, const Key('checkout-delivery-fee')), '15 ج.م');
      expect(_textOf(tester, const Key('checkout-total')), '115 ج.م');
    });

    testWidgets(
        'the default address is preselected and labelled, with its structured details',
        (tester) async {
      await _pump(tester);
      expect(find.text('افتراضي'), findsOneWidget);
      expect(find.text('شارع الجمهورية، بلبيس'), findsOneWidget);
      expect(find.text('12 · 3 · 8'), findsOneWidget);
      expect(find.text('بلبيس، الشرقية'), findsOneWidget);
      expect(find.text('الجرس معطل، اتصل بي'), findsOneWidget);
    });

    testWidgets(
        'the delivery breakdown expands to base fee, distance and per-vendor preparation',
        (tester) async {
      await _pump(tester);
      expect(find.text('رسوم التوصيل الأساسية'), findsNothing);
      await tester.tap(find.byKey(const Key('checkout-delivery-breakdown')));
      await tester.pumpAndSettle();
      expect(find.text('رسوم التوصيل الأساسية'), findsOneWidget);
      expect(find.text('3.4 كم'), findsOneWidget);
      expect(find.text('حوالي 20 دقيقة'), findsOneWidget);
    });

    testWidgets('an unknown ETA says so — it is never invented',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) {
        final q = quoteJson();
        (q['delivery'] as Map)['eta'] = {
          'available': false,
          'reason': 'PREPARATION_TIME_NOT_CONFIGURED',
        };
        return q;
      };
      await _pump(tester, harness: h);
      expect(
          find.text('لم يحدد المتجر وقت التحضير بعد، لذلك لا يوجد وقت متوقع'),
          findsOneWidget);
    });

    testWidgets('the coupon section is collapsed by default', (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('checkout-coupon-field')), findsNothing);
      expect(find.text('لديك كود خصم؟'), findsOneWidget);
    });
  });

  group('address & service area', () {
    testWidgets(
        'no address yet: asks the customer to choose one and blocks the order with the reason',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) =>
          quoteJson(canPlace: false, fee: null, overrides: {
            'address': {'addressId': null, 'source': null, 'snapshot': null},
            'eligibility': {
              'serviceable': false,
              'code': 'ADDRESS_REQUIRED',
              'vendors': []
            },
            'delivery': {
              'applicable': true,
              'source': 'NONE',
              'feeMinor': null,
              'vendorCount': 1,
              'vendors': [],
              'eta': {'available': false},
            },
            'blockers': [
              {'code': 'DELIVERY_ADDRESS_REQUIRED', 'message': 'x'}
            ],
          });
      await _pump(tester, harness: h);
      expect(find.text('اختر عنوان التوصيل'), findsWidgets);
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNull);
      expect(find.byKey(const Key('checkout-cta-hint')), findsOneWidget);
    });

    testWidgets(
        'an address outside the service area is explained and cannot be ordered to',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) => quoteJson(canPlace: false, overrides: {
            'eligibility': {
              'serviceable': false,
              'code': 'ADDRESS_OUT_OF_SERVICE_AREA',
              'vendors': [],
            },
            'blockers': [
              {'code': 'ADDRESS_OUT_OF_SERVICE_AREA', 'message': 'x'}
            ],
          });
      await _pump(tester, harness: h);
      expect(find.byKey(const Key('checkout-address-error')), findsOneWidget);
      expect(
          find.text('هاتلي لا يوصّل إلى هذا العنوان حاليًا. اختر عنوانًا آخر.'),
          findsWidgets);
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNull);
    });

    testWidgets(
        'tapping the address opens the address list; the returned address is quoted',
        (tester) async {
      final h = await _pump(tester);
      await tester.tap(find.byKey(const Key('checkout-address-card')));
      await tester.pumpAndSettle();
      expect(h.visited, contains('/checkout/address'));
    });
  });

  group('fulfilment', () {
    testWidgets(
        'pickup is disabled with the reason when the cart has several vendors',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) => quoteJson(overrides: {
            'fulfillment': {
              'type': 'DELIVERY',
              'pickupAvailable': false,
              'pickupUnavailableReason': 'PICKUP_SINGLE_VENDOR_ONLY',
            },
          });
      await _pump(tester, harness: h);
      expect(find.text('الاستلام من الفرع متاح لطلب من متجر واحد فقط'),
          findsOneWidget);
      await tester.tap(find.text('استلام من الفرع'));
      await tester.pumpAndSettle();
      expect(h.cartApi.calls, isNot(contains('fulfillment:PICKUP')));
    });

    testWidgets(
        'choosing pickup changes the cart on the server and shows the branch, with no delivery fee',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) => h.cartApi.calls.contains('fulfillment:PICKUP')
          ? quoteJson(fee: 0, overrides: {
              'fulfillment': {
                'type': 'PICKUP',
                'pickupAvailable': true,
                'pickupBranch': {
                  'vendorBranchId': 'b1',
                  'name': 'مطعم النخيل',
                  'address': 'شارع البحر',
                },
              },
              'address': {'addressId': null, 'source': null, 'snapshot': null},
              'eligibility': null,
            })
          : quoteJson();
      await _pump(tester, harness: h);
      await tester.tap(find.text('استلام من الفرع'));
      await tester.pumpAndSettle();
      expect(h.cartApi.calls, contains('fulfillment:PICKUP'));
      expect(find.text('الاستلام من'), findsOneWidget);
      expect(find.text('شارع البحر'), findsOneWidget);
      expect(find.byKey(const Key('checkout-address-card')), findsNothing);
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNotNull);
    });
  });

  group('payment', () {
    testWidgets(
        'COD is selected by default; all five electronic methods appear only after choosing an electronic option',
        (tester) async {
      await _pump(tester);
      expect(find.byKey(const Key('electronic-INSTAPAY')), findsNothing);
      await tester.tap(find.byKey(const Key('payment-pay-at-delivery')));
      await tester.pumpAndSettle();
      for (final m in [
        'INSTAPAY',
        'VODAFONE_CASH',
        'ORANGE_CASH',
        'ETISALAT_CASH',
        'WE_PAY'
      ]) {
        expect(find.byKey(Key('electronic-$m')), findsOneWidget, reason: m);
      }
      expect(find.text('إنستاباي'), findsOneWidget);
      expect(find.text('فودافون كاش'), findsOneWidget);
      expect(find.text('أورانج كاش'), findsOneWidget);
      expect(find.text('اتصالات كاش'), findsOneWidget);
      expect(find.text('WE Pay'), findsOneWidget);
    });

    testWidgets(
        'an electronic option needs a method: the CTA stays disabled with a hint until one is chosen',
        (tester) async {
      final h = await _pump(tester);
      await tester.tap(find.byKey(const Key('payment-manual-transfer')));
      await tester.pumpAndSettle();
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNull);
      expect(find.byKey(const Key('checkout-cta-hint')), findsOneWidget);
      await tester.tap(find.byKey(const Key('electronic-VODAFONE_CASH')));
      await tester.pumpAndSettle();
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNotNull);
      expect(h.checkout.requests.last.toJson()['electronicPaymentMethod'],
          'VODAFONE_CASH');
    });

    for (final payment in [
      'payment-pay-at-delivery',
      'payment-manual-transfer'
    ]) {
      testWidgets(
          '$payment: every method can be chosen from the screen — the prompt turns into a label, Confirm is enabled and the chip shows as selected',
          (tester) async {
        for (final m in [
          'INSTAPAY',
          'VODAFONE_CASH',
          'ORANGE_CASH',
          'ETISALAT_CASH',
          'WE_PAY'
        ]) {
          final h = _Harness();
          h.checkout.respond = (r) {
            final needs = r.paymentMethod != 'COD';
            final q = quoteJson(
                canPlace: !needs || r.electronicPaymentMethod != null);
            (q['payment'] as Map)['selected'] = {
              'method': r.paymentMethod,
              'electronicMethod': r.electronicPaymentMethod
            };
            return q;
          };
          await _pump(tester, harness: h);
          await tester.tap(find.byKey(Key(payment)));
          await tester.pumpAndSettle();
          expect(find.text('اختر وسيلة الدفع الإلكتروني'), findsWidgets,
              reason: 'nothing chosen yet → a prompt');
          expect(
              tester
                  .widget<ElevatedButton>(
                      find.byKey(const Key('checkout-confirm')))
                  .onPressed,
              isNull);

          await tester.tap(find.byKey(Key('electronic-$m')));
          await tester.pumpAndSettle();
          expect(find.text('اختر وسيلة الدفع الإلكتروني'), findsNothing,
              reason: '$m chosen → no more "choose" prompt anywhere');
          expect(find.byKey(const Key('checkout-electronic-heading')),
              findsOneWidget);
          expect(
              tester
                  .widget<ChoiceChip>(find.byKey(Key('electronic-$m')))
                  .selected,
              isTrue);
          expect(
              tester
                  .widget<ElevatedButton>(
                      find.byKey(const Key('checkout-confirm')))
                  .onPressed,
              isNotNull);
          await tester.pumpWidget(const SizedBox());
        }
      });
    }

    testWidgets(
        'when the server refuses the chosen method the button says why instead of staying silently disabled',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (r) {
        final bad = r.electronicPaymentMethod == 'WE_PAY';
        final q = quoteJson(canPlace: !bad);
        if (bad) {
          q['blockers'] = [
            {'code': 'ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE', 'message': 'x'}
          ];
        }
        return q;
      };
      await _pump(tester, harness: h);
      await tester.tap(find.byKey(const Key('payment-pay-at-delivery')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('electronic-WE_PAY')));
      await tester.pumpAndSettle();
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNull);
      expect(find.text('وسيلة الدفع هذه غير متاحة حاليًا، اختر وسيلة أخرى'),
          findsOneWidget);
      await tester.tap(find.byKey(const Key('electronic-INSTAPAY')));
      await tester.pumpAndSettle();
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNotNull);
    });

    testWidgets(
        'wallet + Manual Transfer (PD-001 amended): the wallet stays available; the wallet part and the remainder to TRANSFER are shown clearly',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (r) {
        final base = quoteJson(wallet: r.useWallet ? 3000 : 0);
        (base['payment'] as Map)['selected'] = {
          'method': r.paymentMethod,
          'electronicMethod': r.electronicPaymentMethod
        };
        (base['payment'] as Map)['awaitsPaymentApproval'] =
            r.paymentMethod == 'MANUAL_TRANSFER';
        return base;
      };
      await _pump(tester, harness: h);
      await tester.tap(find.byKey(const Key('payment-manual-transfer')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('electronic-VODAFONE_CASH')));
      await tester.pumpAndSettle();

      final wallet = tester
          .widget<Switch>(find.byKey(const Key('checkout-wallet-switch')));
      expect(wallet.onChanged, isNotNull,
          reason: 'the wallet is no longer disabled by Manual Transfer');
      expect(
          find.text('لا يمكن الجمع بين المحفظة والتحويل اليدوي'), findsNothing);

      await tester.tap(find.byKey(const Key('checkout-wallet-switch')));
      await tester.pumpAndSettle();
      final json = h.checkout.requests.last.toJson();
      expect(json['paymentMethod'], 'MANUAL_TRANSFER');
      expect(json['useWallet'], isTrue);
      expect(find.text('-30 ج.م'), findsWidgets); // wallet part
      expect(find.text('المتبقي للدفع بالتحويل'), findsOneWidget);
      expect(find.text('85 ج.م'), findsWidgets); // remainder = 115 - 30
      expect(find.text('تأكيد الطلب ومتابعة الدفع'), findsOneWidget);
    });

    testWidgets(
        'Manual Transfer unavailable for weighed items: shown disabled with the reason, not hidden',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) {
        final q = quoteJson();
        ((q['payment'] as Map)['options'] as Map)['manualTransfer'] = {
          'available': false,
          'reason': 'WEIGHED_ITEMS'
        };
        return q;
      };
      await _pump(tester, harness: h);
      expect(
          find.text(
              'غير متاح للطلبات التي تحتوي على منتجات بالوزن لأن السعر النهائي يُحسب بعد الوزن'),
          findsOneWidget);
      await tester.tap(find.byKey(const Key('payment-manual-transfer')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('electronic-INSTAPAY')), findsNothing);
    });

    testWidgets('only the electronic methods the SERVER offers are listed',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) {
        final q = quoteJson();
        ((q['payment'] as Map)['options'] as Map)['electronicMethods'] = [
          'INSTAPAY',
          'WE_PAY'
        ];
        return q;
      };
      await _pump(tester, harness: h);
      await tester.tap(find.byKey(const Key('payment-pay-at-delivery')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('electronic-INSTAPAY')), findsOneWidget);
      expect(find.byKey(const Key('electronic-WE_PAY')), findsOneWidget);
      expect(find.byKey(const Key('electronic-VODAFONE_CASH')), findsNothing);
    });

    // ignore_for_file: deprecated_member_use
    testWidgets(
        'options are announced as a mutually exclusive radio group with the checked state',
        (tester) async {
      final handle = tester.ensureSemantics();
      await _pump(tester);
      final cod = tester.getSemantics(find.byKey(const Key('payment-cod')));
      expect(cod.hasFlag(SemanticsFlag.isInMutuallyExclusiveGroup), isTrue);
      expect(cod.hasFlag(SemanticsFlag.hasCheckedState), isTrue);
      expect(cod.hasFlag(SemanticsFlag.isChecked), isTrue);
      final transfer =
          tester.getSemantics(find.byKey(const Key('payment-manual-transfer')));
      expect(transfer.hasFlag(SemanticsFlag.isChecked), isFalse);
      handle.dispose();
    });
  });

  group('wallet', () {
    testWidgets(
        'turning it on shows what the wallet pays and what is still due (the server numbers)',
        (tester) async {
      final h = _Harness();
      h.checkout.respond =
          (r) => r.useWallet ? quoteJson(wallet: 5000) : quoteJson();
      await _pump(tester, harness: h);
      await tester.tap(find.byKey(const Key('checkout-wallet-switch')));
      await tester.pumpAndSettle();
      expect(h.checkout.requests.last.toJson()['useWallet'], isTrue);
      expect(find.text('-50 ج.م'), findsWidgets);
      expect(find.text('65 ج.م'), findsWidgets); // amount due = 115 - 50
    });

    testWidgets(
        'a wallet that covers everything replaces the method list with a clear statement',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (r) => r.useWallet
          ? quoteJson(wallet: 11500, overrides: {
              'payment': {
                'selected': {'method': 'WALLET', 'electronicMethod': null},
                'awaitsPaymentApproval': false,
                'wallet': {
                  'balanceMinor': 20000,
                  'appliedMinor': 11500,
                  'available': true
                },
                'options': {
                  'cod': true,
                  'payAtDelivery': true,
                  'manualTransfer': {'available': true},
                  'electronicMethods': ['INSTAPAY']
                },
              },
            })
          : quoteJson();
      await _pump(tester, harness: h);
      await tester.tap(find.byKey(const Key('checkout-wallet-switch')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-paid-by-wallet')), findsOneWidget);
      expect(find.byKey(const Key('payment-cod')), findsNothing);
    });

    testWidgets('an empty wallet cannot be switched on', (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) {
        final q = quoteJson();
        ((q['payment'] as Map)['wallet'] as Map)['balanceMinor'] = 0;
        return q;
      };
      await _pump(tester, harness: h);
      expect(
          tester
              .widget<Switch>(find.byKey(const Key('checkout-wallet-switch')))
              .onChanged,
          isNull);
      expect(find.text('رصيد المحفظة صفر'), findsOneWidget);
    });
  });

  group('coupon', () {
    testWidgets(
        'an applied coupon shows its saving and vendor; removing it re-quotes',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (r) => r.couponCode == null
          ? quoteJson()
          : quoteJson(discount: 1000, overrides: {
              'coupon': {
                'status': 'APPLIED',
                'code': r.couponCode,
                'discountMinor': 1000,
                'vendorName': 'مطعم النخيل',
              },
            });
      await _pump(tester, harness: h);
      await tester.tap(find.text('لديك كود خصم؟'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('checkout-coupon-field')), 'save10');
      await tester.tap(find.byKey(const Key('checkout-coupon-apply')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-coupon-applied')), findsOneWidget);
      expect(find.text('SAVE10'), findsOneWidget);
      expect(find.textContaining('وفّرت 10 ج.م'), findsOneWidget);
      expect(
          find.text('-10 ج.م'), findsOneWidget); // discount row of the totals

      await tester.tap(find.text('إزالة'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-coupon-applied')), findsNothing);
      expect(
          h.checkout.requests.last.toJson().containsKey('couponCode'), isFalse);
    });

    testWidgets(
        'a refused coupon shows the server reason next to the field and does not block the order',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (r) => r.couponCode == null
          ? quoteJson()
          : quoteJson(overrides: {
              'coupon': {
                'status': 'REJECTED',
                'code': r.couponCode,
                'reasonCode': 'COUPON_EXPIRED'
              },
            });
      await _pump(tester, harness: h);
      await tester.tap(find.text('لديك كود خصم؟'));
      await tester.pumpAndSettle();
      await tester.enterText(
          find.byKey(const Key('checkout-coupon-field')), 'OLD');
      await tester.tap(find.byKey(const Key('checkout-coupon-apply')));
      await tester.pumpAndSettle();
      expect(find.text('انتهت صلاحية كود الخصم'), findsOneWidget);
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNotNull);
    });
  });

  group('placing the order', () {
    testWidgets('success goes to the success screen for the created order',
        (tester) async {
      final h = await _pump(tester);
      await tester.tap(find.byKey(const Key('checkout-confirm')));
      await tester.pumpAndSettle();
      expect(h.orders.created, hasLength(1));
      expect(h.orders.created.single.quoteToken, 'token-1');
      expect(find.text('success order-1'), findsOneWidget);
    });

    testWidgets(
        'a stale quote keeps the customer on checkout, shows the notice and the NEW total; the second tap succeeds',
        (tester) async {
      final h = await _pump(tester);
      h.orders.failWith = ApiException(
        code: 'CONFLICT',
        message: 'changed',
        statusCode: 409,
        details: {
          'code': 'QUOTE_STALE',
          'reason': 'AMOUNTS_CHANGED',
          'changes': ['deliveryFeeMinor'],
          'currentQuote': quoteJson(fee: 2500)..['quoteToken'] = 'token-2',
        },
      );
      await tester.tap(find.byKey(const Key('checkout-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-stale-notice')), findsOneWidget);
      expect(find.text('success order-1'), findsNothing);
      expect(_textOf(tester, const Key('checkout-total')), '125 ج.م');

      h.orders.failWith = null;
      await tester.tap(find.byKey(const Key('checkout-confirm')));
      await tester.pumpAndSettle();
      expect(h.orders.created.last.quoteToken, 'token-2');
      expect(find.text('success order-1'), findsOneWidget);
    });

    testWidgets(
        'a business failure is explained in the customer\'s language and the button works again',
        (tester) async {
      final h = await _pump(tester);
      h.orders.failWith = const ApiException(
          code: 'CONFLICT',
          message: 'x',
          details: {'code': 'INSUFFICIENT_INVENTORY'});
      await tester.tap(find.byKey(const Key('checkout-confirm')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-submit-error')), findsOneWidget);
      expect(find.text('لا تتوفر كمية كافية لمنتج واحد أو أكثر في سلتك.'),
          findsOneWidget);
      expect(
          tester
              .widget<ElevatedButton>(find.byKey(const Key('checkout-confirm')))
              .onPressed,
          isNotNull);
    });
  });

  group('states', () {
    testWidgets('an empty cart shows the empty state, not a checkout form',
        (tester) async {
      final h = _Harness();
      h.checkout.respond = (_) => {
            'canPlaceOrder': false,
            'blockers': [
              {'code': 'EMPTY_CART', 'message': 'Your cart is empty.'}
            ],
            'quoteToken': null,
            'expiresAt': null,
          };
      await _pump(tester, harness: h);
      expect(find.byKey(const Key('checkout-confirm')), findsNothing);
      expect(find.text('سلتك مستنيا طلبك'), findsOneWidget);
    });

    testWidgets('a failed quote shows an error with retry', (tester) async {
      final h = _Harness();
      h.checkout.failWith =
          const ApiException(code: 'NETWORK_ERROR', message: 'offline');
      await _pump(tester, harness: h);
      expect(find.text('إعادة المحاولة'), findsOneWidget);
      h.checkout.failWith = null;
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-confirm')), findsOneWidget);
    });
  });

  group('themes, RTL and small screens', () {
    for (final dark in [false, true]) {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final scale in [1.0, 2.0]) {
          testWidgets(
              'no overflow / exceptions: ${locale.languageCode} ${dark ? 'dark' : 'light'} 320 ${scale}x text',
              (tester) async {
            final h = _Harness();
            // The busiest possible state: several payment layers open, coupon expanded.
            await _pump(tester,
                dark: dark,
                locale: locale,
                scale: scale,
                width: 320,
                height: 6000,
                harness: h);
            await _tapVisible(tester, const Key('payment-pay-at-delivery'));
            await _tapVisible(tester, const Key('checkout-delivery-breakdown'));
            await _tapVisible(tester, const Key('checkout-coupon'));
            expect(tester.takeException(), isNull);
          });
        }
      }
    }

    testWidgets(
        'RTL: the fulfilment toggle keeps Delivery on the right in Arabic',
        (tester) async {
      await _pump(tester);
      final delivery = tester.getCenter(find.text('توصيل'));
      final pickup = tester.getCenter(find.text('استلام من الفرع'));
      expect(delivery.dx, greaterThan(pickup.dx));
    });
  });
}
