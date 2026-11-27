import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_driver/features/deliveries/domain/delivery.dart';
import 'package:hatly_driver/shared_widgets/voice_note_player.dart';

import 'delivery_detail_screen_test.dart' show pump;

class _FakePlayback implements VoiceNotePlayback {
  final List<String> played = [];
  int stops = 0;
  @override
  Future<void> play(String url, {required void Function() onDone}) async => played.add(url);
  @override
  Future<void> stop() async => stops++;
  @override
  Future<void> dispose() async {}
}

/// Owner decision 2026-11-27: the customer's voice note reaches the driver, and Operations can write a note for the driver.
void main() {
  Delivery withVoice({String? opsNote, String? voice = '/uploads/files/voice-1.m4a', String? text}) => Delivery(
        id: 'delivery-1',
        orderId: 'order-1',
        orderStatus: 'ON_THE_WAY',
        fulfillmentType: 'DELIVERY',
        paymentMethod: 'COD',
        totalMinor: null,
        customerName: 'Jane Customer',
        customerPhone: '+201000000099',
        deliveryAddress: const DeliveryAddress(line1: '12 Market St', latitude: 30.1, longitude: 31.2),
        operationsNote: opsNote,
        segments: [
          DeliverySegment(id: 's1', groupType: 'AD_HOC_SERVICE', status: 'READY_FOR_PICKUP', adHocPlaceNameSnapshot: 'Corner Pharmacy', items: [
            DeliverySegmentItem(id: 'i1', quantity: 1, optionsSnapshot: const [], imageUrlsSnapshot: const [], freeTextDescriptionSnapshot: text, voiceNoteUrlSnapshot: voice),
          ]),
        ],
      );

  test('the delivery JSON carries the operations note and the item voice note (absent on an older server = none)', () {
    final json = {
      'id': 'd', 'orderId': 'o', 'orderStatus': 'ON_THE_WAY', 'fulfillmentType': 'DELIVERY', 'paymentMethod': 'COD', 'totalMinor': null,
      'customerName': 'c', 'customerPhone': 'p', 'deliveryAddress': {'line1': 'x', 'latitude': 30.1, 'longitude': 31.2}, 'operationsNote': 'Ask for the large pack',
      'segments': [
        {'id': 's', 'groupType': 'AD_HOC_SERVICE', 'status': 'READY_FOR_PICKUP', 'items': [
          {'id': 'i', 'quantity': 1, 'optionsSnapshot': [], 'voiceNoteUrlSnapshot': '/uploads/files/v.m4a'}
        ]}
      ],
    };
    final d = Delivery.fromJson(json);
    expect(d.operationsNote, 'Ask for the large pack');
    expect(d.segments.single.items.single.voiceNoteUrlSnapshot, '/uploads/files/v.m4a');
    final old = Delivery.fromJson({...json, 'operationsNote': null, 'segments': []});
    expect(old.operationsNote, isNull);
  });

  testWidgets('shows the Operations note and a play button for a voice-only request', (tester) async {
    tester.view.physicalSize = const Size(400, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await pump(tester, withVoice(opsNote: 'Ask for the large pack'));
    expect(find.byKey(const Key('delivery-operations-note')), findsOneWidget);
    expect(find.textContaining('Ask for the large pack'), findsOneWidget);
    expect(find.byKey(const Key('voice-note-play')), findsOneWidget);
  });

  testWidgets('no note and no voice: neither is shown', (tester) async {
    tester.view.physicalSize = const Size(400, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await pump(tester, withVoice(voice: null, text: 'Panadol'));
    expect(find.byKey(const Key('delivery-operations-note')), findsNothing);
    expect(find.byKey(const Key('voice-note-play')), findsNothing);
  });

  testWidgets('the player plays the URL and stops on a second tap', (tester) async {
    final fake = _FakePlayback();
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: VoiceNotePlayer(url: 'https://api.test/uploads/files/v.m4a', player: fake))));
    await tester.tap(find.byKey(const Key('voice-note-play')));
    await tester.pumpAndSettle();
    expect(fake.played, ['https://api.test/uploads/files/v.m4a']);
    await tester.tap(find.byKey(const Key('voice-note-play')));
    await tester.pumpAndSettle();
    expect(fake.stops, 1);
  });
}
