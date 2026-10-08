import 'dart:convert';
import 'dart:typed_data';
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
  final List<(String status, DriverFailedDeliveryReason? reason, String? proofPhotoUrl, String? recipientName)> statusCalls = [];
  final List<(String deliveryId, int cashReceivedMinor)> cashRemainderCalls = [];
  String uploadedPhotoUrl = 'https://hatly.example/uploads/proof.jpg';
  Object? uploadPhotoError;

  @override
  Future<Delivery> getDelivery(String id) async => _delivery;

  @override
  Future<List<Delivery>> listDeliveries() async => [_delivery];

  @override
  Future<void> updateDeliveryStatus(
    String deliveryId,
    String status, {
    DriverFailedDeliveryReason? failureReason,
    String? proofPhotoUrl,
    String? recipientName,
  }) async {
    statusCalls.add((status, failureReason, proofPhotoUrl, recipientName));
  }

  @override
  Future<void> setOnlineStatus(bool isOnline) async {}

  @override
  Future<void> updateLocation({required double latitude, required double longitude}) async {}

  @override
  Future<void> recordWeight(String orderItemId, int weightGrams) async {}

  @override
  Future<void> recordPurchaseAmount(String orderItemId, int amountMinor) async {}

  @override
  Future<String> uploadProofPhoto(List<int> bytes, String filename) async {
    if (uploadPhotoError != null) throw uploadPhotoError!;
    return uploadedPhotoUrl;
  }

  @override
  Future<void> submitCashRemainder(String deliveryId, int cashReceivedMinor) async {
    cashRemainderCalls.add((deliveryId, cashReceivedMinor));
  }
}

/// A fixed, fake camera capture — no `image_picker` platform channel exists in widget tests.
/// A real, minimal 1x1 PNG (not arbitrary bytes) so `Image.memory`'s preview actually decodes.
final _fakePhotoBytes = base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
Future<({Uint8List bytes, String filename})?> _fakePickPhoto() async => (bytes: _fakePhotoBytes, filename: 'proof.jpg');

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
      overrides: [
        driverApiProvider.overrideWithValue(fakeApi),
        proofOfDeliveryPhotoPickerProvider.overrideWithValue(_fakePickPhoto),
      ],
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

      expect(api.statusCalls, [('FAILED_DELIVERY', DriverFailedDeliveryReason.customerUnreachable, null, null)]);
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

  });

  group('M4 — Proof of Delivery', () {
    testWidgets('Delivered opens the Proof of Delivery sheet instead of submitting immediately (a non-collection delivery, no Cash Collection step)', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();

      expect(find.text('Proof of Delivery'), findsOneWidget);
      expect(api.statusCalls, isEmpty); // no submission until the sheet is confirmed
    });

    testWidgets('CRITICAL: "Confirm Delivered" stays disabled until a photo has been taken and uploaded', (tester) async {
      await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();

      final confirmButton = tester.widget<FilledButton>(find.byKey(const Key('pod-confirm')));
      expect(confirmButton.onPressed, isNull);

      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();

      expect(find.text('Photo uploaded'), findsOneWidget);
      final confirmAfter = tester.widget<FilledButton>(find.byKey(const Key('pod-confirm')));
      expect(confirmAfter.onPressed, isNotNull);
    });

    testWidgets('confirming with an uploaded photo submits DELIVERED with that exact photo URL and no recipient name when left blank', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));
      api.uploadedPhotoUrl = 'https://hatly.example/uploads/real-proof.jpg';

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-confirm')));
      await tester.pumpAndSettle();

      expect(api.statusCalls, [('DELIVERED', null, 'https://hatly.example/uploads/real-proof.jpg', null)]);
    });

    testWidgets('a recipient name, when entered, is included in the DELIVERED submission', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('pod-recipient-name')), 'Ahmed');
      await tester.tap(find.byKey(const Key('pod-confirm')));
      await tester.pumpAndSettle();

      expect(api.statusCalls.single.$4, 'Ahmed');
    });

    testWidgets('CRITICAL: cancelling the Proof of Delivery sheet submits nothing — the delivery status is left completely untouched', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-cancel')));
      await tester.pumpAndSettle();

      expect(api.statusCalls, isEmpty);
    });

    testWidgets('an upload failure shows an error and never submits DELIVERED', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));
      api.uploadPhotoError = Exception('network error');

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Could not upload'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('pod-confirm'))).onPressed, isNull);
      expect(api.statusCalls, isEmpty);
    });
  });

  group('M4 — Cash Collection (COD/PAY_AT_DELIVERY over-collection)', () {
    testWidgets('COD: Delivered opens Cash Collection FIRST, pre-filled with the amount due', (tester) async {
      await pump(tester, _codDelivery(amountDueMinor: 4000));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();

      expect(find.text('Cash Collection'), findsOneWidget);
      expect(find.text('Proof of Delivery'), findsNothing); // not shown yet
      final field = tester.widget<TextField>(find.byKey(const Key('cash-received-input')));
      expect(field.controller!.text, '40.00');
    });

    testWidgets('exact cash: confirming proceeds straight to Proof of Delivery with no cash-remainder submission', (tester) async {
      final api = await pump(tester, _codDelivery(amountDueMinor: 4000));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('cash-confirm'))); // unchanged 40.00 == amount due
      await tester.pumpAndSettle();

      expect(api.cashRemainderCalls, isEmpty);
      expect(find.text('Proof of Delivery'), findsOneWidget);
    });

    testWidgets('CRITICAL: overpayment submits a cash-remainder claim with the exact change in minor units BEFORE Proof of Delivery, then still requires a photo to complete DELIVERED', (tester) async {
      final api = await pump(tester, _codDelivery(amountDueMinor: 4000));
      api.uploadedPhotoUrl = 'https://hatly.example/uploads/real-proof.jpg';

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('cash-received-input')), '50.00');
      await tester.pumpAndSettle();
      expect(find.text('Change to record: 10.00'), findsOneWidget);
      await tester.tap(find.byKey(const Key('cash-confirm')));
      await tester.pumpAndSettle();

      // The backend itself computes the remainder from the FULL cash received minus
      // amountDueMinor (see DriverCashRemainderService.submit) — the app sends the
      // full amount actually received (50.00 => 5000 minor units), never a
      // pre-subtracted "change" figure.
      expect(api.cashRemainderCalls, [('delivery-1', 5000)]);
      expect(api.statusCalls, isEmpty); // Proof of Delivery still required
      expect(find.text('Proof of Delivery'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-confirm')));
      await tester.pumpAndSettle();

      expect(api.statusCalls, [('DELIVERED', null, 'https://hatly.example/uploads/real-proof.jpg', null)]);
    });

    testWidgets('CRITICAL: cancelling Cash Collection aborts the whole flow — no cash-remainder call, no Proof of Delivery, no status change', (tester) async {
      final api = await pump(tester, _codDelivery(amountDueMinor: 4000));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('cash-received-input')), '50.00');
      await tester.tap(find.byKey(const Key('cash-cancel')));
      await tester.pumpAndSettle();

      expect(api.cashRemainderCalls, isEmpty);
      expect(find.text('Proof of Delivery'), findsNothing);
      expect(api.statusCalls, isEmpty);
    });

    testWidgets('entering less than the amount due shows a validation error and does not proceed to Proof of Delivery', (tester) async {
      final api = await pump(tester, _codDelivery(amountDueMinor: 4000));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('cash-received-input')), '30.00');
      await tester.tap(find.byKey(const Key('cash-confirm')));
      await tester.pumpAndSettle();

      expect(find.text('Cash received cannot be less than the amount due.'), findsOneWidget);
      expect(api.cashRemainderCalls, isEmpty);
      expect(find.text('Proof of Delivery'), findsNothing);
      expect(api.statusCalls, isEmpty);
    });

    testWidgets('a Manual Transfer delivery (already paid, nothing to collect) skips Cash Collection entirely and goes straight to Proof of Delivery', (tester) async {
      await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER', amountDueMinor: 4000));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();

      expect(find.text('Cash Collection'), findsNothing);
      expect(find.text('Proof of Delivery'), findsOneWidget);
    });
  });
}
