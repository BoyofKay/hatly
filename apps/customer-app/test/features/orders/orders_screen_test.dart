import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/domain/order_summary.dart';
import 'package:hatly_customer/features/orders/presentation/orders_screen.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

late ProviderContainer _container;

Future<List<String>> _pump(
  WidgetTester tester,
  FakeOrdersReadApi api, {
  bool dark = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
}) async {
  final visited = <String>[];
  tester.view.physicalSize = Size(width * 3, 2000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    dark: dark,
    locale: locale,
    textScale: scale,
    overrides: [ordersApiProvider.overrideWithValue(api)],
    routes: [
      GoRoute(path: '/', builder: (c, s) => const OrdersScreen()),
      probeRoute('/orders/:id', visited: visited),
    ],
  ));
  await tester.pumpAndSettle();
  _container =
      ProviderScope.containerOf(tester.element(find.byType(OrdersScreen)));
  return visited;
}

FakeOrdersReadApi _api() => FakeOrdersReadApi(lists: {
      OrderListTab.active: [
        orderSummaryJson(
            id: 'aaaaaaaa-0000-0000-0000-000000000001',
            orderNumberValue: 'HT-100501',
            status: 'PREPARING'),
        orderSummaryJson(
            id: 'bbbbbbbb-0000-0000-0000-000000000002',
            status: 'PENDING',
            paymentMethod: 'MANUAL_TRANSFER',
            electronicMethod: 'INSTAPAY',
            awaiting: true,
            vendors: ['مطعم النخيل', 'صيدلية الأمل', 'مخبز']),
      ],
      OrderListTab.completed: [
        orderSummaryJson(
            id: 'cccccccc-0000-0000-0000-000000000003',
            status: 'DELIVERED',
            eta: {
              'state': 'COMPLETED',
              'estimatedAt': null,
              'estimatedUntil': null,
              'delayed': false
            }),
      ],
      OrderListTab.cancelled: [],
    });

void main() {
  testWidgets(
      'bug 2026-11-23: an order that was delivered leaves "Active" — the list is re-read when the app returns and every 30 s',
      (tester) async {
    final api = _api();
    await _pump(tester, api);
    expect(find.textContaining('HT-100501'), findsOneWidget);
    // the order is delivered meanwhile: the server's active list no longer has it
    api.lists[OrderListTab.active] = [api.lists[OrderListTab.active]![1]];
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.textContaining('HT-100501'), findsNothing);
    // and without leaving the app: the periodic re-read
    api.lists[OrderListTab.active] = [];
    await tester.pump(const Duration(seconds: 31));
    await tester.pumpAndSettle();
    expect(find.textContaining('HT-100'), findsNothing);
  });

  testWidgets(
      'three tabs — ongoing · completed · cancelled — and ONLY the first is loaded up front',
      (tester) async {
    final api = _api();
    await _pump(tester, api);
    expect(find.text('جارية'), findsOneWidget);
    expect(find.text('مكتملة'), findsOneWidget);
    expect(find.text('ملغاة'), findsOneWidget);
    expect(api.listCalls, [OrderListTab.active]);
  });

  testWidgets(
      'every tab asks the SERVER for its own list (the app never sorts orders into tabs itself)',
      (tester) async {
    final api = _api();
    await _pump(tester, api);
    await tester.tap(find.text('مكتملة'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ملغاة'));
    await tester.pumpAndSettle();
    expect(api.listCalls,
        [OrderListTab.active, OrderListTab.completed, OrderListTab.cancelled]);
  });

  testWidgets(
      'an ongoing order card: reference, vendors, status, ETA window, payment, total',
      (tester) async {
    await _pump(tester, _api());
    final card = find
        .byKey(const Key('order-card-aaaaaaaa-0000-0000-0000-000000000001'));
    expect(card, findsOneWidget);
    expect(
        find.descendant(
            of: card,
            matching: find.text('\u2066#HT-100501\u2069 · ١ سبتمبر ٢٠٢٦')),
        findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('مطعم النخيل')),
        findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('جارٍ التحضير')),
        findsOneWidget);
    expect(
        find.descendant(
            of: card, matching: find.text('الدفع نقدًا عند الاستلام')),
        findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('115 ج.م')),
        findsOneWidget);
    expect(find.descendant(of: card, matching: find.byIcon(Icons.schedule)),
        findsOneWidget);
  });

  testWidgets(
      'a multi-vendor order summarises its vendors; an unapproved transfer is flagged, not shown as paid',
      (tester) async {
    await _pump(tester, _api());
    final card = find
        .byKey(const Key('order-card-bbbbbbbb-0000-0000-0000-000000000002'));
    expect(
        find.descendant(of: card, matching: find.text('مطعم النخيل + 2 آخرين')),
        findsOneWidget);
    expect(find.descendant(of: card, matching: find.text('الدفع قيد المراجعة')),
        findsOneWidget);
    expect(
        find.descendant(
            of: card, matching: find.text('تحويل مسبق عبر إنستاباي')),
        findsOneWidget);
  });

  testWidgets('a completed order shows no ETA', (tester) async {
    await _pump(tester, _api());
    await tester.tap(find.text('مكتملة'));
    await tester.pumpAndSettle();
    final card = find
        .byKey(const Key('order-card-cccccccc-0000-0000-0000-000000000003'));
    expect(card, findsOneWidget);
    expect(find.descendant(of: card, matching: find.byIcon(Icons.schedule)),
        findsNothing);
  });

  testWidgets('each tab has its own empty state', (tester) async {
    final api = FakeOrdersReadApi();
    await _pump(tester, api);
    expect(find.text('لا توجد طلبات جارية'), findsOneWidget);
    await tester.tap(find.text('مكتملة'));
    await tester.pumpAndSettle();
    expect(find.text('لا توجد طلبات مكتملة بعد'), findsOneWidget);
    await tester.tap(find.text('ملغاة'));
    await tester.pumpAndSettle();
    expect(find.text('لا توجد طلبات ملغاة'), findsOneWidget);
  });

  testWidgets('tapping a card opens that order', (tester) async {
    final visited = await _pump(tester, _api());
    await tester.tap(find
        .byKey(const Key('order-card-aaaaaaaa-0000-0000-0000-000000000001')));
    await tester.pumpAndSettle();
    expect(visited.last, '/orders/aaaaaaaa-0000-0000-0000-000000000001');
  });

  testWidgets(
      'cache invalidation (after an order is placed or cancelled) re-reads the lists',
      (tester) async {
    final api = _api();
    await _pump(tester, api);
    await tester.tap(find.text('مكتملة'));
    await tester.pumpAndSettle();
    final before = api.listCalls.length;
    invalidateOrderCaches(_container.invalidate);
    await tester.pumpAndSettle();
    expect(api.listCalls.length, greaterThan(before),
        reason: 'the visible tab reloads');
    // a new order now appears without any manual refresh
    api.lists[OrderListTab.completed] = [
      orderSummaryJson(
          id: 'dddddddd-0000-0000-0000-000000000004', status: 'DELIVERED')
    ];
    invalidateOrderCaches(_container.invalidate);
    await tester.pumpAndSettle();
    expect(
        find.byKey(
            const Key('order-card-dddddddd-0000-0000-0000-000000000004')),
        findsOneWidget);
  });

  testWidgets(
      'a cancelled order leaves "ongoing" and appears under "cancelled" as soon as the caches are refreshed (what the cancel action does)',
      (tester) async {
    final api = _api();
    await _pump(tester, api);
    const id = 'aaaaaaaa-0000-0000-0000-000000000001';
    expect(find.byKey(const Key('order-card-$id')), findsOneWidget);

    // The server cancels the order: it now belongs to the cancelled tab only.
    final moved = api.lists[OrderListTab.active]!.removeAt(0);
    api.lists[OrderListTab.cancelled] = [
      {...moved, 'status': 'CANCELLED'}
    ];
    invalidateOrderCaches(_container.invalidate, orderId: id);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-card-$id')), findsNothing,
        reason: 'no longer listed as ongoing');

    await tester.tap(find.text('ملغاة'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-card-$id')), findsOneWidget);
    await tester.tap(find.text('جارية'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('order-card-$id')), findsNothing);
  });

  group('themes, RTL and small screens', () {
    for (final dark in [false, true]) {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final scale in [1.0, 2.0]) {
          testWidgets(
              'no overflow: ${locale.languageCode} ${dark ? 'dark' : 'light'} 320 ${scale}x',
              (tester) async {
            await _pump(tester, _api(),
                dark: dark, locale: locale, scale: scale, width: 320);
            expect(tester.takeException(), isNull);
          });
        }
      }
    }
  });
}
