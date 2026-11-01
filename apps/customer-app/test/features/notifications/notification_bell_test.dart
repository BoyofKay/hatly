import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';
import 'package:hatly_customer/features/notifications/data/notifications_providers.dart';
import 'package:hatly_customer/features/notifications/presentation/widgets/notification_bell.dart';

import '../../support/notifications_fakes.dart';
import '../../support/router_test_app.dart';

Future<List<String>> _pump(WidgetTester tester, FakeNotificationsApi api,
    {bool signedIn = true, Locale locale = const Locale('ar')}) async {
  final visited = <String>[];
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    overrides: [
      notificationsApiProvider.overrideWithValue(api),
      isSignedInProvider.overrideWithValue(signedIn),
    ],
    routes: [
      GoRoute(
          path: '/',
          builder: (c, s) =>
              Scaffold(appBar: AppBar(actions: const [NotificationBell()]))),
      probeRoute('/notifications', visited: visited),
    ],
  ));
  await tester.pumpAndSettle();
  return visited;
}

void main() {
  testWidgets('no unread → a bell with NO badge (never a placeholder number)',
      (tester) async {
    await _pump(
        tester, FakeNotificationsApi(items: [notificationJson(isRead: true)]));
    expect(find.byKey(const Key('notification-bell')), findsOneWidget);
    expect(find.byKey(const Key('notification-badge')), findsNothing);
  });

  testWidgets(
      'unread > 0 → the badge shows the server count, and the accessible label says so',
      (tester) async {
    final api = FakeNotificationsApi(items: [
      notificationJson(id: 'a'),
      notificationJson(id: 'b'),
      notificationJson(id: 'c', isRead: true),
    ]);
    await _pump(tester, api);
    expect(find.byKey(const Key('notification-badge')), findsOneWidget);
    expect(
        find.descendant(
            of: find.byKey(const Key('notification-badge')),
            matching: find.text('2')),
        findsOneWidget);
    expect(tester.getSemantics(find.byType(NotificationBell)).label,
        'الإشعارات، 2 غير مقروء');
  });

  testWidgets('a big count is capped at 99+', (tester) async {
    final api = FakeNotificationsApi()..countOverride = 250;
    await _pump(tester, api);
    expect(find.text('99+'), findsOneWidget);
  });

  testWidgets(
      'a failed count read shows no badge (no stale or invented number)',
      (tester) async {
    final api = FakeNotificationsApi(items: [notificationJson()])
      ..countError = Exception('down');
    await _pump(tester, api);
    expect(find.byKey(const Key('notification-bell')), findsOneWidget);
    expect(find.byKey(const Key('notification-badge')), findsNothing);
  });

  testWidgets('tapping the bell opens the notifications list', (tester) async {
    final visited =
        await _pump(tester, FakeNotificationsApi(items: [notificationJson()]));
    await tester.tap(find.byKey(const Key('notification-bell')));
    await tester.pumpAndSettle();
    expect(visited, ['/notifications']);
  });

  testWidgets('a guest has no bell and triggers no authenticated request',
      (tester) async {
    final api = FakeNotificationsApi(items: [notificationJson()]);
    await _pump(tester, api, signedIn: false);
    expect(find.byKey(const Key('notification-bell')), findsNothing);
    expect(api.calls, isEmpty);
  });

  testWidgets(
      'the badge updates when the count is re-read (new server events show up)',
      (tester) async {
    final api = FakeNotificationsApi(items: [notificationJson(id: 'a')]);
    await _pump(tester, api);
    expect(
        find.descendant(
            of: find.byKey(const Key('notification-badge')),
            matching: find.text('1')),
        findsOneWidget);
    api.items = [
      notificationJson(id: 'b', type: 'ORDER_ON_THE_WAY'),
      notificationJson(id: 'a')
    ];
    final container = ProviderScope.containerOf(
        tester.element(find.byType(NotificationBell)));
    container.invalidate(unreadNotificationsCountProvider);
    await tester.pumpAndSettle();
    expect(
        find.descendant(
            of: find.byKey(const Key('notification-badge')),
            matching: find.text('2')),
        findsOneWidget);
  });
}
