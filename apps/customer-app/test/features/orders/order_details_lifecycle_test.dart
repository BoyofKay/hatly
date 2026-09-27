import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

Future<List<String>> _pump(
  WidgetTester tester,
  FakeOrdersReadApi api, {
  bool dark = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
}) async {
  final visited = <String>[];
  tester.view.physicalSize = Size(width * 3, 4000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    dark: dark,
    locale: locale,
    textScale: scale,
    overrides: [
      ordersApiProvider.overrideWithValue(api),
      orderRatingStateProvider.overrideWith(
          (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
      supportContactProvider.overrideWith(
          (ref) async => const SupportContact(whatsappNumber: '+201000000000')),
    ],
    routes: [
      GoRoute(path: '/', builder: (c, s) => const OrderDetailsScreen(orderId: orderId)),
      probeRoute('/orders/:id/tracking', visited: visited),
    ],
  ));
  await tester.pumpAndSettle();
  return visited;
}

double _top(WidgetTester tester, Finder f) => tester.getTopLeft(f).dy;

void main() {
  group('sections, in the approved order', () {
    testWidgets('status+ETA → timeline → vendors → pricing → delivery breakdown → payment → address → support', (tester) async {
      await _pump(tester, FakeOrdersReadApi(details: orderDetailsJson(status: 'PREPARING', canCancel: false)));
      final order = [
        find.byKey(const Key('order-status-title')),
        find.byKey(const Key('order-timeline')),
        find.text('برجر لحم'),
        find.text('ملخص الحساب'),
        find.byKey(const Key('order-delivery-breakdown')),
        find.byKey(const Key('order-payment')),
        find.byKey(const Key('order-address')),
        find.byKey(const Key('order-support-contact')),
      ];
      var last = -1.0;
      for (final f in order) {
        expect(f, findsOneWidget, reason: '$f');
        final y = _top(tester, f);
        expect(y, greaterThan(last), reason: '$f is out of order');
        last = y;
      }
    });

    testWidgets('products show their option snapshot and notes', (tester) async {
      await _pump(tester, FakeOrdersReadApi());
      expect(find.text('الحجم: كبير (+5 ج.م)'), findsOneWidget);
      expect(find.text('الصوص: ثوم'), findsOneWidget);
      expect(find.text('بدون بصل'), findsOneWidget);
    });

    testWidgets('pricing: subtotal, delivery fee, discount + coupon line, total', (tester) async {
      await _pump(
          tester,
          FakeOrdersReadApi(
              details: orderDetailsJson(discount: 1000, coupon: {
            'code': 'SAVE10',
            'offerName': 'خصم 10',
            'discountMinor': 1000,
            'vendorBranchId': 'b1',
            'orderVendorSegmentId': 's1',
          })));
      expect(find.text('100 ج.م'), findsOneWidget); // subtotal
      expect(find.text('15 ج.م'), findsWidgets); // delivery fee (also in the breakdown)
      expect(find.text('-10 ج.م'), findsOneWidget);
      expect(find.byKey(const Key('order-coupon')), findsOneWidget);
      expect(find.text('كود الخصم \u2066SAVE10\u2069: وفّرت 10 ج.م'), findsOneWidget);
      expect(find.text('105 ج.م'), findsOneWidget); // total
    });

    testWidgets('the delivery breakdown is the FROZEN one: base + additional vendors + distance', (tester) async {
      await _pump(tester, FakeOrdersReadApi());
      expect(find.text('10 ج.م'), findsOneWidget);
      expect(find.text('5 ج.م'), findsOneWidget);
      expect(find.text('3.4 كم'), findsOneWidget);
      expect(find.text('متاجر إضافية (1)'), findsOneWidget);
    });

    testWidgets('payment: method with the chosen electronic method, wallet share and what is still due', (tester) async {
      await _pump(
          tester,
          FakeOrdersReadApi(
              details: orderDetailsJson(paymentMethod: 'PAY_AT_DELIVERY', electronicMethod: 'ORANGE_CASH', wallet: 3000)));
      expect(find.text('الدفع عند الاستلام عبر أورانج كاش'), findsOneWidget);
      expect(find.text('30 ج.م'), findsOneWidget);
      expect(find.text('85 ج.م'), findsOneWidget);
    });

    testWidgets('a manual transfer under review says so and is not shown as paid', (tester) async {
      await _pump(
          tester,
          FakeOrdersReadApi(
              details: orderDetailsJson(
                  paymentMethod: 'MANUAL_TRANSFER',
                  electronicMethod: 'INSTAPAY',
                  paymentStatus: 'UNDER_REVIEW',
                  awaiting: true,
                  canCancel: false)));
      expect(find.text('قيد المراجعة'), findsOneWidget);
      expect(find.text('تم الدفع'), findsNothing);
      expect(find.byKey(const Key('order-payment-awaiting')), findsOneWidget);
    });

    testWidgets('the address is the order\'s SNAPSHOT, shown with its structured details', (tester) async {
      await _pump(tester, FakeOrdersReadApi());
      final address = find.byKey(const Key('order-address'));
      expect(find.descendant(of: address, matching: find.text('المنزل')), findsOneWidget);
      expect(find.descendant(of: address, matching: find.text('12 · 3 · 8')), findsOneWidget);
      expect(find.descendant(of: address, matching: find.text('بلبيس، الشرقية')), findsOneWidget);
    });

    testWidgets('a pickup order has no address card and no delivery breakdown', (tester) async {
      await _pump(tester, FakeOrdersReadApi(details: orderDetailsJson(pickup: true)));
      expect(find.byKey(const Key('order-address')), findsNothing);
      expect(find.byKey(const Key('order-delivery-breakdown')), findsNothing);
    });

    testWidgets('Track opens the tracking screen', (tester) async {
      final visited = await _pump(tester, FakeOrdersReadApi());
      await tester.tap(find.byKey(const Key('order-track')));
      await tester.pumpAndSettle();
      expect(visited.last, '/orders/$orderId/tracking');
    });
  });

  group('customer cancellation (whole order only)', () {
    testWidgets('offered only when the server says the order can be cancelled', (tester) async {
      await _pump(tester, FakeOrdersReadApi(details: orderDetailsJson(canCancel: false)));
      expect(find.byKey(const Key('order-cancel')), findsNothing);
      await _pump(tester, FakeOrdersReadApi(details: orderDetailsJson(canCancel: true)));
      expect(find.byKey(const Key('order-cancel')), findsOneWidget);
    });

    testWidgets('there is NO per-vendor cancel action anywhere', (tester) async {
      await _pump(tester, FakeOrdersReadApi());
      expect(find.byKey(const Key('order-cancel')), findsOneWidget);
      expect(find.text('إلغاء الطلب'), findsOneWidget, reason: 'exactly one cancel control: the whole order');
    });

    testWidgets('asks for confirmation; keeping the order cancels nothing', (tester) async {
      final api = FakeOrdersReadApi();
      await _pump(tester, api);
      await tester.tap(find.byKey(const Key('order-cancel')));
      await tester.pumpAndSettle();
      expect(find.text('إلغاء الطلب بالكامل؟'), findsOneWidget);
      await tester.tap(find.text('الاحتفاظ بالطلب'));
      await tester.pumpAndSettle();
      expect(api.cancelCalls, isEmpty);
    });

    testWidgets('confirming cancels with the optional reason, then the order reads as cancelled and the button is gone', (tester) async {
      final api = FakeOrdersReadApi();
      await _pump(tester, api);
      await tester.tap(find.byKey(const Key('order-cancel')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('order-cancel-reason')), 'غيرت رأيي');
      await tester.tap(find.byKey(const Key('order-cancel-confirm')));
      await tester.pumpAndSettle();
      expect(api.cancelCalls.single, (orderId: orderId, reason: 'غيرت رأيي'));
      expect(find.text('تم إلغاء الطلب'), findsWidgets);
      expect(find.byKey(const Key('order-cancel')), findsNothing);
    });

    testWidgets('a race (a vendor just started preparing): the server refusal is explained and the button goes away', (tester) async {
      final api = FakeOrdersReadApi();
      await _pump(tester, api);
      api.cancelFailure = const ApiException(
          code: 'CONFLICT',
          message: 'no',
          details: {'code': 'ORDER_NOT_CANCELLABLE_BY_CUSTOMER', 'reason': 'VENDOR_SEGMENT_PREPARING'});
      api.details = orderDetailsJson(status: 'PREPARING', canCancel: false);
      await tester.tap(find.byKey(const Key('order-cancel')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('order-cancel-confirm')));
      await tester.pumpAndSettle();
      expect(find.text('لم يعد بإمكانك إلغاء هذا الطلب لأن أحد المتاجر بدأ التجهيز'), findsOneWidget);
      expect(find.byKey(const Key('order-cancel')), findsNothing);
    });
  });

  group('themes, RTL and small screens', () {
    for (final dark in [false, true]) {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final scale in [1.0, 2.0]) {
          testWidgets('no overflow: ${locale.languageCode} ${dark ? 'dark' : 'light'} 320 ${scale}x', (tester) async {
            await _pump(
                tester,
                FakeOrdersReadApi(
                    details: orderDetailsJson(
                        paymentMethod: 'PAY_AT_DELIVERY',
                        electronicMethod: 'ETISALAT_CASH',
                        wallet: 2000,
                        discount: 1000,
                        coupon: {
                          'code': 'SAVE10',
                          'offerName': 'x',
                          'discountMinor': 1000,
                          'vendorBranchId': 'b1',
                          'orderVendorSegmentId': null,
                        })),
                dark: dark,
                locale: locale,
                scale: scale,
                width: 320);
            expect(tester.takeException(), isNull);
          });
        }
      }
    }
  });
}
