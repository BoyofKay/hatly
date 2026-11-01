import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/notifications/domain/customer_notification.dart';
import 'package:hatly_customer/features/notifications/presentation/notification_text.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';

/// `GET /orders/:id` after one of two vendors rejected their part: the rejected segment carries the reason, `partialRejection` counts the
/// parts and `refundSummary` is assembled by the server from the real ledgers.
Map<String, dynamic> partialRejectionJson({
  int wallet = 0,
  int transferRecorded = 0,
  int transferSent = 0,
  int pending = 0,
  String paymentMethod = 'COD',
}) {
  final json = orderDetailsJson(paymentMethod: paymentMethod, canCancel: false);
  final first = (json['segments'] as List).first as Map<String, dynamic>;
  json['segments'] = [
    first,
    {
      ...first,
      'id': 's2',
      'vendorBranchId': 'b2',
      'vendorBranchName': 'سوبر ماركت الأمل',
      'status': 'CANCELLED',
      'rejectionReason': 'نفدت الكمية',
      'items': [],
    },
  ];
  json['partialRejection'] = {'rejectedSegmentCount': 1, 'activeSegmentCount': 1};
  json['refundSummary'] = {
    'walletRefundedMinor': wallet,
    'transferRefundRecordedMinor': transferRecorded,
    'transferRefundSentMinor': transferSent,
    'pendingRefundMinor': pending,
    'totalRefundMinor': wallet + transferRecorded,
    'status': 'X',
    'transferRefunds': [],
  };
  return json;
}

Future<void> _pump(WidgetTester tester, Map<String, dynamic> json,
    {Locale locale = const Locale('ar')}) async {
  tester.view.physicalSize = const Size(390 * 3, 4000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    overrides: [
      ordersApiProvider.overrideWithValue(FakeOrdersReadApi(details: json)),
      orderRatingStateProvider.overrideWith(
          (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
      supportContactProvider.overrideWith(
          (ref) async => const SupportContact(whatsappNumber: '+201104949903')),
    ],
    routes: [
      GoRoute(
          path: '/',
          builder: (c, s) => const OrderDetailsScreen(orderId: orderId)),
    ],
  ));
  await tester.pumpAndSettle();
}

void main() {
  group('model', () {
    test('partial rejection, refund summary and the rejection reason are read from the server', () {
      final order = OrderDetails.fromJson(partialRejectionJson(wallet: 8500));
      expect(order.partialRejection!.rejectedSegmentCount, 1);
      expect(order.partialRejection!.totalSegmentCount, 2);
      expect(order.refundSummary.walletRefundedMinor, 8500);
      expect(order.refundSummary.isEmpty, isFalse);
      final rejected = order.segments.firstWhere((s) => s.id == 's2');
      expect(rejected.isRejected, isTrue);
      expect(rejected.rejectionReason, 'نفدت الكمية');
    });

    test('an order with no rejection has no partial-rejection block and an empty refund summary (older servers too)', () {
      final order = OrderDetails.fromJson(orderDetailsJson());
      expect(order.partialRejection, isNull);
      expect(order.refundSummary.isEmpty, isTrue);
    });

    test('a transfer refund is "awaiting" until the server reports it sent', () {
      final recorded = OrderDetails.fromJson(partialRejectionJson(transferRecorded: 8500));
      expect(recorded.refundSummary.transferRefundAwaitingMinor, 8500);
      final sent = OrderDetails.fromJson(partialRejectionJson(transferRecorded: 8500, transferSent: 8500));
      expect(sent.refundSummary.transferRefundAwaitingMinor, 0);
    });
  });

  group('order details screen', () {
    testWidgets('Arabic: the card says part of the order was cancelled, the rejected vendor shows its reason, COD says nothing is charged for it', (tester) async {
      await _pump(tester, partialRejectionJson());
      expect(find.byKey(const Key('order-partial-rejection')), findsOneWidget);
      expect(find.text('تم إلغاء جزء من طلبك'), findsOneWidget);
      expect(find.textContaining('تعذّر على 1 من 2'), findsOneWidget);
      expect(find.textContaining('لن يتم تحصيل مبلغ الجزء الملغي'), findsOneWidget);
      expect(find.byKey(const Key('segment-rejection-s2')), findsOneWidget);
      expect(find.text('السبب: نفدت الكمية'), findsOneWidget);
    });

    testWidgets('English: a wallet refund is stated with its amount', (tester) async {
      await _pump(tester, partialRejectionJson(wallet: 8500), locale: const Locale('en'));
      expect(find.text('Part of your order was cancelled'), findsOneWidget);
      expect(find.textContaining('was returned to your wallet'), findsOneWidget);
      expect(find.text('Reason: نفدت الكمية'), findsOneWidget);
      expect(find.textContaining('You will not be charged'), findsNothing);
    });

    testWidgets('a Manual Transfer refund is NOT called sent until the server says so', (tester) async {
      await _pump(tester, partialRejectionJson(paymentMethod: 'MANUAL_TRANSFER', transferRecorded: 8500), locale: const Locale('en'));
      expect(find.textContaining('will be sent back to you by Hatly'), findsOneWidget);
      expect(find.textContaining('was sent back to you'), findsNothing);
    });

    testWidgets('a Manual Transfer refund marked sent is shown as sent', (tester) async {
      await _pump(tester, partialRejectionJson(paymentMethod: 'MANUAL_TRANSFER', transferRecorded: 8500, transferSent: 8500), locale: const Locale('en'));
      expect(find.textContaining('was sent back to you'), findsOneWidget);
      expect(find.textContaining('will be sent back'), findsNothing);
    });

    testWidgets('an unverified transfer shows the amount that will be settled after review, never as refunded', (tester) async {
      await _pump(tester, partialRejectionJson(paymentMethod: 'MANUAL_TRANSFER', pending: 8500), locale: const Locale('en'));
      expect(find.textContaining('will be settled once your payment has been reviewed'), findsOneWidget);
      expect(find.textContaining('returned to your wallet'), findsNothing);
    });

    testWidgets('an order without a rejection shows no such card', (tester) async {
      await _pump(tester, orderDetailsJson());
      expect(find.byKey(const Key('order-partial-rejection')), findsNothing);
    });
  });

  group('notification text', () {
    CustomerNotification n(String type) => CustomerNotification(
          id: 'n1',
          type: type,
          title: 'server title',
          body: 'server body',
          orderId: orderId,
          orderNumber: 'HT-100234',
          isRead: false,
          createdAt: DateTime.utc(2026, 10, 30),
        );

    testWidgets('ORDER_PART_CANCELLED is localized in both languages with the order number', (tester) async {
      late AppLocalizations ar;
      late AppLocalizations en;
      await tester.pumpWidget(Builder(builder: (context) {
        ar = lookupAppLocalizations(const Locale('ar'));
        en = lookupAppLocalizations(const Locale('en'));
        return const SizedBox();
      }));
      final textAr = notificationText(ar, n('ORDER_PART_CANCELLED'));
      final textEn = notificationText(en, n('ORDER_PART_CANCELLED'));
      expect(textAr.title, 'تم إلغاء جزء من طلبك');
      expect(textAr.body, contains('HT-100234'));
      expect(textEn.title, 'Part of your order was cancelled');
      expect(textEn.body, contains('HT-100234'));
      expect(textEn.body, isNot('server body'));
    });
  });
}
