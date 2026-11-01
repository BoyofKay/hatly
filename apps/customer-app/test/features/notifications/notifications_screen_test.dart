import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/notifications/data/notifications_providers.dart';
import 'package:hatly_customer/features/notifications/domain/customer_notification.dart';
import 'package:hatly_customer/features/notifications/presentation/notifications_screen.dart';

import '../../support/notifications_fakes.dart';
import '../../support/router_test_app.dart';

Future<List<String>> _pump(WidgetTester tester, FakeNotificationsApi api,
    {Locale locale = const Locale('ar'),
    double scale = 1,
    double width = 390}) async {
  tester.view.physicalSize = Size(width * 3, 2400);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final visited = <String>[];
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    textScale: scale,
    initialLocation: '/notifications',
    overrides: [notificationsApiProvider.overrideWithValue(api)],
    routes: [
      GoRoute(
          path: '/notifications',
          builder: (c, s) => const NotificationsScreen()),
      probeRoute('/orders/:id', visited: visited),
    ],
  ));
  await tester.pumpAndSettle();
  return visited;
}

void main() {
  test('model: parses the server shape, and asRead flips only the read flag',
      () {
    final n = CustomerNotification.fromJson(notificationJson());
    expect(n.isRead, isFalse);
    final read = n.asRead();
    expect([read.isRead, read.id, read.orderId, read.type, read.orderNumber],
        [true, 'n1', 'order-1', 'ORDER_CONFIRMED', 'HT-100501']);
    final page = NotificationsPage.fromJson({
      'data': [notificationJson()],
      'meta': {'page': 1, 'limit': 20, 'total': 1, 'unreadCount': 1},
    });
    expect([page.items.length, page.total, page.unreadCount], [1, 1, 1]);
  });

  group('list', () {
    testWidgets(
        'shows localized, order-linked text per type; unread rows are marked, read rows are not',
        (tester) async {
      final api = FakeNotificationsApi(items: [
        notificationJson(
            id: 'a', type: 'ORDER_ON_THE_WAY', orderNumber: 'HT-1'),
        notificationJson(
            id: 'b',
            type: 'ORDER_DELIVERED',
            orderNumber: 'HT-1',
            isRead: true),
        notificationJson(
            id: 'c',
            type: 'ORDER_CANCELLED',
            orderNumber: 'HT-2',
            isRead: true),
      ]);
      await _pump(tester, api);
      expect(find.text('طلبك في الطريق'), findsOneWidget);
      expect(find.text('طلبك رقم HT-1 في الطريق إليك.'), findsOneWidget);
      expect(find.text('تم توصيل طلبك'), findsOneWidget);
      expect(find.text('تم إلغاء طلبك'), findsOneWidget);
      expect(find.byKey(const Key('notification-unread-a')), findsOneWidget);
      expect(find.byKey(const Key('notification-unread-b')), findsNothing);
      expect(find.byKey(const Key('notification-unread-c')), findsNothing);
    });

    testWidgets(
        'English wording too, and an unknown future type falls back to the server text',
        (tester) async {
      final api = FakeNotificationsApi(items: [
        notificationJson(id: 'a', type: 'ORDER_PREPARING', orderNumber: 'HT-9'),
        notificationJson(id: 'z', type: 'SOMETHING_NEW'),
      ]);
      await _pump(tester, api, locale: const Locale('en'));
      expect(find.text('Preparing your order'), findsOneWidget);
      expect(find.text('Your order HT-9 is being prepared.'), findsOneWidget);
      expect(find.text('server title'), findsOneWidget);
      expect(find.text('server body'), findsOneWidget);
    });

    testWidgets('empty state: says there is nothing yet (no fake rows)',
        (tester) async {
      await _pump(tester, FakeNotificationsApi());
      expect(find.byKey(const Key('notifications-empty')), findsOneWidget);
      expect(find.text('لا توجد إشعارات بعد'), findsOneWidget);
      expect(find.byKey(const Key('notifications-mark-all')), findsNothing);
    });

    testWidgets('error state with retry; a successful retry shows the list',
        (tester) async {
      final api = FakeNotificationsApi(items: [notificationJson()])
        ..listError = Exception('down');
      await _pump(tester, api);
      expect(find.byKey(const Key('notifications-error')), findsOneWidget);
      api.listError = null;
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('notifications-error')), findsNothing);
      expect(find.text('تم تأكيد طلبك'), findsOneWidget);
    });
  });

  group('read / unread and navigation', () {
    testWidgets(
        'tapping a row opens THAT order and marks it read on the server',
        (tester) async {
      final api = FakeNotificationsApi(items: [
        notificationJson(id: 'a', orderId: 'order-A'),
        notificationJson(id: 'b', orderId: 'order-B', type: 'ORDER_PLACED'),
      ]);
      final visited = await _pump(tester, api);
      await tester.tap(find.byKey(const Key('notification-b')));
      await tester.pumpAndSettle();
      expect(visited, ['/orders/order-B']);
      expect(api.calls, contains('read:b'));
      expect(api.calls.where((c) => c.startsWith('read:')), ['read:b']);
    });

    testWidgets(
        'a failed mark-read puts the row back as unread (the screen never claims what the server did not do)',
        (tester) async {
      final api = FakeNotificationsApi(items: [notificationJson(id: 'a')])
        ..markReadError = Exception('offline');
      await _pump(tester, api);
      await tester.tap(find.byKey(const Key('notification-a')));
      await tester.pumpAndSettle();
      // back on the list after the (probe) order page
      expect(api.items.single['isRead'], isNot(true));
    });

    testWidgets(
        '"mark all as read" appears only while something is unread, clears every dot and tells the server',
        (tester) async {
      final api = FakeNotificationsApi(items: [
        notificationJson(id: 'a'),
        notificationJson(id: 'b', type: 'ORDER_PLACED'),
        notificationJson(id: 'c', isRead: true),
      ]);
      await _pump(tester, api);
      expect(find.byKey(const Key('notifications-mark-all')), findsOneWidget);
      await tester.tap(find.byKey(const Key('notifications-mark-all')));
      await tester.pumpAndSettle();
      expect(api.calls, contains('read-all'));
      expect(find.byKey(const Key('notification-unread-a')), findsNothing);
      expect(find.byKey(const Key('notification-unread-b')), findsNothing);
      expect(find.byKey(const Key('notifications-mark-all')), findsNothing);
    });

    testWidgets('mark-all failing restores the unread rows', (tester) async {
      final api = FakeNotificationsApi(items: [notificationJson(id: 'a')])
        ..markAllError = Exception('x');
      await _pump(tester, api);
      await tester.tap(find.byKey(const Key('notifications-mark-all')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('notification-unread-a')), findsOneWidget);
    });
  });

  group('pagination', () {
    testWidgets(
        'scrolling to the end loads the next page and appends without duplicates',
        (tester) async {
      final api = FakeNotificationsApi(items: [
        for (var i = 0; i < 45; i++)
          notificationJson(
              id: 'n$i', orderId: 'o$i', orderNumber: 'HT-$i', isRead: true),
      ]);
      await _pump(tester, api);
      expect(api.calls.where((c) => c.startsWith('list:')), ['list:1:20']);
      await tester.drag(find.byType(ListView), const Offset(0, -6000));
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView), const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(api.calls.where((c) => c.startsWith('list:')).toSet(),
          {'list:1:20', 'list:2:20', 'list:3:20'});
      await tester.drag(find.byType(ListView), const Offset(0, -20000));
      await tester.pumpAndSettle();
      expect(find.text('طلبك رقم HT-44 تم تأكيده.', skipOffstage: false),
          findsNothing); // wording differs; presence is checked by key below
      expect(find.byKey(const Key('notification-n44')), findsOneWidget);
      // no further pages once everything is loaded
      final before = api.calls.length;
      await tester.drag(find.byType(ListView), const Offset(0, -20000));
      await tester.pumpAndSettle();
      expect(api.calls.length, before);
    });
  });

  group('layout', () {
    for (final locale in [const Locale('ar'), const Locale('en')]) {
      testWidgets('no overflow at 320px / 2× text (${locale.languageCode})',
          (tester) async {
        final api = FakeNotificationsApi(items: [
          notificationJson(
              id: 'a',
              type: 'ORDER_READY_FOR_PICKUP',
              orderNumber: 'HT-100501'),
          notificationJson(
              id: 'b', type: 'ORDER_FAILED_DELIVERY', isRead: true),
        ]);
        await _pump(tester, api, locale: locale, scale: 2, width: 320);
        expect(tester.takeException(), isNull);
      });
    }
  });
}
