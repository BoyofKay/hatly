import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/checkout/data/checkout_api.dart';
import 'package:hatly_customer/features/checkout/data/checkout_controller.dart';
import 'package:hatly_customer/features/orders/data/orders_providers.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';

const _methods = [
  'INSTAPAY',
  'VODAFONE_CASH',
  'ORANGE_CASH',
  'ETISALAT_CASH',
  'WE_PAY',
];
const _needsMethod = ['PAY_AT_DELIVERY', 'MANUAL_TRANSFER'];

/// What the real backend answers (`CheckoutQuoteService.assemble`): the quote is placeable only when an electronic method is
/// chosen for an electronic payment, and `payment.selected` echoes what it understood.
Map<String, dynamic> Function(CheckoutRequest) _server(
    {List<String> enabled = _methods}) {
  return (r) {
    final electronic = _needsMethod.contains(r.paymentMethod);
    final chosen = r.electronicPaymentMethod;
    final valid = !electronic || (chosen != null && enabled.contains(chosen));
    final q = quoteJson(canPlace: valid);
    final payment = q['payment'] as Map<String, dynamic>;
    payment['selected'] = {
      'method': r.paymentMethod,
      'electronicMethod': valid ? chosen : null
    };
    (payment['options'] as Map<String, dynamic>)['electronicMethods'] = enabled;
    if (!valid) {
      q['blockers'] = [
        {
          'code': chosen == null
              ? 'ELECTRONIC_PAYMENT_METHOD_REQUIRED'
              : 'ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE',
          'message': 'x',
        }
      ];
    }
    return q;
  };
}

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  late FakeCheckoutApi checkout;
  late FakeOrdersApi orders;
  late ProviderContainer container;
  late CheckoutController controller;

  CheckoutState state() => container.read(checkoutControllerProvider);

  Future<void> start({List<String> enabled = _methods}) async {
    checkout = FakeCheckoutApi(_server(enabled: enabled));
    orders = FakeOrdersApi();
    container = ProviderContainer(overrides: [
      checkoutApiProvider.overrideWithValue(checkout),
      ordersApiProvider.overrideWithValue(orders),
      cartApiProvider.overrideWithValue(FakeCartApi()),
      isSignedInProvider.overrideWithValue(true),
    ]);
    addTearDown(container.dispose);
    container.listen(checkoutControllerProvider, (_, __) {});
    controller = container.read(checkoutControllerProvider.notifier);
    await _settle();
  }

  for (final payment in _needsMethod) {
    group(payment, () {
      test(
          'choosing the payment type alone is NOT placeable — it asks for an electronic method and the order is not sent',
          () async {
        await start();
        controller.selectPayment(payment);
        await _settle();
        expect(state().selection.electronicMethod, isNull);
        expect(state().canSubmit, isFalse);
        expect(state().quote!.canPlaceOrder, isFalse);
      });

      for (final method in _methods) {
        test(
            '$method: the choice sticks after the server answers, the request carries it, and the order is placed with the SAME pair',
            () async {
          await start();
          controller.selectPayment(payment);
          await _settle();
          controller.selectElectronicMethod(method);
          await _settle();

          expect(state().selection.paymentMethod, payment);
          expect(state().selection.electronicMethod, method,
              reason: 'the selection must survive the quote round-trip');
          expect(state().canSubmit, isTrue);
          final json = checkout.requests.last.toJson();
          expect(json['paymentMethod'], payment);
          expect(json['electronicPaymentMethod'], method);

          final outcome = await controller.placeOrder();
          expect(outcome.order, isNotNull);
          final sent = orders.created.single.toJson();
          expect(sent['paymentMethod'], payment);
          expect(sent['electronicPaymentMethod'], method);
        });
      }

      test(
          'tapping a method while the quote for the payment type is still in flight: the late older answer cannot erase it',
          () async {
        await start();
        final slow = Completer<void>();
        checkout.gate = slow; // the NEXT quote (payment type) is held back
        controller.selectPayment(payment);
        await _settle();
        controller.selectElectronicMethod('VODAFONE_CASH'); // answered at once
        await _settle();
        expect(state().selection.electronicMethod, 'VODAFONE_CASH');
        expect(state().canSubmit, isTrue);
        slow.complete(); // the stale answer (no method) arrives last
        await _settle();
        expect(state().selection.electronicMethod, 'VODAFONE_CASH');
        expect(state().quote!.canPlaceOrder, isTrue);
        expect(state().canSubmit, isTrue);
      });

      test('switching between methods always sends and keeps the latest one',
          () async {
        await start();
        controller.selectPayment(payment, electronicMethod: 'INSTAPAY');
        await _settle();
        for (final m in [
          'WE_PAY',
          'ORANGE_CASH',
          'VODAFONE_CASH',
          'INSTAPAY'
        ]) {
          controller.selectElectronicMethod(m);
          await _settle();
          expect(state().selection.electronicMethod, m);
          expect(checkout.requests.last.toJson()['electronicPaymentMethod'], m);
          expect(state().canSubmit, isTrue);
        }
      });

      test(
          'rapid taps (no waiting between them): the last tap wins and is placeable',
          () async {
        await start();
        controller.selectPayment(payment);
        controller.selectElectronicMethod('INSTAPAY');
        controller.selectElectronicMethod('WE_PAY');
        controller.selectElectronicMethod('ETISALAT_CASH');
        await _settle();
        expect(state().selection.electronicMethod, 'ETISALAT_CASH');
        expect(state().canSubmit, isTrue);
      });

      test(
          'the server stops offering the chosen method (admin switched it off): the stale choice is dropped, the customer must choose again, and nothing is submitted',
          () async {
        await start();
        controller.selectPayment(payment, electronicMethod: 'WE_PAY');
        await _settle();
        expect(state().canSubmit, isTrue);
        checkout.respond = _server(enabled: ['INSTAPAY', 'VODAFONE_CASH']);
        controller.selectElectronicMethod(
            'WE_PAY'); // asks again; answer: not offered
        await _settle();
        expect(state().selection.electronicMethod, isNull);
        expect(state().canSubmit, isFalse);
        controller.selectElectronicMethod('VODAFONE_CASH');
        await _settle();
        expect(state().canSubmit, isTrue);
      });

      test(
          'the backend refuses the order (method not available): the failure is surfaced, nothing is marked paid, the selection is kept and a retry sends the same pair',
          () async {
        await start();
        controller.selectPayment(payment, electronicMethod: 'VODAFONE_CASH');
        await _settle();
        orders.failWith = const ApiException(
            code: 'BAD_REQUEST',
            message: 'no',
            details: {'code': 'ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE'});
        final first = await controller.placeOrder();
        expect(first.order, isNull);
        expect(first.error?.businessCode,
            'ELECTRONIC_PAYMENT_METHOD_NOT_AVAILABLE');
        await _settle();
        expect(state().isSubmitting, isFalse);

        orders.failWith = null;
        final retry = await controller.placeOrder();
        expect(retry.order, isNotNull);
        expect(orders.created.map((r) => r.toJson()['electronicPaymentMethod']),
            ['VODAFONE_CASH', 'VODAFONE_CASH']);
      });
    });
  }

  test('COD never carries an electronic method, whatever was chosen before',
      () async {
    await start();
    controller.selectPayment('PAY_AT_DELIVERY', electronicMethod: 'INSTAPAY');
    await _settle();
    controller.selectPayment('COD');
    await _settle();
    expect(
        checkout.requests.last.toJson().containsKey('electronicPaymentMethod'),
        isFalse);
    expect(state().canSubmit, isTrue);
  });
}
