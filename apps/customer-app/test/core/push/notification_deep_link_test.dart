import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/push/notification_deep_link.dart';

/// Push Notifications / Deep Links. Pure parsing/validation tests —
/// a push payload is untrusted input (see notification_deep_link.dart's
/// own top comment), so every rejection path here is a real security
/// requirement, not just a nice-to-have: an unknown type, a
/// non-UUID-shaped orderId, or a wrong field type must never produce a
/// navigable link.
void main() {
  group('parseNotificationDeepLink — valid payloads', () {
    for (final type in approvedOrderNotificationTypes) {
      test('accepts the approved type $type with a real UUID orderId', () {
        final link = parseNotificationDeepLink({
          'type': type,
          'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab',
        });
        expect(link, isNotNull);
        expect(link!.type, type);
        expect(link.orderId, '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
        expect(notificationDeepLinkRoute(link),
            '/orders/3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
      });
    }

    test('extra, unrelated fields in the payload are simply ignored', () {
      final link = parseNotificationDeepLink({
        'type': 'ORDER_CONFIRMED',
        'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab',
        'totalMinor': '99999', // never part of the approved payload contract
        'customerPhone': '+201000000000',
      });
      expect(link, isNotNull);
    });
  });

  group('parseNotificationDeepLink — rejected payloads', () {
    test('null payload', () {
      expect(parseNotificationDeepLink(null), isNull);
    });

    test('empty payload', () {
      expect(parseNotificationDeepLink({}), isNull);
    });

    test('unknown notification type', () {
      expect(
          parseNotificationDeepLink({
            'type': 'PROMO_BLAST',
            'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab',
          }),
          isNull);
    });

    test('missing type', () {
      expect(
          parseNotificationDeepLink(
              {'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab'}),
          isNull);
    });

    test('missing orderId', () {
      expect(parseNotificationDeepLink({'type': 'ORDER_CONFIRMED'}), isNull);
    });

    test('blank orderId', () {
      expect(
          parseNotificationDeepLink(
              {'type': 'ORDER_CONFIRMED', 'orderId': ''}),
          isNull);
    });

    test(
        'orderId is not a UUID — including an attempted path-injection value',
        () {
      for (final malformed in [
        '123',
        'not-a-uuid',
        '../../checkout',
        '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab/../other',
        '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab?x=1',
      ]) {
        expect(
            parseNotificationDeepLink(
                {'type': 'ORDER_CONFIRMED', 'orderId': malformed}),
            isNull,
            reason: '"$malformed" must never be treated as a valid order id');
      }
    });

    test('type is not a String (e.g. a number or a nested map)', () {
      expect(
          parseNotificationDeepLink({
            'type': 42,
            'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab',
          }),
          isNull);
      expect(
          parseNotificationDeepLink({
            'type': {'nested': 'ORDER_CONFIRMED'},
            'orderId': '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab',
          }),
          isNull);
    });

    test('orderId is not a String (e.g. a number)', () {
      expect(
          parseNotificationDeepLink(
              {'type': 'ORDER_CONFIRMED', 'orderId': 12345}),
          isNull);
    });
  });

  group('NotificationDeepLink equality', () {
    test('two links with the same type and orderId are equal (dedup depends on this)', () {
      const a = NotificationDeepLink(
          type: 'ORDER_CONFIRMED', orderId: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
      const b = NotificationDeepLink(
          type: 'ORDER_CONFIRMED', orderId: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a different orderId or type is not equal', () {
      const a = NotificationDeepLink(
          type: 'ORDER_CONFIRMED', orderId: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
      const b = NotificationDeepLink(
          type: 'ORDER_CANCELLED', orderId: '3f2b8c1e-aaaa-bbbb-cccc-1234567890ab');
      const c = NotificationDeepLink(
          type: 'ORDER_CONFIRMED', orderId: '00000000-0000-0000-0000-000000000000');
      expect(a == b, isFalse);
      expect(a == c, isFalse);
    });
  });
}
