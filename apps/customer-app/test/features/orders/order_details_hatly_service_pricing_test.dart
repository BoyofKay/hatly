import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
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

const _pending = 'سيتم تأكيد السعر أثناء تجهيز الطلب';

/// `GET /orders/:id` for a Hatly Service order: one AD_HOC_SERVICE segment with one product-less request. While the price is
/// pending: subtotal 0 (only what is confirmed so far), total / amount due null, `hasPendingPricing` true, item `PENDING`.
Map<String, dynamic> hatlyServiceOrderJson(
    {required bool confirmed, int? amountMinor, bool withPriceStatus = true}) {
  const fee = 11000;
  final subtotal = confirmed ? amountMinor! : 0;
  final total = confirmed ? subtotal + fee : null;
  final json = orderDetailsJson(withBreakdown: false);
  json['subtotalMinor'] = subtotal;
  json['deliveryFeeMinor'] = fee;
  json['totalMinor'] = total;
  json['amountDueMinor'] = total;
  json['hasPendingPricing'] = !confirmed;
  json['payment'] = {
    'method': 'COD',
    'status': 'DUE_ON_DELIVERY',
    'amountMinor': null,
    'electronicMethod': null,
    'walletAmountMinor': 0,
    'amountDueMinor': total,
    'awaitingApproval': false,
  };
  json['segments'] = [
    {
      'id': 'hs1',
      'groupType': 'AD_HOC_SERVICE',
      'vendorBranchId': null,
      'vendorBranchName': null,
      'adHocPlaceNameSnapshot': 'صيدلية الزاوية',
      'adHocServiceTypeSnapshot': 'BUY_FROM_PLACE',
      'adHocPickupLatitudeSnapshot': 30.3,
      'adHocPickupLongitudeSnapshot': 31.45,
      'status': 'PENDING',
      'subtotalMinor': subtotal,
      'items': [
        {
          'id': 'hsi1',
          'productId': null,
          'productNameSnapshot': null,
          'quantity': 1,
          'unitPriceMinor': null,
          'actualAmountMinor': confirmed ? amountMinor : null,
          if (withPriceStatus)
            'priceStatus': confirmed ? 'CONFIRMED' : 'PENDING',
          'freeTextDescriptionSnapshot': 'بنادول إكسترا، علبتين',
          'optionsSnapshot': [],
        },
      ],
    },
  ];
  return json;
}

Future<void> _pump(WidgetTester tester, FakeOrdersReadApi api,
    {Locale locale = const Locale('ar'),
    double scale = 1.0,
    double width = 390}) async {
  tester.view.physicalSize = Size(width * 3, 4000 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyRouterApp(
    locale: locale,
    textScale: scale,
    overrides: [
      ordersApiProvider.overrideWithValue(api),
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
    test(
        'the explicit price state and the order-level pending flag are read from the server',
        () {
      final pending =
          OrderDetails.fromJson(hatlyServiceOrderJson(confirmed: false));
      expect(pending.hasPendingPricing, isTrue);
      expect(pending.totalMinor, isNull);
      expect(pending.amountDueMinor, isNull);
      final item = pending.segments.single.items.single;
      expect(item.priceStatus, 'PENDING');
      expect(item.isPricePending, isTrue);

      final confirmed = OrderDetails.fromJson(
          hatlyServiceOrderJson(confirmed: true, amountMinor: 25000));
      expect(confirmed.hasPendingPricing, isFalse);
      expect(confirmed.segments.single.items.single.isPricePending, isFalse);
      expect(confirmed.segments.single.items.single.actualAmountMinor, 25000);
    });

    test(
        'an older response without the new fields still reads correctly (product-less + no amount = pending)',
        () {
      final old =
          hatlyServiceOrderJson(confirmed: false, withPriceStatus: false)
            ..remove('hasPendingPricing');
      final order = OrderDetails.fromJson(old);
      expect(order.hasPendingPricing, isFalse);
      expect(order.segments.single.items.single.priceStatus, isNull);
      expect(order.segments.single.items.single.isPricePending, isTrue);
      // a normal catalog item is never "pending"
      final catalog =
          OrderDetails.fromJson(orderDetailsJson()).segments.first.items.single;
      expect(catalog.isPricePending, isFalse);
    });
  });

  group('Order Details for a Hatly Service order with a pending price', () {
    testWidgets(
        'the request, the subtotal and the total each show the pending state — never 0 — and payment is COD',
        (tester) async {
      await _pump(tester,
          FakeOrdersReadApi(details: hatlyServiceOrderJson(confirmed: false)));
      expect(find.byKey(const Key('order-item-price-pending')), findsOneWidget);
      expect(find.byKey(const Key('order-subtotal-pending')), findsOneWidget);
      expect(find.byKey(const Key('order-total-pending')), findsOneWidget);
      expect(find.text(_pending), findsNWidgets(3));
      expect(find.text('0 ج.م'), findsNothing);
      expect(find.text('بنادول إكسترا، علبتين'), findsOneWidget);
      expect(find.text('الدفع نقدًا عند الاستلام'), findsWidgets);
      // The delivery fee IS known and is shown.
      expect(find.text('110 ج.م'), findsWidgets);
      // Creating the order is not paying for it: no paid / awaiting-approval status is claimed.
      expect(find.text('مدفوع'), findsNothing);
    });

    testWidgets('English wording, large text on a narrow screen: no overflow',
        (tester) async {
      await _pump(tester,
          FakeOrdersReadApi(details: hatlyServiceOrderJson(confirmed: false)),
          locale: const Locale('en'), scale: 2.0, width: 320);
      expect(tester.takeException(), isNull);
      expect(
          find.text(
              'The price will be confirmed while your order is being prepared'),
          findsNWidgets(3));
    });
  });

  group('after operations confirm the price', () {
    testWidgets(
        'the confirmed amount replaces the pending state: item, subtotal and the server-computed total are shown',
        (tester) async {
      await _pump(
          tester,
          FakeOrdersReadApi(
              details:
                  hatlyServiceOrderJson(confirmed: true, amountMinor: 25000)));
      expect(find.byKey(const Key('order-item-price-pending')), findsNothing);
      expect(find.byKey(const Key('order-subtotal-pending')), findsNothing);
      expect(find.byKey(const Key('order-total-pending')), findsNothing);
      expect(find.text(_pending), findsNothing);
      expect(find.text('250 ج.م'), findsWidgets); // item + subtotal
      expect(find.text('360 ج.م'),
          findsOneWidget); // total = 250 + 110, computed by the backend
    });

    testWidgets(
        'reopening / refreshing the order picks the confirmed total up (pending → confirmed, no client-side arithmetic)',
        (tester) async {
      final api =
          FakeOrdersReadApi(details: hatlyServiceOrderJson(confirmed: false));
      await _pump(tester, api);
      expect(find.byKey(const Key('order-total-pending')), findsOneWidget);

      api.details = hatlyServiceOrderJson(
          confirmed: true,
          amountMinor: 9000); // operations confirmed it on the server
      final container = ProviderScope.containerOf(
          tester.element(find.byType(OrderDetailsScreen)));
      container.invalidate(orderDetailsProvider(orderId));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('order-total-pending')), findsNothing);
      expect(find.text('200 ج.م'), findsOneWidget); // 90 + 110
    });
  });
}
