import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/deliveries/data/driver_providers.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/features/deliveries/presentation/delivery_detail_screen.dart';

import 'delivery_detail_screen_test.dart' show FakeDriverApi;

/// PD-012 — a Hatly / Wasally delivery goes ORIGIN → DESTINATION (each the customer's choice or the service default). The driver must
/// see both, in that order, each with its own Maps button; the customer's address is only who to contact.
Delivery _delivery({ServiceRoute? route}) => Delivery(
      id: 'delivery-1',
      orderId: 'order-1',
      orderStatus: 'ON_THE_WAY',
      fulfillmentType: 'DELIVERY',
      paymentMethod: 'COD',
      totalMinor: null,
      customerName: 'Jane Customer',
      customerPhone: '+201000000099',
      deliveryAddress: const DeliveryAddress(line1: 'GPS 30.42000, 31.56000'),
      segments: const [],
      serviceRoute: route,
    );

Future<void> _pump(WidgetTester tester, Delivery delivery) async {
  tester.view.physicalSize = const Size(390, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [driverApiProvider.overrideWithValue(FakeDriverApi(delivery))],
      child: const MaterialApp(home: DeliveryDetailScreen(deliveryId: 'delivery-1')),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('ServiceRoute parses both ends, the label, the source and the service; anything incomplete is null (never a guessed point)', () {
    final r = ServiceRoute.tryParse({
      'service': 'WASALLY',
      'origin': {'latitude': 30.1, 'longitude': 31.1, 'label': ' Customer start ', 'source': 'CUSTOMER'},
      'destination': {'latitude': 30.2, 'longitude': 31.2, 'label': null, 'source': 'DEFAULT'},
    })!;
    expect(r.service, 'WASALLY');
    expect(r.origin.label, 'Customer start');
    expect(r.origin.isDefault, isFalse);
    expect(r.destination.isDefault, isTrue);
    expect(r.destination.label, 'GPS 30.20000, 31.20000'); // an unlabeled point shows its coordinates
    expect(ServiceRoute.tryParse({'origin': {'latitude': 30.1, 'longitude': 31.1}}), isNull);
    expect(ServiceRoute.tryParse(null), isNull);
  });

  test('an older delivery (no route) parses with serviceRoute null', () {
    final d = Delivery.fromJson({
      'id': 'd',
      'orderId': 'o',
      'orderStatus': 'ON_THE_WAY',
      'fulfillmentType': 'DELIVERY',
      'paymentMethod': 'COD',
      'customerName': 'x',
      'deliveryAddress': {'line1': 'y'},
      'segments': [],
    });
    expect(d.serviceRoute, isNull);
  });

  testWidgets('shows From then To with their labels and a Maps button each, and says the address is the contact', (tester) async {
    await _pump(
      tester,
      _delivery(
        route: const ServiceRoute(
          service: 'HATLY',
          origin: RoutePoint(latitude: 30.1, longitude: 31.1, label: 'نقطة بداية هاتلي', isDefault: true),
          destination: RoutePoint(latitude: 30.2, longitude: 31.2, label: 'بيت ماما', isDefault: false),
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Route — Hatly'), findsOneWidget);
    expect(find.text('نقطة بداية هاتلي (default point)'), findsOneWidget);
    expect(find.text('بيت ماما'), findsOneWidget);
    expect(find.byKey(const Key('route-origin-maps')), findsOneWidget);
    expect(find.byKey(const Key('route-destination-maps')), findsOneWidget);
    expect(tester.getTopLeft(find.byKey(const Key('route-origin-label'))).dy, lessThan(tester.getTopLeft(find.byKey(const Key('route-destination-label'))).dy));
    expect(find.byKey(const Key('route-note')), findsOneWidget);
  });

  testWidgets('an ordinary delivery shows no route card', (tester) async {
    await _pump(tester, _delivery());
    expect(find.byKey(const Key('route-origin-label')), findsNothing);
  });
}
