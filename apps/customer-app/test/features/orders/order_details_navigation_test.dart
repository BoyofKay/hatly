import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/push/notification_deep_link.dart';
import 'package:hatly_customer/core/push/notification_navigation_coordinator.dart';
import 'package:hatly_customer/core/routing/router_stack.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

/// Order Details must always have a way back, whichever way it was reached — and Back must never close the app or strand the
/// customer. Tested against a REAL GoRouter + Navigator (so the stack is the real one), with the production router helpers.
const _otherOrderId = '9d1f0000-aaaa-bbbb-cccc-1234567890ab';

class _Route {
  _Route(this.router);
  final GoRouter router;
  String get top => router.topLocation;
}

Future<_Route> _pump(
  WidgetTester tester, {
  String initialLocation = '/',
  Object? detailsFailure,
  Locale locale = const Locale('ar'),
}) async {
  tester.view.physicalSize = const Size(390 * 3, 1600 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(initialLocation: initialLocation, routes: [
    GoRoute(
      path: '/',
      builder: (c, s) => Scaffold(
        appBar: AppBar(title: const Text('HOME-SCREEN')),
        body: Center(
          child: ElevatedButton(
            key: const Key('open-order'),
            onPressed: () =>
                c.push('/orders/$orderId'), // exactly what the Orders list does
            child: const Text('open order'),
          ),
        ),
      ),
    ),
    GoRoute(
        path: '/orders/:id',
        builder: (c, s) =>
            OrderDetailsScreen(orderId: s.pathParameters['id']!)),
    GoRoute(
        path: '/checkout/transfer/:id',
        builder: (c, s) => const Scaffold(body: Text('TRANSFER-SCREEN'))),
  ]);
  final api = FakeOrdersReadApi()..detailsFailure = detailsFailure;
  await tester.pumpWidget(hatlyRouterApp(
    router: router,
    locale: locale,
    routes: const [],
    overrides: [
      ordersApiProvider.overrideWithValue(api),
      orderRatingStateProvider.overrideWith(
          (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
      supportContactProvider.overrideWith(
          (ref) async => const SupportContact(whatsappNumber: '+201104949903')),
    ],
  ));
  await tester.pumpAndSettle();
  return _Route(router);
}

Finder get _home => find.text('HOME-SCREEN');
Finder get _details => find.byType(OrderDetailsScreen);

void main() {
  group('opened from the Orders list (pushed on top of it)', () {
    testWidgets(
        'a visible Back arrow is shown and returns to the list; the list is not rebuilt as a second Order Details',
        (tester) async {
      final r = await _pump(tester);
      await tester.tap(find.byKey(const Key('open-order')));
      await tester.pumpAndSettle();
      expect(_details, findsOneWidget);
      expect(r.top, '/orders/$orderId');
      expect(find.byType(BackButton), findsOneWidget);
      expect(find.byKey(const Key('order-details-back')), findsNothing,
          reason:
              'the framework back arrow is used when there is a route beneath');

      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
      expect(_details, findsNothing);
      expect(r.top, '/');
    });

    testWidgets(
        'the system Back (Android Back / iOS edge-swipe pop) returns to the list',
        (tester) async {
      await _pump(tester);
      await tester.tap(find.byKey(const Key('open-order')));
      await tester.pumpAndSettle();
      final handled = await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(handled, isTrue);
      expect(_home, findsOneWidget);
      expect(_details, findsNothing);
    });
  });

  group('Order Details as the FIRST route (a cold-start deep link)', () {
    testWidgets('a visible Back control is shown and goes Home',
        (tester) async {
      final r = await _pump(tester, initialLocation: '/orders/$orderId');
      expect(_details, findsOneWidget);
      expect(find.byKey(const Key('order-details-back')), findsOneWidget);
      await tester.tap(find.byKey(const Key('order-details-back')));
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
      expect(r.top, '/');
    });

    testWidgets(
        'the system Back goes Home — it does NOT close the app / pop the root',
        (tester) async {
      await _pump(tester, initialLocation: '/orders/$orderId');
      final handled = await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(handled, isTrue,
          reason:
              'handled in-app; an unhandled pop would exit the application');
      expect(_home, findsOneWidget);
      expect(_details, findsNothing);
    });

    testWidgets(
        'the loading and the error states have the same Back behaviour (not only the loaded one)',
        (tester) async {
      await _pump(tester,
          initialLocation: '/orders/$orderId',
          detailsFailure: Exception('boom'));
      expect(find.byKey(const Key('order-details-back')), findsOneWidget);
      expect(find.text('حدث خطأ ما'),
          findsOneWidget); // the existing error behaviour is preserved
      await tester.tap(find.byKey(const Key('order-details-back')));
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
    });

    testWidgets('the back control exists in English too', (tester) async {
      await _pump(tester,
          initialLocation: '/orders/$orderId', locale: const Locale('en'));
      expect(find.byKey(const Key('order-details-back')), findsOneWidget);
    });
  });

  group(
      'router helpers (the one place deep links / checkout enter Order Details)',
      () {
    testWidgets(
        'openOnTopOfHome from Home pushes ONE Order Details; Back returns Home',
        (tester) async {
      final r = await _pump(tester);
      r.router.openOnTopOfHome('/orders/$orderId');
      await tester.pumpAndSettle();
      expect(r.top, '/orders/$orderId');
      expect(find.byType(BackButton), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
    });

    testWidgets(
        'the same link delivered twice does not stack a duplicate Order Details',
        (tester) async {
      final r = await _pump(tester);
      r.router.openOnTopOfHome('/orders/$orderId');
      await tester.pumpAndSettle();
      r.router.openOnTopOfHome('/orders/$orderId');
      await tester.pumpAndSettle();
      expect(_details, findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget,
          reason:
              'ONE pop reaches Home — there was never a second Order Details beneath');
    });

    testWidgets(
        'a deep link to a different order while one is open is pushed on top, and Back returns to the first',
        (tester) async {
      final r = await _pump(tester);
      r.router.openOnTopOfHome('/orders/$orderId');
      await tester.pumpAndSettle();
      r.router.openOnTopOfHome('/orders/$_otherOrderId');
      await tester.pumpAndSettle();
      expect(r.top, '/orders/$_otherOrderId');
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(r.top, '/orders/$orderId');
    });

    testWidgets(
        'when Order Details would be the ONLY route, Home is put underneath first (Back then goes Home, not out of the app)',
        (tester) async {
      final r = await _pump(tester, initialLocation: '/orders/$orderId');
      r.router.openOnTopOfHome('/orders/$_otherOrderId');
      await tester.pumpAndSettle();
      expect(r.top, '/orders/$_otherOrderId');
      expect(find.byType(BackButton), findsOneWidget,
          reason: 'there is a route beneath now');
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
    });

    testWidgets(
        'replaceFlowWith (end of the transfer flow) leaves Home as the base: the finished flow is gone',
        (tester) async {
      final r = await _pump(tester);
      r.router.push('/checkout/transfer/$orderId');
      await tester.pumpAndSettle();
      expect(find.text('TRANSFER-SCREEN'), findsOneWidget);
      r.router.replaceFlowWith('/orders/$orderId');
      await tester.pumpAndSettle();
      expect(_details, findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
      expect(find.text('TRANSFER-SCREEN'), findsNothing,
          reason: 'Back never returns to the flow that already finished');
    });
  });

  group(
      'from a notification (the real coordinator wired exactly like main.dart)',
      () {
    NotificationNavigationCoordinator coordinatorFor(GoRouter router) =>
        NotificationNavigationCoordinator(isAuthenticated: () => true)
          ..navigate = router.openOnTopOfHome;

    testWidgets(
        'a notification tap opens Order Details above Home with a working Back',
        (tester) async {
      final r = await _pump(tester);
      coordinatorFor(r.router).handleTappedPayload(
          {'type': approvedOrderNotificationTypes.first, 'orderId': orderId});
      await tester.pumpAndSettle();
      expect(_details, findsOneWidget);
      expect(find.byType(BackButton), findsOneWidget);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
    });

    testWidgets(
        'a cold-start tap (Order Details was the only route) still has a Back to Home',
        (tester) async {
      final r = await _pump(tester, initialLocation: '/orders/$_otherOrderId');
      coordinatorFor(r.router).handleTappedPayload(
          {'type': approvedOrderNotificationTypes.first, 'orderId': orderId});
      await tester.pumpAndSettle();
      expect(r.top, '/orders/$orderId');
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
    });

    testWidgets('a malformed notification does nothing (no partial navigation)',
        (tester) async {
      final r = await _pump(tester);
      coordinatorFor(r.router).handleTappedPayload(
          {'type': 'ORDER_CONFIRMED', 'orderId': 'not-a-uuid'});
      await tester.pumpAndSettle();
      expect(_home, findsOneWidget);
      expect(r.top, '/');
    });
  });
}
