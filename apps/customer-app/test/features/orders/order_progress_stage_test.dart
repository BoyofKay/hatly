import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/orders/presentation/order_widgets.dart';

/// The status card's progress bar is derived from the current status only — never from invented events.
void main() {
  test('delivery orders move placed → preparing → on the way → done', () {
    int? stage(String s) => orderProgressStage(s, isPickup: false);
    expect(stage('PENDING'), 1);
    expect(stage('CONFIRMED'), 1);
    expect(stage('PREPARING'), 2);
    expect(stage('READY_FOR_PICKUP'),
        2); // ready at the vendor, not yet on its way
    expect(stage('ASSIGNED_TO_DRIVER'), 3);
    expect(stage('PICKED_UP'), 3);
    expect(stage('ON_THE_WAY'), 3);
    expect(stage('DELIVERED'), orderProgressStageCount);
  });

  test('pickup orders: ready at the branch is the step before collected', () {
    expect(orderProgressStage('READY_FOR_PICKUP', isPickup: true), 3);
    expect(orderProgressStage('COLLECTED', isPickup: true),
        orderProgressStageCount);
  });

  test('cancelled, failed and unknown statuses draw no bar', () {
    for (final s in ['CANCELLED', 'FAILED_DELIVERY', 'SOMETHING_NEW']) {
      expect(orderProgressStage(s, isPickup: false), isNull, reason: s);
    }
  });
}
