import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/checkout/data/checkout_controller.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';

ProviderContainer _container(
    FakeCheckoutApi checkout, FakeOrdersApi orders, FakeCartApi cartApi) {
  final container = ProviderContainer(overrides: [
    checkoutApiProvider.overrideWithValue(checkout),
    ordersApiProvider.overrideWithValue(orders),
    cartApiProvider.overrideWithValue(cartApi),
  ]);
  addTearDown(container.dispose);
  return container;
}

Future<CheckoutController> _ready(ProviderContainer container) async {
  // Keep the auto-disposed provider alive for the whole test.
  container.listen(checkoutControllerProvider, (_, __) {});
  final controller = container.read(checkoutControllerProvider.notifier);
  await _settle();
  return controller;
}

Future<void> _settle() => Future<void>.delayed(const Duration(milliseconds: 20));

CheckoutState _state(ProviderContainer c) => c.read(checkoutControllerProvider);

void main() {
  late FakeCheckoutApi checkout;
  late FakeOrdersApi orders;
  late FakeCartApi cartApi;
  late ProviderContainer container;

  setUp(() {
    checkout = FakeCheckoutApi();
    orders = FakeOrdersApi();
    cartApi = FakeCartApi();
    container = _container(checkout, orders, cartApi);
  });

  group('loading the quote', () {
    test('asks the server for the quote on entry, with COD and no address (server default)', () async {
      await _ready(container);
      expect(checkout.requests, hasLength(1));
      final json = checkout.requests.single.toJson();
      expect(json['paymentMethod'], 'COD');
      expect(json.containsKey('addressId'), isFalse,
          reason: 'no explicit address: the server preselects the default');
      expect(_state(container).quote!.summary!.totalMinor, 11500);
      expect(_state(container).isQuoting, isFalse);
      expect(_state(container).canSubmit, isTrue);
    });

    test('a failing quote surfaces the error and blocks submission', () async {
      checkout.failWith =
          const ApiException(code: 'NETWORK_ERROR', message: 'offline');
      await _ready(container);
      expect(_state(container).quote, isNull);
      expect(_state(container).quoteError?.code, 'NETWORK_ERROR');
      expect(_state(container).canSubmit, isFalse);
    });

    test('the LATEST response wins when an older request finishes late', () async {
      final slow = Completer<void>();
      checkout.gate = slow; // the first quote is held back
      final controller = container.read(checkoutControllerProvider.notifier);
      container.listen(checkoutControllerProvider, (_, __) {});
      await _settle();
      checkout.respond = (r) => quoteJson(fee: r.addressId == 'new' ? 2500 : 1500);
      controller.selectAddress('new'); // second request, answered immediately
      await _settle();
      expect(_state(container).quote!.summary!.deliveryFeeMinor, 2500);
      slow.complete(); // the first (stale) response arrives late
      await _settle();
      expect(_state(container).quote!.summary!.deliveryFeeMinor, 2500,
          reason: 'a late, older answer must not overwrite the newer quote');
    });
  });

  group('payment choices', () {
    test('Pay-at-delivery with an electronic method sends both; COD sends neither electronic', () async {
      final controller = await _ready(container);
      controller.selectPayment('PAY_AT_DELIVERY', electronicMethod: 'VODAFONE_CASH');
      await _settle();
      var json = checkout.requests.last.toJson();
      expect(json['paymentMethod'], 'PAY_AT_DELIVERY');
      expect(json['electronicPaymentMethod'], 'VODAFONE_CASH');

      controller.selectPayment('COD', electronicMethod: 'VODAFONE_CASH');
      await _settle();
      json = checkout.requests.last.toJson();
      expect(json['paymentMethod'], 'COD');
      expect(json.containsKey('electronicPaymentMethod'), isFalse,
          reason: 'an electronic method only applies to Pay-at-delivery and Manual Transfer');
    });

    test('a method that needs an electronic method cannot be submitted until one is chosen', () async {
      final controller = await _ready(container);
      controller.selectPayment('MANUAL_TRANSFER');
      await _settle();
      expect(_state(container).canSubmit, isFalse);
      controller.selectElectronicMethod('INSTAPAY');
      await _settle();
      expect(_state(container).canSubmit, isTrue);
    });

    test('PD-001 (amended): the wallet stays ON when Manual Transfer is chosen — both are sent, the server splits the amount', () async {
      final controller = await _ready(container);
      controller.setUseWallet(true);
      await _settle();
      expect(checkout.requests.last.toJson()['useWallet'], isTrue);
      controller.selectPayment('MANUAL_TRANSFER', electronicMethod: 'INSTAPAY');
      await _settle();
      expect(_state(container).selection.useWallet, isTrue);
      final json = checkout.requests.last.toJson();
      expect(json['paymentMethod'], 'MANUAL_TRANSFER');
      expect(json['electronicPaymentMethod'], 'INSTAPAY');
      expect(json['useWallet'], isTrue);
      expect(_state(container).canSubmit, isTrue);
    });

    test('wallet + Manual Transfer is placed with BOTH choices (and never an amount): the order request carries useWallet and the transfer method', () async {
      final controller = await _ready(container);
      controller.setUseWallet(true);
      controller.setWalletAmount(3000);
      controller.selectPayment('MANUAL_TRANSFER', electronicMethod: 'ORANGE_CASH');
      await _settle();
      await controller.placeOrder();
      final sent = orders.created.single.toJson(includeToken: true);
      expect(sent, containsPair('paymentMethod', 'MANUAL_TRANSFER'));
      expect(sent, containsPair('electronicPaymentMethod', 'ORANGE_CASH'));
      expect(sent, containsPair('useWallet', true));
      expect(sent, containsPair('walletAmountMinor', 3000)); // only a CAP; the server decides the amount
      expect(sent.keys.where((k) => k.toLowerCase().contains('total') || k.toLowerCase().contains('due')), isEmpty);
    });

    test('a method that just became unavailable falls back to COD instead of blocking the order', () async {
      final controller = await _ready(container);
      checkout.respond = (r) {
        final q = quoteJson();
        (q['payment'] as Map)['options'] = {
          'cod': true,
          'payAtDelivery': true,
          'manualTransfer': {'available': false, 'reason': 'WEIGHED_ITEMS'},
          'electronicMethods': ['INSTAPAY'],
        };
        return q;
      };
      controller.selectPayment('MANUAL_TRANSFER', electronicMethod: 'INSTAPAY');
      await _settle();
      expect(_state(container).selection.paymentMethod, 'COD');
      expect(checkout.requests.last.toJson()['paymentMethod'], 'COD');
    });

    test('an electronic method the server stopped offering is dropped from the selection', () async {
      final controller = await _ready(container);
      controller.selectPayment('PAY_AT_DELIVERY', electronicMethod: 'WE_PAY');
      await _settle();
      checkout.respond = (r) {
        final q = quoteJson();
        ((q['payment'] as Map)['options'] as Map)['electronicMethods'] = ['INSTAPAY'];
        return q;
      };
      controller.selectElectronicMethod('INSTAPAY');
      controller.selectPayment('PAY_AT_DELIVERY', electronicMethod: 'WE_PAY');
      await _settle();
      expect(_state(container).selection.electronicMethod, isNull);
    });
  });

  group('wallet', () {
    test('the wallet is switched off when the server says it is unavailable for this cart', () async {
      final controller = await _ready(container);
      checkout.respond = (r) {
        final q = quoteJson();
        ((q['payment'] as Map)['wallet'] as Map)['available'] = false;
        return q;
      };
      controller.setUseWallet(true);
      await _settle();
      expect(_state(container).selection.useWallet, isFalse);
    });

    test('a partial wallet amount is sent as a cap, and cleared when the wallet is turned off', () async {
      final controller = await _ready(container);
      controller.setUseWallet(true);
      controller.setWalletAmount(2000);
      await _settle();
      expect(checkout.requests.last.toJson()['walletAmountMinor'], 2000);
      controller.setUseWallet(false);
      await _settle();
      expect(checkout.requests.last.toJson().containsKey('walletAmountMinor'), isFalse);
      expect(_state(container).selection.walletAmountMinor, isNull);
    });
  });

  group('coupon', () {
    test('a code is upper-cased and sent; the server verdict is shown', () async {
      final controller = await _ready(container);
      checkout.respond = (r) => quoteJson(discount: 1000, overrides: {
            'coupon': {
              'status': 'APPLIED',
              'code': r.couponCode,
              'discountMinor': 1000,
              'vendorName': 'مطعم النخيل',
            },
          });
      controller.applyCoupon(' save10 ');
      await _settle();
      expect(checkout.requests.last.toJson()['couponCode'], 'SAVE10');
      expect(_state(container).quote!.coupon.isApplied, isTrue);
      expect(_state(container).quote!.summary!.discountMinor, 1000);
    });

    test('a refused code is dropped, the reason kept, and the quote re-asked WITHOUT it', () async {
      final controller = await _ready(container);
      checkout.respond = (r) => r.couponCode == null
          ? quoteJson()
          : quoteJson(overrides: {
              'coupon': {
                'status': 'REJECTED',
                'code': r.couponCode,
                'reasonCode': 'COUPON_EXPIRED',
                'message': 'expired',
              },
            });
      controller.applyCoupon('OLD');
      await _settle();
      expect(_state(container).selection.couponCode, isNull);
      expect(_state(container).couponRejection?.reasonCode, 'COUPON_EXPIRED');
      expect(checkout.requests.last.toJson().containsKey('couponCode'), isFalse,
          reason: 'the token must match what will be submitted: no coupon');
      expect(_state(container).canSubmit, isTrue);
    });

    test('removing the coupon re-quotes without it', () async {
      final controller = await _ready(container);
      controller.applyCoupon('SAVE10');
      await _settle();
      controller.removeCoupon();
      await _settle();
      expect(checkout.requests.last.toJson().containsKey('couponCode'), isFalse);
    });
  });

  group('address', () {
    test('an explicit address id is sent; a deleted one falls back to the default', () async {
      final controller = await _ready(container);
      checkout.respond = (r) => r.addressId == 'gone'
          ? {
              'canPlaceOrder': false,
              'blockers': [
                {'code': 'ADDRESS_NOT_FOUND', 'message': 'Address not found.'}
              ],
              'quoteToken': null,
              'expiresAt': null,
            }
          : quoteJson();
      controller.selectAddress('gone');
      await _settle();
      expect(checkout.requests.any((r) => r.addressId == 'gone'), isTrue);
      expect(_state(container).selection.addressId, isNull);
      expect(_state(container).canSubmit, isTrue);
    });
  });

  group('fulfilment', () {
    test('switching to pickup changes the CART on the server, then re-quotes', () async {
      final controller = await _ready(container);
      final before = checkout.requests.length;
      final error = await controller.setFulfillment('PICKUP');
      await _settle();
      expect(error, isNull);
      expect(cartApi.calls, contains('fulfillment:PICKUP'));
      expect(checkout.requests.length, greaterThan(before));
    });
  });

  group('placing the order', () {
    test('sends the confirmed quote token and the chosen payment; invalidates the cart', () async {
      final controller = await _ready(container);
      controller.selectPayment('PAY_AT_DELIVERY', electronicMethod: 'INSTAPAY');
      await _settle();
      final cartCallsBefore = cartApi.calls.length;
      final outcome = await controller.placeOrder();
      expect(outcome.order?.id, 'order-1');
      final sent = orders.created.single.toJson(includeToken: true);
      expect(sent['quoteToken'], 'token-1');
      expect(sent['paymentMethod'], 'PAY_AT_DELIVERY');
      expect(sent['electronicPaymentMethod'], 'INSTAPAY');
      expect(sent.keys, isNot(contains('totalMinor')),
          reason: 'the client never sends an amount');
      await _settle();
      expect(cartApi.calls.length, greaterThan(cartCallsBefore),
          reason: 'the superseded cart is re-read');
    });

    test('when the wallet covers everything the order says WALLET and carries no electronic method', () async {
      final controller = await _ready(container);
      controller.selectPayment('PAY_AT_DELIVERY', electronicMethod: 'INSTAPAY');
      await _settle();
      checkout.respond = (r) => quoteJson(wallet: 11500, overrides: {
            'payment': {
              'selected': {'method': 'WALLET', 'electronicMethod': null},
              'awaitsPaymentApproval': false,
              'wallet': {'balanceMinor': 20000, 'appliedMinor': 11500, 'available': true},
              'options': {
                'cod': true,
                'payAtDelivery': true,
                'manualTransfer': {'available': true},
                'electronicMethods': ['INSTAPAY'],
              },
            },
          });
      controller.setUseWallet(true);
      await _settle();
      await controller.placeOrder();
      final sent = orders.created.single.toJson(includeToken: true);
      expect(sent['paymentMethod'], 'WALLET');
      expect(sent['useWallet'], isTrue);
      expect(sent.containsKey('electronicPaymentMethod'), isFalse);
    });

    test('a stale quote is refused: the CURRENT quote is shown, nothing is placed, the customer confirms again', () async {
      final controller = await _ready(container);
      orders.failWith = ApiException(
        code: 'CONFLICT',
        message: 'changed',
        statusCode: 409,
        details: {
          'code': 'QUOTE_STALE',
          'reason': 'AMOUNTS_CHANGED',
          'changes': ['deliveryFeeMinor'],
          'currentQuote': quoteJson(fee: 2500)..['quoteToken'] = 'token-2',
        },
      );
      final outcome = await controller.placeOrder();
      expect(outcome.stale, isTrue);
      expect(outcome.order, isNull);
      final state = _state(container);
      expect(state.staleNotice?.reason, 'AMOUNTS_CHANGED');
      expect(state.quote!.summary!.deliveryFeeMinor, 2500);
      expect(state.isSubmitting, isFalse);

      // The customer confirms the updated quote: it carries the NEW token.
      orders.failWith = null;
      final again = await controller.placeOrder();
      expect(again.order, isNotNull);
      expect(orders.created.last.toJson(includeToken: true)['quoteToken'], 'token-2');
    });

    test('another business failure is returned, the quote is refreshed, submission re-enabled', () async {
      final controller = await _ready(container);
      orders.failWith = const ApiException(
          code: 'CONFLICT',
          message: 'stock',
          details: {'code': 'INSUFFICIENT_INVENTORY'});
      final before = checkout.requests.length;
      final outcome = await controller.placeOrder();
      expect(outcome.error?.businessCode, 'INSUFFICIENT_INVENTORY');
      await _settle();
      expect(checkout.requests.length, greaterThan(before));
      expect(_state(container).isSubmitting, isFalse);
    });

    test('a double tap cannot place two orders', () async {
      final controller = await _ready(container);
      orders.gate = Completer<void>();
      final first = controller.placeOrder();
      final second = await controller.placeOrder();
      expect(second.error?.code, 'BUSY');
      orders.gate!.complete();
      await first;
      expect(orders.created, hasLength(1));
    });

    test(
        'Reliability & Adversarial Testing milestone (client-level): a late order-creation response arriving '
        'AFTER the customer already navigated away from Checkout (the controller\'s last listener is gone, '
        'making it eligible for autoDispose) never throws an unhandled exception', () async {
      final sub = container.listen(checkoutControllerProvider, (_, __) {});
      final controller = container.read(checkoutControllerProvider.notifier);
      await _settle();

      orders.gate = Completer<void>();
      final future = controller.placeOrder();
      await _settle();
      expect(_state(container).isSubmitting, isTrue);

      // The customer navigates away — Checkout's only listener goes away, so the autoDispose
      // controller is torn down while the order-creation request is still in flight.
      sub.close();
      await _settle();

      // The request the customer already sent completes AFTER disposal — it is not, and must not be,
      // cancelled by navigation (the order may have genuinely been created; the app must never crash
      // trying to report that back to a screen that's already gone).
      orders.gate!.complete();
      await expectLater(future, completes);
      final outcome = await future;
      expect(outcome.order, isNotNull); // the order WAS created — never silently lost
    });
  });
}
