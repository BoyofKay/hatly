import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/features/notifications/domain/customer_notification.dart';
import 'package:hatly_customer/features/notifications/presentation/notification_text.dart';
import 'package:hatly_customer/features/orders/data/orders_api.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/domain/item_unavailability.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/presentation/item_unavailability_card.dart';

import '../../support/order_fixtures.dart';
import '../../support/router_test_app.dart';

/// PD-016 on the customer side: exactly two answers (continue without the items / cancel the whole order), no replacement, nothing happens
/// until the customer answers, and a cancel is only a request. The server side is proven by backend e2e `125-order-exceptions`.

class _Api implements OrdersApi {
  final answers = <({String orderId, String exceptionId, String decision})>[];
  Object? failure;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<void> respondToItemUnavailability(String orderId, String exceptionId, String decision) async {
    if (failure != null) throw failure!;
    answers.add((orderId: orderId, exceptionId: exceptionId, decision: decision));
  }
}

ItemUnavailability _q({String status = 'AWAITING_CUSTOMER', String? decision}) => ItemUnavailability.fromJson({
      'id': 'ex1',
      'status': status,
      'customerDecision': decision,
      'items': [
        {'productName': 'Sugar 1kg', 'quantity': 2, 'amountMinor': 5000},
      ],
    });

Future<_Api> _pump(WidgetTester tester, ItemUnavailability? question, {Locale locale = const Locale('ar'), _Api? api}) async {
  final fake = api ?? _Api();
  tester.view.physicalSize = const Size(390 * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    overrides: [
      ordersApiProvider.overrideWithValue(fake),
      itemUnavailabilityProvider.overrideWith((ref, id) async => question),
    ],
    routes: [GoRoute(path: '/', builder: (c, s) => const Scaffold(body: SingleChildScrollView(child: ItemUnavailabilityCard(orderId: 'o1'))))],
  ));
  await tester.pumpAndSettle();
  return fake;
}

void main() {
  group('model', () {
    test('the open question, who has to act, and an older server that sends nothing', () {
      expect(_q().needsAnswer, isTrue);
      expect(_q(decision: 'CANCEL_ORDER', status: 'AWAITING_OPERATIONS').cancellationRequested, isTrue);
      expect(_q(decision: 'CANCEL_ORDER', status: 'AWAITING_OPERATIONS').needsAnswer, isFalse);
      expect(_q(status: 'AWAITING_OPERATIONS').operationsHandling, isTrue); // the unexecutable answer was cleared: staff will call
      expect(_q(status: 'RESOLVED', decision: 'CONTINUE_WITHOUT').isClosed, isTrue);
    });

    test('removed items come from removedItems; a server without the field gives an empty list, and `items` never contains them', () {
      final base = orderDetailsJson(canCancel: false);
      expect(OrderDetails.fromJson(base).segments.first.removedItems, isEmpty);
      final seg = ((base['segments'] as List).first as Map<String, dynamic>);
      seg['removedItems'] = [
        {'id': 'r1', 'productNameSnapshot': 'Sugar', 'productNameArSnapshot': 'سكر', 'quantity': 2, 'removedAmountMinor': 5000, 'removedAt': '2026-10-31T10:00:00Z'},
      ];
      final removed = OrderDetails.fromJson(base).segments.first.removedItems;
      expect(removed.single.productName, 'سكر');
      expect(removed.single.removedAmountMinor, 5000);
    });
  });

  group('notification', () {
    testWidgets('ORDER_ITEM_UNAVAILABLE is localized in both languages and carries the order number', (tester) async {
      late AppLocalizations ar;
      late AppLocalizations en;
      await tester.pumpWidget(Builder(builder: (context) {
        ar = lookupAppLocalizations(const Locale('ar'));
        en = lookupAppLocalizations(const Locale('en'));
        return const SizedBox();
      }));
      final n = CustomerNotification(id: 'n', type: 'ORDER_ITEM_UNAVAILABLE', orderId: 'o1', orderNumber: 'HT-100234', title: 'server title', body: 'server body', isRead: false, createdAt: DateTime(2026, 10, 31));
      expect(notificationText(ar, n).title, 'منتج في طلبك غير متوفر');
      expect(notificationText(ar, n).body, contains('HT-100234'));
      expect(notificationText(en, n).title, 'An item in your order is unavailable');
      expect(notificationText(en, n).body, isNot('server body'));
    });
  });

  group('the question card', () {
    testWidgets('nothing is shown when there is no question, or it is closed without an answer to report', (tester) async {
      await _pump(tester, null);
      expect(find.byKey(const Key('item-unavailability-card')), findsNothing);
      await _pump(tester, _q(status: 'RESOLVED', decision: null));
      expect(find.byKey(const Key('item-unavailability-card')), findsNothing);
    });

    for (final locale in const [Locale('ar'), Locale('en')]) {
      testWidgets('${locale.languageCode}: lists the items and offers exactly two answers — no replacement, no price to approve', (tester) async {
        await _pump(tester, _q(), locale: locale);
        expect(find.byKey(const Key('item-unavailability-card')), findsOneWidget);
        expect(find.textContaining('Sugar 1kg'), findsOneWidget);
        expect(find.byKey(const Key('item-unavailable-continue')), findsOneWidget);
        expect(find.byKey(const Key('item-unavailable-cancel')), findsOneWidget);
        expect(find.byType(ElevatedButton), findsOneWidget);
        expect(find.byType(OutlinedButton), findsOneWidget);
      });
    }

    testWidgets('"continue without them" sends exactly that one answer', (tester) async {
      final api = await _pump(tester, _q());
      await tester.tap(find.byKey(const Key('item-unavailable-continue')));
      await tester.pumpAndSettle();
      expect(api.answers, [(orderId: 'o1', exceptionId: 'ex1', decision: 'CONTINUE_WITHOUT')]);
    });

    testWidgets('"cancel the whole order" asks first; keeping the order sends nothing; confirming sends the cancel request', (tester) async {
      final api = await _pump(tester, _q());
      await tester.tap(find.byKey(const Key('item-unavailable-cancel')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('item-unavailable-keep')));
      await tester.pumpAndSettle();
      expect(api.answers, isEmpty);

      await tester.tap(find.byKey(const Key('item-unavailable-cancel')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('item-unavailable-confirm-cancel')));
      await tester.pumpAndSettle();
      expect(api.answers, [(orderId: 'o1', exceptionId: 'ex1', decision: 'CANCEL_ORDER')]);
    });

    testWidgets('a failed answer is explained and the choice stays available (nothing is assumed)', (tester) async {
      final api = _Api()..failure = Exception('offline');
      await _pump(tester, _q(), api: api);
      await tester.tap(find.byKey(const Key('item-unavailable-continue')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('item-unavailability-error')), findsOneWidget);
      expect(find.byKey(const Key('item-unavailable-continue')), findsOneWidget);
    });

    testWidgets('after a cancel request the card says it is with the team — and offers no further buttons', (tester) async {
      await _pump(tester, _q(status: 'AWAITING_OPERATIONS', decision: 'CANCEL_ORDER'));
      expect(find.byKey(const Key('item-unavailability-status')), findsOneWidget);
      expect(find.byKey(const Key('item-unavailable-continue')), findsNothing);
      expect(find.byKey(const Key('item-unavailable-cancel')), findsNothing);
    });

    testWidgets('removed items are listed read-only, and the section is absent without any', (tester) async {
      await tester.pumpWidget(hatlyRouterApp(routes: [GoRoute(path: '/', builder: (c, s) => const Scaffold(body: RemovedItemsSection(items: [RemovedOrderItem(id: 'r', productName: 'سكر', quantity: 1)])))]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('removed-items-section')), findsOneWidget);
      await tester.pumpWidget(hatlyRouterApp(routes: [GoRoute(path: '/', builder: (c, s) => const Scaffold(body: RemovedItemsSection(items: [])))]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('removed-items-section')), findsNothing);
    });
  });
}
