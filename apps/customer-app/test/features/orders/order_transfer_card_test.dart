import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

/// Owner UAT 2026-11-27 (MT-01): leaving the payment page never loses it — an unconfirmed manual transfer shows what to do on the order.
void main() {
  Future<List<String>> pump(WidgetTester tester, Map<String, dynamic> json) async {
    tester.view.physicalSize = const Size(390 * 3, 4000 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final visited = <String>[];
    await tester.pumpWidget(hatlyRouterApp(
      locale: const Locale('en'),
      overrides: [
        ordersApiProvider.overrideWithValue(FakeOrdersReadApi(details: json)),
        orderRatingStateProvider.overrideWith((ref, id) => Future<OrderRatingState>.error(Exception('none'))),
        supportContactProvider.overrideWith((ref) async => const SupportContact(whatsappNumber: '+201104949903')),
      ],
      routes: [
        GoRoute(path: '/', builder: (c, s) => const OrderDetailsScreen(orderId: orderId)),
        probeRoute('/checkout/transfer/:orderId', visited: visited),
      ],
    ));
    await tester.pumpAndSettle();
    return visited;
  }

  testWidgets('a transfer not sent yet: a warning card reopens the payment steps', (tester) async {
    final visited = await pump(tester, orderDetailsJson(paymentMethod: 'MANUAL_TRANSFER', electronicMethod: 'INSTAPAY', paymentStatus: 'PENDING', awaiting: true));
    expect(find.byKey(const Key('order-transfer-needed')), findsOneWidget);
    await tester.tap(find.byKey(const Key('order-transfer-open')));
    await tester.pumpAndSettle();
    expect(visited.last, '/checkout/transfer/$orderId?m=INSTAPAY');
  });

  testWidgets('a transfer under review says so; a paid one shows no card', (tester) async {
    await pump(tester, orderDetailsJson(paymentMethod: 'MANUAL_TRANSFER', electronicMethod: 'INSTAPAY', paymentStatus: 'UNDER_REVIEW', awaiting: true));
    expect(find.byKey(const Key('order-transfer-review')), findsOneWidget);
    expect(find.byKey(const Key('order-transfer-needed')), findsNothing);
  });

  testWidgets('cash on delivery shows no transfer card', (tester) async {
    await pump(tester, orderDetailsJson());
    expect(find.byKey(const Key('order-transfer-needed')), findsNothing);
    expect(find.byKey(const Key('order-transfer-review')), findsNothing);
  });
}
