import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/core/push/notification_deep_link.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/orders/presentation/order_widgets.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

/// Push Notifications / Deep Links — what actually happens once
/// [notificationDeepLinkRoute] is navigated to. Confirms the real,
/// EXISTING Order Details screen (no new screen, no notification-only
/// code path) is what renders, and — the actual security requirement —
/// that an order the authenticated customer cannot see (the fake API
/// standing in for the backend's own authorization rejecting it, or
/// the order simply not existing) never renders any order content:
/// the screen's own existing generic error state is what shows,
/// exactly as it would for any other navigation to that route.
void main() {
  Future<void> pump(WidgetTester tester, FakeOrdersReadApi api) async {
    await tester.pumpWidget(hatlyRouterApp(
      initialLocation: '/orders/$orderId',
      overrides: [
        ordersApiProvider.overrideWithValue(api),
        orderRatingStateProvider.overrideWith(
            (ref, id) => Future.error(Exception('none'))),
        supportContactProvider.overrideWith(
            (ref) async => const SupportContact(whatsappNumber: '+201000000000')),
      ],
      routes: [
        GoRoute(
          path: '/orders/:id',
          builder: (c, s) =>
              OrderDetailsScreen(orderId: s.pathParameters['id']!),
        ),
      ],
    ));
    await tester.pumpAndSettle();
  }

  test('the route built from a valid deep link is the existing /orders/:id path', () {
    const link = NotificationDeepLink(type: 'ORDER_CONFIRMED', orderId: orderId);
    expect(notificationDeepLinkRoute(link), '/orders/$orderId');
  });

  testWidgets(
      'a valid order notification renders the real Order Details screen with the order\'s data',
      (tester) async {
    final api = FakeOrdersReadApi(details: orderDetailsJson(status: 'CONFIRMED'));
    await pump(tester, api);

    expect(find.byType(OrderDetailsScreen), findsOneWidget);
    expect(find.textContaining(orderNumberTag(orderNumber)), findsOneWidget);
  });

  testWidgets(
      'an order that does not belong to this customer (or no longer exists) shows the existing safe error state — never order content',
      (tester) async {
    final api = FakeOrdersReadApi()
      ..detailsFailure =
          const ApiException(code: 'FORBIDDEN', message: 'Not your order.');
    await pump(tester, api);

    expect(find.byType(OrderDetailsScreen), findsOneWidget);
    // The generic error branch (order_details_screen.dart's own
    // `error:` case) — no order number, no pricing, no address ever
    // rendered from a rejected fetch.
    expect(find.textContaining(orderNumberTag(orderNumber)), findsNothing);
    expect(find.byIcon(Icons.error_outline), findsOneWidget);
  });

  testWidgets('a genuinely nonexistent order behaves the same way (safe error, no data leak)',
      (tester) async {
    final api = FakeOrdersReadApi()
      ..detailsFailure = const ApiException(code: 'NOT_FOUND', message: 'No such order.');
    await pump(tester, api);

    expect(find.byIcon(Icons.error_outline), findsOneWidget);
    expect(find.textContaining(orderNumberTag(orderNumber)), findsNothing);
  });
}
