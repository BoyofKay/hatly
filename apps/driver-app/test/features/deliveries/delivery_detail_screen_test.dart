import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/deliveries/data/driver_api.dart';
import 'package:hatly_driver/features/deliveries/data/driver_providers.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/features/earnings/domain/earnings.dart';
import 'package:hatly_driver/features/deliveries/presentation/delivery_detail_screen.dart';

/// A fake of the real `DriverApi` — no real Dio/ApiClient/secure-storage plumbing needed for these
/// widget tests, since `DeliveryDetailScreen` only ever calls it through `driverApiProvider`.
class FakeDriverApi implements DriverApi {
  @override
  Future<bool?> getOnlineStatus() async => null;
  @override
  Future<String?> getProfileName() async => 'Test driver';
  FakeDriverApi(this._delivery);

  Delivery _delivery;
  final List<(String status, DriverFailedDeliveryReason? reason, String? proofPhotoUrl, String? recipientName)> statusCalls = [];
  final List<(String deliveryId, int cashReceivedMinor)> cashRemainderCalls = [];
  String uploadedPhotoUrl = 'https://hatly.example/uploads/proof.jpg';
  Object? uploadPhotoError;

  @override
  Future<Delivery> getDelivery(String id) async => _delivery;

  final List<String> acknowledgeCalls = [];
  Delivery Function()? afterAcknowledge;
  String? operationsPhone = '+201000000777';

  @override
  Future<Delivery> acknowledgeDelivery(String id) async {
    acknowledgeCalls.add(id);
    if (afterAcknowledge != null) _delivery = afterAcknowledge!();
    return _delivery;
  }

  @override
  Future<String?> getOperationsPhone() async => operationsPhone;

  @override
  Future<DriverEarnings> getEarnings() async => throw UnimplementedError();

  @override
  Future<TransactionsPage> getTransactions({int page = 1, int limit = 20, String? scope}) async => throw UnimplementedError();

  @override
  Future<T> retryTransient<T>(Future<T> Function() op, {int attempts = 3, Duration pause = const Duration(milliseconds: 800)}) => op();

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
  ackTests();
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

    testWidgets('owner decision 2026-11-13: the photo is OPTIONAL — Confirm is enabled at once and submits DELIVERED with no photo', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('pod-photo-optional')), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('pod-confirm'))).onPressed, isNotNull);
      await tester.tap(find.byKey(const Key('pod-confirm')));
      await tester.pumpAndSettle();

      expect(api.statusCalls, [('DELIVERED', null, null, null)]);
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

    testWidgets('an upload failure shows an error; the driver can still confirm WITHOUT the photo (the failed one is never attached)', (tester) async {
      final api = await pump(tester, _codDelivery(paymentMethod: 'MANUAL_TRANSFER'));
      api.uploadPhotoError = Exception('network error');

      await tester.tap(find.text('Delivered'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('pod-pick-photo')));
      await tester.pumpAndSettle();

      expect(find.textContaining('Could not upload'), findsOneWidget);
      expect(api.statusCalls, isEmpty); // nothing submitted by the failure itself
      await tester.tap(find.byKey(const Key('pod-confirm')));
      await tester.pumpAndSettle();
      expect(api.statusCalls, [('DELIVERED', null, null, null)]);
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

Delivery _assigned({DateTime? acknowledgedAt, DateTime? acceptDeadlineAt}) {
  return Delivery(
    id: 'delivery-1',
    orderId: 'order-1',
    orderStatus: 'ASSIGNED_TO_DRIVER',
    fulfillmentType: 'DELIVERY',
    paymentMethod: 'COD',
    totalMinor: 10000,
    amountDueMinor: 10000,
    customerName: 'Jane Customer',
    customerPhone: '+201000000099',
    deliveryAddress: const DeliveryAddress(line1: '12 Market St', latitude: 30.1, longitude: 31.2),
    acceptDeadlineAt: acceptDeadlineAt ?? DateTime.now().add(const Duration(minutes: 5)),
    acknowledgedAt: acknowledgedAt,
    segments: const [],
  );
}

void ackTests() {
  group('R16 acknowledgement', () {
    testWidgets('an unacknowledged assignment offers ONLY "I\'ve seen this order", with the deadline and Call Operations', (tester) async {
      await pump(tester, _assigned());
      expect(find.byKey(const Key('acknowledge-button')), findsOneWidget);
      expect(find.byKey(const Key('action-bar')), findsNothing); // no Picked-up step before the acknowledgement
      expect(find.byKey(const Key('acknowledge-deadline')), findsOneWidget);
      expect(find.textContaining('Confirm by'), findsOneWidget);
      expect(find.byKey(const Key('call-operations')), findsOneWidget);
      expect(find.textContaining('Reject'), findsNothing);
      expect(find.textContaining('Decline'), findsNothing);
    });

    testWidgets('tapping it acknowledges once, then the normal steps appear', (tester) async {
      final api = await pump(tester, _assigned());
      api.afterAcknowledge = () => _assigned(acknowledgedAt: DateTime.now());
      await tester.tap(find.byKey(const Key('acknowledge-button')));
      await tester.pumpAndSettle();
      expect(api.acknowledgeCalls, ['delivery-1']);
      expect(find.byKey(const Key('acknowledge-button')), findsNothing);
      expect(find.byKey(const Key('acknowledged-at')), findsOneWidget);
      expect(find.byKey(const Key('action-bar')), findsOneWidget);
    });

    testWidgets('an overdue confirmation says Operations were told (nothing is taken away)', (tester) async {
      await pump(tester, _assigned(acceptDeadlineAt: DateTime.now().subtract(const Duration(minutes: 1))));
      expect(find.textContaining('Operations have been told'), findsOneWidget);
      expect(find.byKey(const Key('acknowledge-button')), findsOneWidget);
    });

    testWidgets('no Operations number configured: the call button is hidden, the advice stays', (tester) async {
      final fakeApi = FakeDriverApi(_assigned())..operationsPhone = null;
      await tester.pumpWidget(ProviderScope(
        overrides: [driverApiProvider.overrideWithValue(fakeApi), proofOfDeliveryPhotoPickerProvider.overrideWithValue(_fakePickPhoto)],
        child: const MaterialApp(home: DeliveryDetailScreen(deliveryId: 'delivery-1')),
      ));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('call-operations')), findsNothing);
      expect(find.textContaining('Call Operations'), findsWidgets);
    });

    testWidgets('an order already picked up shows no acknowledgement card', (tester) async {
      await pump(tester, _codDelivery());
      expect(find.byKey(const Key('acknowledgement-card')), findsNothing);
    });
  });
}
