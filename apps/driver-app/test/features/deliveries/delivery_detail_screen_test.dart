import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/deliveries/data/driver_api.dart';
import 'package:hatly_driver/features/deliveries/data/driver_providers.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/features/deliveries/presentation/delivery_detail_screen.dart';

/// A fake of the real `DriverApi` — no real Dio/ApiClient/secure-storage plumbing needed for these
/// widget tests, since `DeliveryDetailScreen` only ever calls it through `driverApiProvider`.
class FakeDriverApi implements DriverApi {
  FakeDriverApi(this._delivery);

  Delivery _delivery;
  final List<(String status, DriverFailedDeliveryReason? reason)> statusCalls = [];

  @override
  Future<Delivery> getDelivery(String id) async => _delivery;

  @override
  Future<List<Delivery>> listDeliveries() async => [_delivery];

  @override
  Future<void> updateDeliveryStatus(String deliveryId, String status, {DriverFailedDeliveryReason? failureReason}) async {
    statusCalls.add((status, failureReason));
  }

  @override
  Future<void> setOnlineStatus(bool isOnline) async {}

  @override
  Future<void> updateLocation({required double latitude, required double longitude}) async {}

  @override
  Future<void> recordWeight(String orderItemId, int weightGrams) async {}

  @override
  Future<void> recordPurchaseAmount(String orderItemId, int amountMinor) async {}
}

Delivery _codDelivery({int totalMinor = 10000, int? amountDueMinor = 4000, String paymentMethod = 'COD'}) {
  return Delivery(
    id: 'delivery-1',
    orderId: 'order-1',
    orderStatus: 'ON_THE_WAY',
    fulfillmentType: 'DELIVERY',
    paymentMethod: paymentMethod,
    totalMinor: totalMinor,
    amountDueMinor: amountDueMinor,
    customerName: 'Jane Customer',
    customerPhone: '+201000000099',
    deliveryAddress: const DeliveryAddress(line1: '12 Market St', latitude: 30.1, longitude: 31.2),
    segments: const [],
  );
}

Future<FakeDriverApi> pump(WidgetTester tester, Delivery delivery) async {
  final fakeApi = FakeDriverApi(delivery);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [driverApiProvider.overrideWithValue(fakeApi)],
      child: const MaterialApp(home: DeliveryDetailScreen(deliveryId: 'delivery-1')),
    ),
  );
  await tester.pumpAndSettle();
  return fakeApi;
}

void main() {
  group('Driver Core + Dispatch Foundation milestone', () {
    testWidgets('COD: shows "Amount to collect" using amountDueMinor, distinct from Total', (tester) async {
      await pump(tester, _codDelivery(totalMinor: 10000, amountDueMinor: 4000));

      expect(find.textContaining('Total: 100.00'), findsOneWidget);
      expect(find.textContaining('Amount to collect: 40.00'), findsOneWidget);
    });

    testWidgets('a Manual Transfer delivery (already paid before dispatch) shows no amount-to-collect line', (tester) async {
      await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER', amountDueMinor: 4000));

      expect(find.textContaining('Amount to collect'), findsNothing);
    });

    testWidgets('COD with no amountDueMinor (legacy order) shows no amount-to-collect line rather than throwing', (tester) async {
      await pump(tester, _codDelivery(amountDueMinor: null));

      expect(find.textContaining('Amount to collect'), findsNothing);
    });

    testWidgets('Failed Delivery opens a reason picker; selecting one submits that exact controlled reason', (tester) async {
      final api = await pump(tester, _codDelivery());

      await tester.tap(find.text('Failed Delivery'));
      await tester.pumpAndSettle();

      // The picker shows every controlled reason, never free text.
      for (final r in DriverFailedDeliveryReason.values) {
        expect(find.text(r.label), findsOneWidget);
      }

      await tester.tap(find.text(DriverFailedDeliveryReason.customerUnreachable.label));
      await tester.pumpAndSettle();

      expect(api.statusCalls, [('FAILED_DELIVERY', DriverFailedDeliveryReason.customerUnreachable)]);
    });

    testWidgets('dismissing the reason picker without a selection submits nothing', (tester) async {
      final api = await pump(tester, _codDelivery());

      await tester.tap(find.text('Failed Delivery'));
      await tester.pumpAndSettle();
      // Tap outside the dialog to dismiss it without choosing a reason.
      await tester.tapAt(const Offset(5, 5));
      await tester.pumpAndSettle();

      expect(api.statusCalls, isEmpty);
    });

    testWidgets('the normal lifecycle actions (e.g. Delivered) still submit immediately with no reason prompt', (tester) async {
      final api = await pump(tester, _codDelivery());

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();

      expect(api.statusCalls, [('DELIVERED', null)]);
    });
  });
}
