import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/checkout/presentation/order_success_screen.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

({int? totalMinor, String paymentMethodLabel, String? orderNumber})? lastTransferExtra;

Future<List<String>> _pump(
  WidgetTester tester,
  FakeOrdersReadApi api, {
  bool dark = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
}) async {
  final visited = <String>[];
  tester.view.physicalSize = Size(width * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    initialLocation: '/checkout/success/$orderId',
    dark: dark,
    locale: locale,
    textScale: scale,
    overrides: [ordersApiProvider.overrideWithValue(api)],
    routes: [
      GoRoute(path: '/', builder: (c, s) => const Scaffold(body: Text('home'))),
      GoRoute(
        path: '/checkout/success/:orderId',
        builder: (c, s) =>
            OrderSuccessScreen(orderId: s.pathParameters['orderId']!),
      ),
      probeRoute('/orders/:id', visited: visited),
      probeRoute('/orders/:id/tracking', visited: visited),
      GoRoute(
        path: '/checkout/transfer/:orderId',
        builder: (c, st) {
          visited.add(st.uri.toString());
          lastTransferExtra = st.extra as ({int? totalMinor, String paymentMethodLabel, String? orderNumber})?;
          return const Scaffold(body: Text('transfer'));
        },
      ),
    ],
  ));
  await tester.pumpAndSettle();
  return visited;
}

void main() {
  testWidgets('a COD order: reference, status, payment, total, ETA window and vendors — with Track / Details', (tester) async {
    await _pump(tester, FakeOrdersReadApi());
    expect(find.text('تم استلام طلبك'), findsOneWidget);
    expect(find.text('#HT-100001'), findsOneWidget);
    expect(find.text('الدفع نقدًا عند الاستلام'), findsOneWidget);
    expect(find.text('115 ج.م'), findsOneWidget);
    expect(find.text('مطعم النخيل، صيدلية الأمل'), findsOneWidget);
    expect(find.byKey(const Key('order-eta')), findsOneWidget);
    expect(find.byKey(const Key('success-track')), findsOneWidget);
    expect(find.byKey(const Key('success-details')), findsOneWidget);
    expect(find.byKey(const Key('success-complete-payment')), findsNothing);
    expect(find.byKey(const Key('order-payment-awaiting')), findsNothing);
  });

  testWidgets('Track and Details navigate to the created order', (tester) async {
    final visited = await _pump(tester, FakeOrdersReadApi());
    await tester.tap(find.byKey(const Key('success-track')));
    await tester.pumpAndSettle();
    expect(visited.last, '/orders/$orderId/tracking');
    tester.state<NavigatorState>(find.byType(Navigator).first).pop();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('success-details')));
    await tester.pumpAndSettle();
    expect(visited.last, '/orders/$orderId');
  });

  testWidgets('a manual transfer says the payment is awaiting review — never "paid" — and offers to send the proof', (tester) async {
    final visited = await _pump(
      tester,
      FakeOrdersReadApi(
        details: orderDetailsJson(
          paymentMethod: 'MANUAL_TRANSFER',
          electronicMethod: 'VODAFONE_CASH',
          paymentStatus: 'PENDING',
          awaiting: true,
        ),
      ),
    );
    expect(find.text('تم إنشاء طلبك، والدفع قيد المراجعة'), findsOneWidget);
    expect(find.byKey(const Key('order-payment-awaiting')), findsOneWidget);
    expect(find.text('تحويل مسبق عبر فودافون كاش'), findsOneWidget);
    expect(find.text('تم استلام طلبك'), findsNothing);
    await tester.tap(find.byKey(const Key('success-complete-payment')));
    await tester.pumpAndSettle();
    expect(visited.last, '/checkout/transfer/$orderId?m=VODAFONE_CASH');
  });

  testWidgets('wallet + Manual Transfer: the amount to TRANSFER is the remainder after the wallet, never the full total', (tester) async {
    await _pump(
      tester,
      FakeOrdersReadApi(
        details: orderDetailsJson(
          paymentMethod: 'MANUAL_TRANSFER',
          electronicMethod: 'INSTAPAY',
          paymentStatus: 'PENDING',
          awaiting: true,
          wallet: 3000,
        ),
      ),
    );
    expect(find.text('115 ج.م'), findsOneWidget); // total
    expect(find.text('30 ج.م'), findsOneWidget); // paid from the wallet
    expect(find.text('85 ج.م'), findsOneWidget); // still due (by transfer)
    await tester.tap(find.byKey(const Key('success-complete-payment')));
    await tester.pumpAndSettle();
    expect(lastTransferExtra!.totalMinor, 8500);
  });

  testWidgets('a wallet contribution is shown', (tester) async {
    await _pump(tester, FakeOrdersReadApi(details: orderDetailsJson(paymentMethod: 'PAY_AT_DELIVERY', electronicMethod: 'WE_PAY', wallet: 2000)));
    expect(find.text('المدفوع من المحفظة'), findsOneWidget);
    expect(find.text('20 ج.م'), findsOneWidget);
    expect(find.text('الدفع عند الاستلام عبر WE Pay'), findsOneWidget);
  });

  testWidgets('no ETA to show: the honest reason instead of a made-up time', (tester) async {
    await _pump(
        tester,
        FakeOrdersReadApi(
            details: orderDetailsJson(eta: {
          'state': 'UNAVAILABLE',
          'reason': 'PREPARATION_TIME_NOT_CONFIGURED',
        })));
    expect(find.byKey(const Key('order-eta')), findsNothing);
    expect(find.byKey(const Key('order-eta-unavailable')), findsOneWidget);
  });

  testWidgets('if reading the order back fails, it never claims the order was not placed', (tester) async {
    final api = FakeOrdersReadApi()..detailsFailure = Exception('offline');
    await _pump(tester, api);
    expect(find.text('تم إنشاء طلبك، لكن تعذّر تحميل تفاصيله الآن'), findsOneWidget);
    api.detailsFailure = null;
    await tester.tap(find.text('إعادة المحاولة'));
    await tester.pumpAndSettle();
    expect(find.text('تم استلام طلبك'), findsOneWidget);
  });

  testWidgets('system back returns Home rather than the emptied cart', (tester) async {
    await _pump(tester, FakeOrdersReadApi());
    final NavigatorState nav = tester.state(find.byType(Navigator).first);
    await nav.maybePop();
    await tester.pumpAndSettle();
    expect(find.text('home'), findsOneWidget);
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
                        paymentMethod: 'MANUAL_TRANSFER',
                        electronicMethod: 'ETISALAT_CASH',
                        paymentStatus: 'PENDING',
                        awaiting: true,
                        wallet: 0)),
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
