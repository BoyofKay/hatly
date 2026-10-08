import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/push/notification_navigation_coordinator.dart';

const _orderId = '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab';
const _validPayload = {'type': 'ORDER_CONFIRMED', 'orderId': _orderId};

void main() {
  group('NotificationNavigationCoordinator — authenticated tap', () {
    test('navigates immediately when already authenticated', () {
      final navigated = <String>[];
      final coordinator =
          NotificationNavigationCoordinator(isAuthenticated: () => true)
            ..navigate = navigated.add;

      coordinator.handleTappedPayload(_validPayload);

      expect(navigated, ['/orders/$_orderId']);
    });

    test('a malformed payload never navigates, authenticated or not', () {
      final navigated = <String>[];
      final coordinator =
          NotificationNavigationCoordinator(isAuthenticated: () => true)
            ..navigate = navigated.add;

      coordinator.handleTappedPayload({'type': 'UNKNOWN'});
      coordinator.handleTappedPayload({'orderId': _orderId});
      coordinator.handleTappedPayload({});

      expect(navigated, isEmpty);
    });
  });

  group('NotificationNavigationCoordinator — terminated cold start / auth race', () {
    test(
        'a tap that arrives before the session is authenticated is held, not navigated, and applied once auth is ready (Phase 5-B/D)',
        () {
      var authenticated = false;
      final navigated = <String>[];
      final coordinator = NotificationNavigationCoordinator(
        isAuthenticated: () => authenticated,
      )..navigate = navigated.add;

      // `getInitialMessage()` / `onMessageOpenedApp` can fire while
      // SessionStatus is still `checking` (terminated cold start) or
      // `unauthenticated` — the router would otherwise bounce this
      // straight back to /splash or /phone (app_router.dart's own
      // redirect), silently losing the tapped notification.
      coordinator.handleTappedPayload(_validPayload);
      expect(navigated, isEmpty, reason: 'must not navigate before auth is ready');

      // The session becomes ready — e.g. session restore finishes, or
      // the user logs in after tapping a protected notification.
      authenticated = true;
      coordinator.onAuthenticated();

      expect(navigated, ['/orders/$_orderId']);
    });

    test(
        'logged-out tap (Phase 5-C): no pending intent is created for a malformed payload, and nothing navigates without a later onAuthenticated()',
        () {
      final navigated = <String>[];
      final coordinator =
          NotificationNavigationCoordinator(isAuthenticated: () => false)
            ..navigate = navigated.add;

      coordinator.handleTappedPayload(_validPayload);
      expect(navigated, isEmpty);
      // No call to onAuthenticated() at all in this test — simulates
      // "the user never logs back in" — the intent must never leak
      // into navigation on its own.
    });

    test('onAuthenticated() with no pending intent is a safe no-op', () {
      final navigated = <String>[];
      final coordinator =
          NotificationNavigationCoordinator(isAuthenticated: () => true)
            ..navigate = navigated.add;

      coordinator.onAuthenticated();

      expect(navigated, isEmpty);
    });

    test('only the most recent pending tap is kept if two arrive before auth is ready', () {
      var authenticated = false;
      final navigated = <String>[];
      final coordinator = NotificationNavigationCoordinator(
        isAuthenticated: () => authenticated,
      )..navigate = navigated.add;

      coordinator.handleTappedPayload(_validPayload);
      coordinator.handleTappedPayload({
        'type': 'ORDER_DELIVERED',
        'orderId': '00000000-0000-0000-0000-000000000000',
      });

      authenticated = true;
      coordinator.onAuthenticated();

      expect(navigated, ['/orders/00000000-0000-0000-0000-000000000000']);
    });
  });

  group('NotificationNavigationCoordinator — duplicate tap protection (Phase 5-F)', () {
    test('tapping the same notification twice in a row navigates only once', () {
      final navigated = <String>[];
      final coordinator =
          NotificationNavigationCoordinator(isAuthenticated: () => true)
            ..navigate = navigated.add;

      coordinator.handleTappedPayload(_validPayload);
      coordinator.handleTappedPayload(_validPayload);

      expect(navigated, ['/orders/$_orderId']);
    });

    test('a different order notification after that still navigates', () {
      final navigated = <String>[];
      final coordinator =
          NotificationNavigationCoordinator(isAuthenticated: () => true)
            ..navigate = navigated.add;

      coordinator.handleTappedPayload(_validPayload);
      coordinator.handleTappedPayload({
        'type': 'ORDER_DELIVERED',
        'orderId': '00000000-0000-0000-0000-000000000000',
      });

      expect(navigated,
          ['/orders/$_orderId', '/orders/00000000-0000-0000-0000-000000000000']);
    });
  });

  test('navigate being unset yet (router not built yet) never throws', () {
    final coordinator = NotificationNavigationCoordinator(isAuthenticated: () => true);
    expect(() => coordinator.handleTappedPayload(_validPayload), returnsNormally);
  });
}
