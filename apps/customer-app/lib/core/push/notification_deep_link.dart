/// Push Notification Deep Links — the SINGLE place a raw FCM data
/// payload is parsed and validated into a safe, typed destination.
/// Every notification-tap entry point (foreground-adjacent tap,
/// background tap, terminated cold-start) MUST go through
/// [parseNotificationDeepLink] rather than reading `data['...']`
/// directly — see `main.dart` and `NotificationNavigationCoordinator`.
///
/// SECURITY (explicit requirement): a push payload is untrusted input
/// — it is attacker-reachable by anyone who can call the (server-side,
/// authenticated) send path, and on some platforms a data payload can
/// be inspected/modified by the device owner before the app reads it.
/// This file therefore:
///  - only accepts a closed, stable set of notification `type`s (never
///    an arbitrary string used as e.g. a route name);
///  - validates `orderId` looks like a real backend id (a UUID — see
///    `BaseEntity`'s `@PrimaryGeneratedColumn('uuid')` on the backend)
///    before it is ever interpolated into a route path, specifically
///    to rule out path-injection via characters like `/` or `..`;
///  - never carries or exposes any other order/customer field — the
///    payload contract (backend: `PushNotificationService`) is
///    intentionally limited to `{ type, orderId }` and this parser
///    only ever reads those two keys.
/// The destination screen (`OrderDetailsScreen` via the existing
/// `/orders/:id` route) still re-fetches the order through the
/// existing authenticated customer API — this file's validation is a
/// routing-safety gate, never a substitute for that server-side
/// authorization.
library;

/// The exact, closed set this app knows how to route — mirrors the
/// backend's own `PushNotificationService` methods
/// (`sendOrderConfirmedNotification`, etc.) one-for-one. Adding a new
/// backend notification type without adding it here is a deliberate,
/// safe default: an unrecognized type is simply never navigated to.
const approvedOrderNotificationTypes = {
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ORDER_ON_THE_WAY',
  'ORDER_DELIVERED',
  'ORDER_FAILED_DELIVERY',
  'ORDER_COLLECTED',
};

/// Backend order ids are Postgres `uuid` primary keys (see
/// `BaseEntity`) — this is the real id shape, not an invented limit.
final _uuidPattern = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

/// A validated, safe-to-route-to notification destination. Constructing
/// one outside [parseNotificationDeepLink] is possible but pointless —
/// treat the parser as the only real constructor.
class NotificationDeepLink {
  const NotificationDeepLink({required this.type, required this.orderId});

  final String type;
  final String orderId;

  @override
  bool operator ==(Object other) =>
      other is NotificationDeepLink &&
      other.type == type &&
      other.orderId == orderId;

  @override
  int get hashCode => Object.hash(type, orderId);

  @override
  String toString() => 'NotificationDeepLink(type: $type, orderId: $orderId)';
}

/// Parses and validates a raw FCM `RemoteMessage.data` map (or any
/// map-shaped payload — tests pass plain `Map<String, dynamic>`
/// literals, never a real `RemoteMessage`, since constructing one
/// needs the Firebase plugin's platform channel).
///
/// Returns `null` — never throws — for: a null/empty map, a missing or
/// unrecognized `type`, a missing/blank/non-UUID-shaped `orderId`, or
/// either field being a non-String value. The caller's job is simply
/// "if this is null, do nothing" — there is no partial/best-effort
/// navigation.
NotificationDeepLink? parseNotificationDeepLink(Map<String, dynamic>? data) {
  if (data == null) return null;

  final type = data['type'];
  if (type is! String || !approvedOrderNotificationTypes.contains(type)) {
    return null;
  }

  final orderId = data['orderId'];
  if (orderId is! String || !_uuidPattern.hasMatch(orderId)) {
    return null;
  }

  return NotificationDeepLink(type: type, orderId: orderId);
}

/// The existing Order Details route (`app_router.dart`) — never a new
/// screen. Built from an already-validated [NotificationDeepLink]
/// only, so the interpolated segment is always a well-formed UUID.
String notificationDeepLinkRoute(NotificationDeepLink link) =>
    '/orders/${link.orderId}';
