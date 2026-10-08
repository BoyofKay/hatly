import 'notification_deep_link.dart';

/// The single centralized place a validated notification tap becomes
/// real navigation. `FcmService.onNotificationTapped` (foreground-
/// adjacent background tap AND terminated-cold-start tap — both
/// deliver through the exact same callback, see that class's own
/// comment) is wired to [handleTappedPayload] only; nothing else in
/// the app calls `router.go` for a notification.
///
/// Race conditions this exists to close (the actual gap this
/// milestone adds — token registration/backend payloads/basic tap
/// wiring already existed):
///  - Terminated cold start: `FcmService.initialize()` (and therefore
///    `getInitialMessage()`) is invoked from `SessionController`
///    during session restore, which can resolve BEFORE the app root
///    has even shown the shell, and — critically — while
///    `SessionStatus` is still `checking` or briefly
///    `unauthenticated`. `app_router.dart`'s `redirect` callback runs
///    on every navigation and would immediately bounce a same-tick
///    `router.go('/orders/:id')` back to `/splash` or `/phone`,
///    silently losing the tapped notification. Navigating instead
///    depends on [isAuthenticated] and defers via [_pendingIntent]
///    when it is not yet true.
///  - Logged-out tap: the intent is held, never navigated — the
///    Order Details screen is never reached without a real session.
///  - Login-after-tap: the same held intent is applied the moment
///    [onAuthenticated] fires (wired to a genuine
///    unauthenticated/checking → authenticated transition only).
///  - Repeated taps / re-delivery of the same notification: [_navigate]
///    no-ops when the resolved link is identical to the last one this
///    coordinator actually navigated to, so no duplicate push onto the
///    navigation stack.
///
/// [isAuthenticated] and [navigate] are injected rather than reading
/// `sessionControllerProvider`/`GoRouter` directly, so this class is
/// unit-testable with plain fakes — no Riverpod container, no router,
/// no Firebase.
class NotificationNavigationCoordinator {
  NotificationNavigationCoordinator({required this.isAuthenticated});

  final bool Function() isAuthenticated;

  /// Set once by the app root (main.dart) once the router exists —
  /// mirrors `FcmService.onNotificationTapped`'s own "assigned late,
  /// defaults to doing nothing" shape, for the same reason (this
  /// coordinator itself is constructed, and may already receive a
  /// terminated-cold-start tap, before the router is built).
  void Function(String path)? navigate;

  NotificationDeepLink? _pendingIntent;
  NotificationDeepLink? _lastNavigatedLink;

  /// Called with the raw FCM payload from every tap source
  /// (`onMessageOpenedApp` and `getInitialMessage`, both funnelled
  /// through the same `FcmService.onNotificationTapped` callback).
  void handleTappedPayload(Map<String, dynamic> data) {
    final link = parseNotificationDeepLink(data);
    if (link == null) return; // malformed / unknown type / missing id — do nothing, never a partial navigation.

    if (isAuthenticated()) {
      _navigate(link);
    } else {
      // Held, not discarded — see [onAuthenticated]. Overwrites any
      // earlier pending intent: only the most recent tap should win.
      _pendingIntent = link;
    }
  }

  /// Called only on a genuine transition INTO `authenticated` (see the
  /// `ref.listen` in `providers.dart` — never called for an
  /// already-authenticated session, so this can't accidentally replay
  /// an old intent on an unrelated rebuild).
  void onAuthenticated() {
    final pending = _pendingIntent;
    if (pending == null) return;
    _pendingIntent = null;
    _navigate(pending);
  }

  void _navigate(NotificationDeepLink link) {
    if (link == _lastNavigatedLink) return;
    _lastNavigatedLink = link;
    navigate?.call(notificationDeepLinkRoute(link));
  }
}
