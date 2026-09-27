import 'dart:async';

import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/checkout/data/checkout_api.dart';
import 'package:hatly_customer/features/checkout/domain/checkout_quote.dart';
import 'package:hatly_customer/features/orders/data/orders_api.dart';

import 'checkout_fixtures.dart' as fx;

/// Answers `POST /checkout/quote` from a queue of programmable responses and records every request it receives.
class FakeCheckoutApi implements CheckoutApi {
  FakeCheckoutApi(
      [Map<String, dynamic> Function(CheckoutRequest request)? respond])
      : _respond = respond ?? ((_) => fx.quoteJson());

  Map<String, dynamic> Function(CheckoutRequest request) _respond;
  final requests = <CheckoutRequest>[];

  /// When set, the next call waits for it (to model a slow response).
  Completer<void>? gate;
  ApiException? failWith;

  set respond(Map<String, dynamic> Function(CheckoutRequest request) fn) =>
      _respond = fn;

  @override
  Future<CheckoutQuote> quote(CheckoutRequest request) async {
    requests.add(request);
    final g = gate;
    if (g != null) {
      gate = null;
      await g.future;
    }
    if (failWith != null) throw failWith!;
    return CheckoutQuote.fromJson(_respond(request));
  }
}

class FakeOrdersApi implements OrdersApi {
  final created = <CheckoutRequest>[];
  ApiException? failWith;
  Completer<void>? gate;
  String orderId = 'order-1';

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<CreatedOrderResult> createOrder(CheckoutRequest request) async {
    created.add(request);
    if (gate != null) await gate!.future;
    if (failWith != null) throw failWith!;
    return CreatedOrderResult(
        id: orderId, orderNumber: 'HT-100001', totalMinor: 11500, paymentMethod: request.paymentMethod ?? 'COD');
  }
}

class FakeCartApi implements CartApi {
  FakeCartApi([Cart? cart]) : cart = cart ?? _defaultCart();

  Cart cart;
  final calls = <String>[];

  static Cart _defaultCart() => fx.cart();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Cart> getCart() async {
    calls.add('getCart');
    return cart;
  }

  @override
  Future<Cart> setFulfillmentType(String fulfillmentType) async {
    calls.add('fulfillment:$fulfillmentType');
    return cart;
  }
}
