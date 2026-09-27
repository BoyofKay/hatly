import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/domain/order_summary.dart';
import 'package:hatly_customer/features/orders/domain/order_tracking.dart';

import '../../support/order_fixtures.dart';

void main() {
  group('OrderDetails.fromJson — the new lifecycle fields', () {
    test('parses the address snapshot, breakdown, coupon, wallet split, ETA, timeline and the cancel verdict', () {
      final o = OrderDetails.fromJson(orderDetailsJson(
        paymentMethod: 'PAY_AT_DELIVERY',
        electronicMethod: 'INSTAPAY',
        wallet: 2000,
        discount: 1000,
        coupon: {
          'code': 'SAVE10',
          'offerName': 'خصم 10',
          'discountMinor': 1000,
          'vendorBranchId': 'b1',
          'orderVendorSegmentId': 's1'
        },
      ));
      expect(o.isPickup, isFalse);
      expect(o.deliveryAddress!.buildingNumber, '12');
      expect(o.deliveryAddress!.detailLines.first, 'شارع الجمهورية، بلبيس');
      expect(o.electronicPaymentMethod, 'INSTAPAY');
      expect(o.walletAmountMinor, 2000);
      expect(o.amountDueMinor, 8500);
      expect(o.coupon!.code, 'SAVE10');
      expect(o.coupon!.discountMinor, 1000);
      expect(o.deliveryBreakdown!.baseFeeMinor, 1000);
      expect(o.deliveryBreakdown!.additionalVendorChargeMinor, 500);
      expect(o.deliveryBreakdown!.distanceMeters, 3400);
      expect(o.eta.isEstimated, isTrue);
      expect(o.timeline, hasLength(1));
      expect(o.customerCanCancel, isTrue);
      expect(o.segments.first.branchAddress, 'شارع البحر');
      expect(o.segments.first.expectedReadyAt, isNotNull);
      expect(o.segments.first.items.first.optionsSnapshot, hasLength(2));
      expect(o.payment!.electronicMethod, 'INSTAPAY');
      expect(o.payment!.awaitingApproval, isFalse);
    });

    test('a pickup order has no address snapshot and no delivery breakdown', () {
      final o = OrderDetails.fromJson(orderDetailsJson(pickup: true));
      expect(o.isPickup, isTrue);
      expect(o.deliveryAddress, isNull);
      expect(o.deliveryBreakdown, isNull);
    });

    test('a legacy order (none of the new fields) still parses, with safe defaults', () {
      final json = orderDetailsJson();
      for (final k in [
        'deliveryAddressSnapshot',
        'electronicPaymentMethod',
        'walletAmountMinor',
        'amountDueMinor',
        'coupon',
        'deliveryBreakdown',
        'eta',
        'timeline',
        'customerCanCancel',
      ]) {
        json.remove(k);
      }
      (json['payment'] as Map).removeWhere((k, v) => k != 'method' && k != 'status' && k != 'amountMinor');
      final o = OrderDetails.fromJson(json);
      expect(o.deliveryAddress, isNull);
      expect(o.walletAmountMinor, 0);
      expect(o.timeline, isEmpty);
      expect(o.customerCanCancel, isFalse);
      expect(o.eta.state, 'UNAVAILABLE');
      expect(o.payment!.awaitingApproval, isFalse);
    });
  });

  group('OrderEta', () {
    test('estimated / unavailable / terminal states', () {
      expect(OrderEta.fromJson({'state': 'ESTIMATED', 'estimatedAt': '2026-09-01T12:35:00.000Z'}).isEstimated, isTrue);
      final unavailable = OrderEta.fromJson({'state': 'UNAVAILABLE', 'reason': 'PREPARATION_TIME_NOT_CONFIGURED'});
      expect(unavailable.isEstimated, isFalse);
      expect(unavailable.reason, 'PREPARATION_TIME_NOT_CONFIGURED');
      expect(OrderEta.fromJson({'state': 'COMPLETED'}).isEstimated, isFalse);
      expect(OrderEta.fromJson(null).state, 'UNAVAILABLE');
    });
  });

  group('OrderSummary / list page', () {
    test('parses the visual-card fields', () {
      final s = OrderSummary.fromJson(orderSummaryJson(
          paymentMethod: 'MANUAL_TRANSFER',
          electronicMethod: 'VODAFONE_CASH',
          awaiting: true,
          images: ['https://x/1.png']));
      expect(s.awaitingPaymentApproval, isTrue);
      expect(s.electronicPaymentMethod, 'VODAFONE_CASH');
      expect(s.itemImageUrls, ['https://x/1.png']);
      expect(s.itemCount, 3);
      expect(s.eta.isEstimated, isTrue);
    });

    test('tab wire values match what the server expects', () {
      expect(OrderListTab.values.map((t) => t.apiValue), ['active', 'completed', 'cancelled']);
    });
  });

  group('OrderTracking.fromJson', () {
    test('parses status, ETA, timeline, per-vendor progress and payment', () {
      final t = OrderTracking.fromJson(trackingJson(awaiting: true, paymentMethod: 'MANUAL_TRANSFER'));
      expect(t.status, 'PREPARING');
      expect(t.timeline.map((e) => e.status), ['PENDING', 'CONFIRMED', 'PREPARING']);
      expect(t.segments, hasLength(2));
      expect(t.segments.first.preparationEstimateMinutes, 25);
      expect(t.segments.last.expectedReadyAt, isNull);
      expect(t.awaitingPaymentApproval, isTrue);
      expect(t.paymentMethod, 'MANUAL_TRANSFER');
    });
  });
}
