import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/checkout/data/checkout_controller.dart';
import 'package:hatly_customer/features/checkout/domain/checkout_quote.dart';
import 'package:hatly_customer/features/checkout/presentation/checkout_error_messages.dart';
import 'package:hatly_customer/features/checkout/presentation/widgets/checkout_address_section.dart';
import 'package:hatly_customer/features/checkout/presentation/widgets/checkout_delivery_section.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';
import 'package:hatly_customer/features/orders/domain/order_details.dart';
import 'package:hatly_customer/features/orders/presentation/order_details_screen.dart';
import 'package:hatly_customer/features/ratings/data/rating_api.dart';
import 'package:hatly_customer/features/ratings/data/rating_providers.dart';
import 'package:hatly_customer/features/support/data/support_contact_api.dart';
import 'package:hatly_customer/features/support/data/support_providers.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';
import '../../support/order_fixtures.dart';
import '../../support/orders_fakes.dart';
import '../../support/router_test_app.dart';
import '../../support/test_app.dart';

/// PD-009 — Delivery Zones in checkout and order details. The app displays the server's zone, fee and pricing source; it never
/// computes a fee, never keeps a stale one, and never requires a map pin when a zone is set.
const _zone = {
  'id': 'zone-1',
  'name': 'Abu Naseeb',
  'nameAr': 'أبو نصيب',
  'city': 'Belbeis',
  'cityAr': 'بلبيس',
  'governorate': 'Sharqia',
  'governorateAr': 'الشرقية',
};

const _pinLessSnapshot = {
  'label': 'المنزل',
  'line1': 'شارع أبو نصيب جنب جامع الكردي، منزل 15',
  'deliveryZoneId': 'zone-1',
  'deliveryZone': _zone,
  'governorate': 'الشرقية',
  'city': 'بلبيس',
  'floor': '2',
};

Map<String, dynamic> _zoneQuote(
    {int fee = 1800,
    String addressId = 'addr-z',
    Map<String, dynamic>? zone = _zone}) {
  final q = quoteJson(fee: fee);
  q['address'] = {
    'addressId': addressId,
    'source': 'REQUEST',
    'snapshot': {..._pinLessSnapshot, 'deliveryZone': zone}
  };
  q['eligibility'] = {
    'serviceable': true,
    'serviceAreaId': 'area-1',
    'pricingSource': 'DELIVERY_ZONE',
    'vendors': <dynamic>[]
  };
  q['delivery'] = {
    ...(q['delivery'] as Map<String, dynamic>),
    'pricingSource': 'DELIVERY_ZONE',
    'deliveryZone': zone,
    'distanceMeters': null,
    'vendors': [
      {'vendorBranchId': 'b1', 'name': 'V', 'distanceToCustomerMeters': null},
    ],
  };
  return q;
}

Map<String, dynamic> _blockedQuote(String code) {
  final q = quoteJson(fee: null, canPlace: false);
  q['address'] = {
    'addressId': 'addr-old',
    'source': 'REQUEST',
    'snapshot': {
      'line1': 'شارع قديم',
      'city': 'بلبيس',
      'governorate': 'الشرقية'
    }
  };
  q['eligibility'] = {
    'serviceable': false,
    'code': code,
    'serviceAreaId': null,
    'pricingSource': null,
    'vendors': <dynamic>[]
  };
  q['blockers'] = [
    {'code': code, 'message': code},
  ];
  return q;
}

void main() {
  group('quote model', () {
    test(
        'a zone-priced quote parses: no pin, the frozen zone, DELIVERY_ZONE source, no distance',
        () {
      final q = CheckoutQuote.fromJson(_zoneQuote());
      final snap = q.address!.snapshot!;
      expect(snap.latitude, isNull);
      expect(snap.deliveryZone!.nameAr, 'أبو نصيب');
      expect(snap.detailLinesFor(true).first, 'بلبيس — أبو نصيب');
      expect(snap.detailLinesFor(false).first, 'Belbeis — Abu Naseeb');
      expect(q.eligibility!.pricingSource, 'DELIVERY_ZONE');
      expect(q.delivery!.pricedByZone, isTrue);
      expect(q.delivery!.distanceMeters, isNull);
      expect(q.delivery!.vendors.single.distanceToCustomerMeters, isNull);
    });

    test('a pinned, pre-zones snapshot still parses exactly as before', () {
      final q = CheckoutQuote.fromJson(quoteJson());
      expect(q.address!.snapshot!.latitude, 30.4);
      expect(q.address!.snapshot!.deliveryZone, isNull);
      expect(q.address!.snapshot!.detailLinesFor(true),
          q.address!.snapshot!.detailLines);
    });

    test(
        'Hatly Service fee parts (zone fee, multiplier) are read from the server, multiplier shown without noise',
        () {
      final json = quoteJson(fee: 2700);
      json['delivery'] = {
        ...(json['delivery'] as Map<String, dynamic>),
        'hatlyService': {'zoneDeliveryFeeMinor': 1800, 'multiplier': 1.5}
      };
      final hs = CheckoutQuote.fromJson(json).delivery!.hatlyService!;
      expect(hs.baseFeeMinor, 1800, reason: 'an older server sends only the zone fee: that was the base fee');
      expect(hs.multiplierText, '1.5');
      expect(
          const QuoteHatlyServiceFee(baseFeeMinor: 1, multiplier: 2)
              .multiplierText,
          '2');
      expect(
          const QuoteHatlyServiceFee(baseFeeMinor: 1, multiplier: 1.25)
              .multiplierText,
          '1.25');
    });

    test('a GPS Hatly / Wasally fee carries the road-distance BASE fee, the method and the distance — and no zone fee', () {
      final json = quoteJson(fee: 3000);
      json['delivery'] = {
        ...(json['delivery'] as Map<String, dynamic>),
        'hatlyService': {'baseFeeMinor': 2000, 'zoneDeliveryFeeMinor': null, 'multiplier': 1.5, 'pricingSource': 'DISTANCE', 'distanceMeters': 1800}
      };
      final hs = CheckoutQuote.fromJson(json).delivery!.hatlyService!;
      expect(hs.baseFeeMinor, 2000);
      expect(hs.pricingSource, 'DISTANCE');
      expect(hs.distanceMeters, 1800);
      expect(hs.multiplierText, '1.5');
    });
  });

  group('re-quoting when the address / zone changes', () {
    late FakeCheckoutApi api;
    late ProviderContainer container;

    setUp(() {
      api = FakeCheckoutApi((r) => r.addressId == 'addr-2'
          ? _zoneQuote(fee: 2600, addressId: 'addr-2')
          : _zoneQuote());
      container = ProviderContainer(overrides: [
        checkoutApiProvider.overrideWithValue(api),
        ordersApiProvider.overrideWithValue(FakeOrdersApi()),
        cartApiProvider.overrideWithValue(FakeCartApi()),
      ]);
      addTearDown(container.dispose);
      container.listen(checkoutControllerProvider, (_, __) {});
    });

    Future<void> settle() =>
        Future<void>.delayed(const Duration(milliseconds: 20));

    test(
        'choosing another address (another zone) asks the server again and shows ITS fee',
        () async {
      await settle();
      expect(
          container
              .read(checkoutControllerProvider)
              .quote!
              .summary!
              .deliveryFeeMinor,
          1800);
      container
          .read(checkoutControllerProvider.notifier)
          .selectAddress('addr-2');
      await settle();
      expect(api.requests.last.toJson()['addressId'], 'addr-2');
      expect(
          container
              .read(checkoutControllerProvider)
              .quote!
              .summary!
              .deliveryFeeMinor,
          2600);
    });

    test(
        're-selecting the SAME address after editing its zone still re-quotes (no cached fee)',
        () async {
      await settle();
      final before = api.requests.length;
      container
          .read(checkoutControllerProvider.notifier)
          .selectAddress('addr-z');
      await settle();
      expect(api.requests.length, before + 1);
    });

    test(
        'if the re-quote for a CHANGED choice fails, the old quote (fee + token) is dropped — never submitted',
        () async {
      await settle();
      expect(container.read(checkoutControllerProvider).canSubmit, isTrue);
      api.failWith =
          const ApiException(code: 'NETWORK_ERROR', message: 'offline');
      container
          .read(checkoutControllerProvider.notifier)
          .selectAddress('addr-2');
      await settle();
      final state = container.read(checkoutControllerProvider);
      expect(state.quote, isNull);
      expect(state.canSubmit, isFalse);
      expect(state.quoteError?.code, 'NETWORK_ERROR');
    });
  });

  group('checkout sections', () {
    testWidgets(
        'the address card shows the zone first ("بلبيس — أبو نصيب") and needs no map pin',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(SingleChildScrollView(
        child: CheckoutAddressSection(
            quote: CheckoutQuote.fromJson(_zoneQuote()), onPickAddress: () {}),
      )));
      await tester.pumpAndSettle();
      expect(find.text('بلبيس — أبو نصيب'), findsOneWidget);
      expect(
          find.text('شارع أبو نصيب جنب جامع الكردي، منزل 15'), findsOneWidget);
      expect(find.byKey(const Key('checkout-address-error')), findsNothing);
    });

    for (final (code, text) in [
      (
        'ADDRESS_ZONE_REQUIRED',
        'اختار منطقة التوصيل للعنوان ده عشان نقدر نوصّلك.'
      ),
      (
        'DELIVERY_ZONE_UNAVAILABLE',
        'هاتلي مش بيوصّل للمنطقة دي دلوقتي. اختار منطقة أو عنوان تاني.'
      ),
    ]) {
      testWidgets('$code is explained right on the address card',
          (tester) async {
        await tester.pumpWidget(hatlyTestApp(SingleChildScrollView(
          child: CheckoutAddressSection(
              quote: CheckoutQuote.fromJson(_blockedQuote(code)),
              onPickAddress: () {}),
        )));
        await tester.pumpAndSettle();
        expect(
            tester
                .widget<Text>(find.byKey(const Key('checkout-address-error')))
                .data,
            text);
      });
    }

    testWidgets(
        'the delivery breakdown names the zone and shows no distance for a zone price',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(SingleChildScrollView(
          child: CheckoutDeliverySection(
              quote: CheckoutQuote.fromJson(_zoneQuote())))));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('checkout-delivery-breakdown')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('checkout-delivery-zone')), findsOneWidget);
      expect(find.textContaining('أبو نصيب'), findsOneWidget);
      expect(find.textContaining('كم'), findsNothing,
          reason: 'no distance line');
    });

    // PD-009 amended: Hatly Service is priced by the selected area — identical with or without a map pin.
    Map<String, dynamic> hatlyQuote(
        {required bool withPin, int zoneFee = 1500, double multiplier = 1.5}) {
      final json = _zoneQuote(fee: (zoneFee * multiplier).round());
      json['hasPendingPricing'] = true;
      if (withPin) {
        final address = json['address'] as Map<String, dynamic>;
        address['snapshot'] = {
          ...(address['snapshot'] as Map<String, dynamic>),
          'latitude': 30.42,
          'longitude': 31.56
        };
      }
      json['delivery'] = {
        ...(json['delivery'] as Map<String, dynamic>),
        'baseFeeMinor': null,
        'pricingSource': 'DELIVERY_ZONE',
        'hatlyService': {
          'zoneDeliveryFeeMinor': zoneFee,
          'multiplier': multiplier
        },
      };
      return json;
    }

    for (final withPin in [false, true]) {
      testWidgets(
          'Hatly Service ${withPin ? 'WITH' : 'without'} a pin: the FINAL fee (22.50) is shown — never the "15 × 1.5" calculation —, area named, no distance, no pin error',
          (tester) async {
        await tester.pumpWidget(hatlyTestApp(SingleChildScrollView(
          child: Column(children: [
            CheckoutAddressSection(
                quote: CheckoutQuote.fromJson(hatlyQuote(withPin: withPin)),
                onPickAddress: () {}),
            CheckoutDeliverySection(
                quote: CheckoutQuote.fromJson(hatlyQuote(withPin: withPin))),
          ]),
        )));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('checkout-address-error')), findsNothing);
        expect(find.textContaining('22.50'), findsWidgets,
            reason: 'the server\'s final fee');
        await tester.tap(find.byKey(const Key('checkout-delivery-breakdown')));
        await tester.pumpAndSettle();
        // the formula (zone fee × multiplier) is business logic: it is not displayed anywhere
        expect(
            find.byKey(const Key('checkout-hatly-service-fee')), findsNothing);
        expect(find.textContaining('×'), findsNothing);
        expect(find.textContaining('رسوم توصيل منطقتك'), findsNothing);
        expect(find.text('15 ج.م'), findsNothing,
            reason: 'the zone fee operand is not shown');
        expect(find.byKey(const Key('checkout-delivery-zone')), findsOneWidget);
        expect(find.textContaining('كم'), findsNothing,
            reason: 'no distance for a zone price');
      });
    }

    testWidgets(
        'Hatly Service in English: the final 37.50 fee is shown, not "25 EGP × 1.5"',
        (tester) async {
      await tester.pumpWidget(hatlyTestApp(
        SingleChildScrollView(
            child: CheckoutDeliverySection(
                quote: CheckoutQuote.fromJson(
                    hatlyQuote(withPin: false, zoneFee: 2500)))),
        locale: const Locale('en'),
      ));
      await tester.pumpAndSettle();
      expect(find.textContaining('37.50'), findsWidgets);
      await tester.tap(find.byKey(const Key('checkout-delivery-breakdown')));
      await tester.pumpAndSettle();
      expect(find.textContaining("Your area's delivery fee"), findsNothing);
      expect(find.textContaining('×'), findsNothing);
      expect(find.textContaining('25 EGP'), findsNothing,
          reason: 'the zone fee operand is not shown');
      expect(find.textContaining('37.50'), findsWidgets);
    });

    testWidgets(
        'localized error / blocker texts exist for both zone codes, in Arabic and English',
        (tester) async {
      late BuildContext ar;
      late BuildContext en;
      await tester.pumpWidget(
          hatlyTestApp(Builder(builder: (c) => (ar = c, const SizedBox()).$2)));
      for (final code in [
        'ADDRESS_ZONE_REQUIRED',
        'DELIVERY_ZONE_UNAVAILABLE'
      ]) {
        final e = ApiException(
            code: 'BAD_REQUEST',
            message: 'x',
            details: {'code': code},
            statusCode: 400);
        expect(
            localizedCheckoutErrorMessage(ar, e), isNot(contains('حدث خطأ')));
        expect(localizedCheckoutErrorMessage(ar, e), contains('منطقة'));
      }
      await tester.pumpWidget(hatlyTestApp(
          Builder(builder: (c) => (en = c, const SizedBox()).$2),
          locale: const Locale('en')));
      const e = ApiException(
          code: 'BAD_REQUEST',
          message: 'x',
          details: {'code': 'DELIVERY_ZONE_UNAVAILABLE'},
          statusCode: 400);
      expect(localizedCheckoutErrorMessage(en, e),
          "Hatly doesn't deliver to this area right now. Choose another area or address.");
    });
  });

  group('order details (frozen snapshot)', () {
    Map<String, dynamic> zoneOrder() {
      final json = orderDetailsJson();
      json['deliveryAddressSnapshot'] = _pinLessSnapshot;
      json['deliveryBreakdown'] = {
        'baseFeeMinor': 1800,
        'additionalVendorFeeMinor': 500,
        'additionalVendorChargeMinor': 0,
        'vendorCount': 1,
        'pricingSource': 'DELIVERY_ZONE',
        'distanceMeters': null,
        'frozenTotalFeeMinor': 1800,
        'vendors': [
          {'vendorBranchId': 'b1', 'distanceToCustomerMeters': null},
        ],
      };
      return json;
    }

    test('a pin-less, zone-priced order parses (no crash on a null distance)',
        () {
      final d = OrderDetails.fromJson(zoneOrder());
      expect(d.deliveryBreakdown!.distanceMeters, isNull);
      expect(d.deliveryBreakdown!.pricingSource, 'DELIVERY_ZONE');
      expect(d.deliveryAddress!.deliveryZone!.nameAr, 'أبو نصيب');
    });

    testWidgets(
        'a pin-less Hatly Service order shows its FROZEN fee and area — nothing is recalculated on screen',
        (tester) async {
      final json = zoneOrder();
      // A Hatly Service order exposes no registered-vendor breakdown; its frozen delivery fee is the order's own field.
      json['deliveryBreakdown'] = null;
      json['deliveryFeeMinor'] = 2250;
      json['totalMinor'] = null;
      json['amountDueMinor'] = null;
      tester.view.physicalSize = const Size(390 * 3, 4000 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyRouterApp(
        overrides: [
          ordersApiProvider.overrideWithValue(FakeOrdersReadApi(details: json)),
          orderRatingStateProvider.overrideWith(
              (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
          supportContactProvider.overrideWith((ref) async =>
              const SupportContact(whatsappNumber: '+201000000000')),
        ],
        routes: [
          GoRoute(
              path: '/',
              builder: (c, s) => const OrderDetailsScreen(orderId: orderId))
        ],
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.textContaining('22.50'), findsWidgets);
      expect(find.text('بلبيس — أبو نصيب'), findsOneWidget);
      expect(find.byKey(const Key('order-delivery-breakdown')), findsNothing);
    });

    testWidgets(
        'the address card shows "بلبيس — أبو نصيب" then the written address, never an id',
        (tester) async {
      tester.view.physicalSize = const Size(390 * 3, 4000 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(hatlyRouterApp(
        overrides: [
          ordersApiProvider
              .overrideWithValue(FakeOrdersReadApi(details: zoneOrder())),
          orderRatingStateProvider.overrideWith(
              (ref, id) => Future<OrderRatingState>.error(Exception('none'))),
          supportContactProvider.overrideWith((ref) async =>
              const SupportContact(whatsappNumber: '+201000000000')),
        ],
        routes: [
          GoRoute(
              path: '/',
              builder: (c, s) => const OrderDetailsScreen(orderId: orderId))
        ],
      ));
      await tester.pumpAndSettle();
      final card = find.byKey(const Key('order-address'));
      expect(find.descendant(of: card, matching: find.text('بلبيس — أبو نصيب')),
          findsOneWidget);
      expect(
          find.descendant(
              of: card,
              matching: find.text('شارع أبو نصيب جنب جامع الكردي، منزل 15')),
          findsOneWidget);
      expect(find.descendant(of: card, matching: find.textContaining('zone-1')),
          findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}
