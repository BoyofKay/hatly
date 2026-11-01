import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/presentation/order_tracking_screen.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/test_app.dart';

Future<void> _pump(
  WidgetTester tester,
  FakeOrdersReadApi api, {
  bool dark = false,
  Locale locale = const Locale('ar'),
  double scale = 1.0,
  double width = 390,
  bool support = true,
}) async {
  tester.view.physicalSize = Size(width * 3, 2400 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(hatlyTestApp(const OrderTrackingScreen(orderId: orderId),
      dark: dark,
      locale: locale,
      textScale: scale,
      overrides: [
        ordersApiProvider.overrideWithValue(api),
        supportContactProvider.overrideWith((ref) async => SupportContact(
            whatsappNumber: support ? '+201000000000' : null)),
      ]));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows status, ETA, the vertical timeline and per-vendor progress with preparation ETA', (tester) async {
    await _pump(tester, FakeOrdersReadApi());
    expect(find.byKey(const Key('order-status-title')), findsOneWidget);
    expect(find.text('جارٍ التحضير'), findsWidgets);
    // the customer-facing order number, never the internal UUID
    expect(find.text('\u2066#HT-100001\u2069'), findsOneWidget);
    expect(find.byKey(const Key('order-eta')), findsOneWidget);
    expect(find.byKey(const Key('order-timeline')), findsOneWidget);
    // three history steps, oldest first
    final pending = tester.getTopLeft(find.text('تم تقديم الطلب')).dy;
    final confirmed = tester.getTopLeft(find.text('تم التأكيد')).dy;
    expect(pending, lessThan(confirmed));
    // vendors
    expect(find.text('مطعم النخيل'), findsOneWidget);
    expect(find.text('صيدلية الأمل'), findsOneWidget);
    expect(find.textContaining('جاهز'), findsWidgets);
  });

  testWidgets('a vendor that is already ready shows no preparation ETA', (tester) async {
    await _pump(tester, FakeOrdersReadApi());
    // s2 is READY_FOR_PICKUP with nothing to estimate: only s1 (PREPARING) has a "ready around" line.
    expect(find.textContaining('يكون جاهزًا حوالي'), findsOneWidget);
  });

  testWidgets('V1 has NO live map, driver card or location', (tester) async {
    await _pump(tester, FakeOrdersReadApi());
    expect(find.byIcon(Icons.map), findsNothing);
    expect(find.byIcon(Icons.delivery_dining), findsNothing);
    expect(find.textContaining('السائق'), findsNothing);
    expect(find.textContaining('المندوب'), findsNothing);
  });

  testWidgets('a transfer awaiting review is flagged', (tester) async {
    await _pump(tester, FakeOrdersReadApi(tracking: trackingJson(awaiting: true, paymentMethod: 'MANUAL_TRANSFER')));
    expect(find.byKey(const Key('order-payment-awaiting')), findsOneWidget);
  });

  testWidgets('offers support, pre-filled with the order; hidden when no number is configured', (tester) async {
    await _pump(tester, FakeOrdersReadApi());
    expect(find.byKey(const Key('tracking-support-contact')), findsOneWidget);
    await _pump(tester, FakeOrdersReadApi(), support: false);
    expect(find.text('تواصل مع Hatly بخصوص الطلب'), findsNothing);
  });

  testWidgets('a cancelled order shows its terminal state and no ETA', (tester) async {
    final t = trackingJson(status: 'CANCELLED')
      ..['eta'] = {'state': 'CANCELLED', 'estimatedAt': null, 'estimatedUntil': null, 'delayed': false}
      ..['cancellationReason'] = 'Vendor closed';
    await _pump(tester, FakeOrdersReadApi(tracking: t));
    expect(find.byKey(const Key('order-eta')), findsNothing);
    expect(find.text('Vendor closed'), findsOneWidget);
  });

  testWidgets('a delayed order says so gently', (tester) async {
    final t = trackingJson();
    (t['eta'] as Map)['delayed'] = true;
    await _pump(tester, FakeOrdersReadApi(tracking: t));
    expect(find.byKey(const Key('order-eta-delayed')), findsOneWidget);
  });

  group('themes, RTL and small screens', () {
    for (final dark in [false, true]) {
      for (final locale in [const Locale('ar'), const Locale('en')]) {
        for (final scale in [1.0, 2.0]) {
          testWidgets('no overflow: ${locale.languageCode} ${dark ? 'dark' : 'light'} 320 ${scale}x', (tester) async {
            await _pump(tester, FakeOrdersReadApi(), dark: dark, locale: locale, scale: scale, width: 320);
            expect(tester.takeException(), isNull);
          });
        }
      }
    }
  });
}
