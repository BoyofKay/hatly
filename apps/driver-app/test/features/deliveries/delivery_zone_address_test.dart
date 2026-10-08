import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/deliveries/data/driver_providers.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/features/deliveries/presentation/delivery_detail_screen.dart';

import 'delivery_detail_screen_test.dart' show FakeDriverApi;

/// PD-009 — a delivery address located only by its Delivery Zone (no map pin) must never crash the driver app, and must show
/// the area the driver needs instead of a Maps button pointing nowhere.
Delivery _delivery(DeliveryAddress address) => Delivery(
      id: 'delivery-1',
      orderId: 'order-1',
      orderStatus: 'ON_THE_WAY',
      fulfillmentType: 'DELIVERY',
      paymentMethod: 'COD',
      totalMinor: 10000,
      amountDueMinor: 10000,
      customerName: 'Jane Customer',
      customerPhone: '+201000000099',
      deliveryAddress: address,
      segments: const [],
    );

Future<void> _pump(WidgetTester tester, Delivery delivery) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [driverApiProvider.overrideWithValue(FakeDriverApi(delivery))],
      child: const MaterialApp(home: DeliveryDetailScreen(deliveryId: 'delivery-1')),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  group('DeliveryAddress.fromJson', () {
    test('parses a pin-less, zone-located address without throwing', () {
      final a = DeliveryAddress.fromJson({
        'line1': 'شارع أبو نصيب جنب جامع الكردي، منزل 15',
        'deliveryZoneId': 'zone-1',
        'deliveryZone': {'id': 'zone-1', 'name': 'Abu Naseeb', 'nameAr': 'أبو نصيب', 'city': 'Belbeis', 'cityAr': 'بلبيس'},
        'floor': '2',
        'landmark': 'جنب جامع الكردي',
      });
      expect(a.hasPin, isFalse);
      expect(a.latitude, isNull);
      expect(a.areaLabel, 'بلبيس — أبو نصيب');
      expect(a.floor, '2');
    });

    test('a pinned legacy address still parses exactly as before (no zone)', () {
      final a = DeliveryAddress.fromJson({'line1': '12 Market St', 'latitude': 30.1, 'longitude': 31});
      expect(a.hasPin, isTrue);
      expect(a.longitude, 31.0);
      expect(a.areaLabel, isNull);
    });

    test('half a pin is treated as no pin — never a partial coordinate', () {
      final a = DeliveryAddress.fromJson({'line1': 'x', 'latitude': 30.1});
      expect(a.hasPin, isFalse);
      expect(a.latitude, isNull);
    });
  });

  group('DeliveryDetailScreen', () {
    testWidgets('a pin-less order shows the area + written details and NO Maps button', (tester) async {
      await _pump(
        tester,
        _delivery(const DeliveryAddress(
          line1: 'شارع أبو نصيب جنب جامع الكردي، منزل 15',
          zoneNameAr: 'أبو نصيب',
          zoneCityAr: 'بلبيس',
          floor: '2',
          landmark: 'جنب جامع الكردي',
        )),
      );
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('delivery-area')), findsOneWidget);
      expect(find.text('بلبيس — أبو نصيب'), findsOneWidget);
      expect(find.text('شارع أبو نصيب جنب جامع الكردي، منزل 15'), findsOneWidget);
      expect(find.textContaining('Floor 2'), findsOneWidget);
      expect(find.byKey(const Key('delivery-no-pin')), findsOneWidget);
      // the only "Open in Maps" buttons left would be vendor pickups; this delivery has none
      expect(find.text('Open in Maps'), findsNothing);
    });

    testWidgets('a pinned order keeps its Maps button', (tester) async {
      await _pump(tester, _delivery(const DeliveryAddress(line1: '12 Market St', latitude: 30.1, longitude: 31.2)));
      expect(find.text('Open in Maps'), findsOneWidget);
      expect(find.byKey(const Key('delivery-no-pin')), findsNothing);
    });
  });

  group('PD-009 amended — a pin-less, not-yet-priced Hatly Service delivery', () {
    // Exactly what GET /driver/deliveries/:id sends for such an order (totalMinor / amountDueMinor are null until the price
    // is confirmed; the customer address has a zone and no pin).
    Map<String, dynamic> payload() => {
          'id': 'delivery-hs',
          'orderId': 'order-hs',
          'orderStatus': 'ASSIGNED_TO_DRIVER',
          'fulfillmentType': 'DELIVERY',
          'orderNote': null,
          'paymentMethod': 'COD',
          'electronicPaymentMethod': null,
          'totalMinor': null,
          'amountDueMinor': null,
          'customerName': 'Jane Customer',
          'customerPhone': '+201000000099',
          'deliveryAddress': {
            'line1': 'شارع أبو نصيب جنب جامع الكردي، منزل 15',
            'deliveryZoneId': 'zone-1',
            'deliveryZone': {'id': 'zone-1', 'name': 'Abu Naseeb', 'nameAr': 'أبو نصيب', 'city': 'Belbeis', 'cityAr': 'بلبيس'},
          },
          'assignedAt': null,
          'acceptDeadlineAt': null,
          'pickedUpAt': null,
          'deliveredAt': null,
          'segments': [
            {
              'id': 'seg-1',
              'groupType': 'AD_HOC_SERVICE',
              'status': 'PENDING',
              'vendorBranchId': null,
              'adHocPlaceNameSnapshot': 'صيدلية',
              'adHocServiceTypeSnapshot': 'DELIVER_TO_PLACE',
              'adHocDestinationLatitudeSnapshot': 30.41,
              'adHocDestinationLongitudeSnapshot': 31.56,
              'items': <dynamic>[],
            },
          ],
        };

    test('parses without a crash: null total is kept as "unknown", never 0; the address has no pin', () {
      final d = Delivery.fromJson(payload());
      expect(d.totalMinor, isNull);
      expect(d.amountDueMinor, isNull);
      expect(d.deliveryAddress.hasPin, isFalse);
      expect(d.deliveryAddress.areaLabel, 'بلبيس — أبو نصيب');
    });

    testWidgets('the detail screen renders it: price pending (no fake 0), the area, and no fake location for the customer', (tester) async {
      await _pump(tester, Delivery.fromJson(payload()));
      expect(tester.takeException(), isNull);
      expect(find.text('Total: price pending (confirmed during preparation)'), findsOneWidget);
      expect(find.textContaining('Total: 0'), findsNothing);
      expect(find.text('بلبيس — أبو نصيب'), findsOneWidget);
      expect(find.byKey(const Key('delivery-no-pin')), findsOneWidget);
    });
  });
}
