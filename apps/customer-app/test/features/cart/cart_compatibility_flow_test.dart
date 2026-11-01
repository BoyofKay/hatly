import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/cart/domain/cart_compatibility.dart';
import 'package:hatly_customer/features/cart/presentation/cart_compatibility_flow.dart';

import '../../support/test_app.dart';

const _empty = Cart(id: 'c', fulfillmentType: 'DELIVERY', groups: [], subtotalMinor: 0, hasUnpricedItems: false, readyForCheckout: false);

/// A cart API whose compatibility answer is scripted; it records which way-out the customer took.
class _Api implements CartApi {
  _Api(this.verdict);
  final CartCompatibility? verdict;
  final calls = <String>[];
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<Cart> getCart() async => _empty;
  @override
  Future<CartCompatibility> checkAddItem(String productId) async {
    calls.add('check:$productId');
    if (verdict == null) throw Exception('offline');
    return verdict!;
  }

  @override
  Future<Cart> setFulfillmentType(String fulfillmentType) async {
    calls.add('fulfillment:$fulfillmentType');
    return _empty;
  }

  @override
  Future<Cart> clearCart() async {
    calls.add('clear');
    return _empty;
  }
}

/// Pumps a button that runs the flow and records its result.
Future<({_Api api, List<bool> results})> _pump(WidgetTester t, CartCompatibility? verdict, {Locale locale = const Locale('en')}) async {
  final api = _Api(verdict);
  final results = <bool>[];
  await t.pumpWidget(hatlyTestApp(
    Consumer(builder: (context, ref, _) => Center(child: ElevatedButton(key: const Key('go'), onPressed: () async => results.add(await ensureCartCompatible(context, ref, 'p1')), child: const Text('add')))),
    locale: locale,
    overrides: [cartApiProvider.overrideWithValue(api)],
  ));
  await t.pump();
  return (api: api, results: results);
}

void main() {
  testWidgets('a product that fits is added straight away — no dialog', (t) async {
    final h = await _pump(t, const CartCompatibility(compatible: true));
    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('cart-compat-dialog')), findsNothing);
    expect(h.results, [true]);
  });

  testWidgets('pickup blocks it: the dialog explains and offers "switch to delivery"; choosing it switches the cart and allows the add', (t) async {
    final h = await _pump(t, const CartCompatibility(compatible: false, code: 'PICKUP_SINGLE_VENDOR_ONLY', resolution: 'SWITCH_TO_DELIVERY'));
    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('cart-compat-dialog')), findsOneWidget);
    expect(find.text('Switch to delivery and add'), findsOneWidget);
    await t.tap(find.byKey(const Key('cart-compat-resolve')));
    await t.pumpAndSettle();
    expect(h.api.calls, ['check:p1', 'fulfillment:DELIVERY']);
    expect(h.results, [true]);
  });

  testWidgets('a mixed or full cart offers "empty the cart and add"; keeping the cart changes nothing and refuses the add', (t) async {
    final h = await _pump(t, const CartCompatibility(compatible: false, code: 'MULTI_VENDOR_DISABLED', resolution: 'START_NEW_CART'));
    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    expect(find.text('Empty the cart and add this'), findsOneWidget);
    await t.tap(find.byKey(const Key('cart-compat-keep')));
    await t.pumpAndSettle();
    expect(h.api.calls, ['check:p1']); // nothing was cleared
    expect(h.results, [false]);

    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    await t.tap(find.byKey(const Key('cart-compat-resolve')));
    await t.pumpAndSettle();
    expect(h.api.calls.contains('clear'), isTrue);
    expect(h.results.last, true);
  });

  testWidgets('an unavailable product has no way out: the dialog only says why', (t) async {
    final h = await _pump(t, const CartCompatibility(compatible: false, code: 'PRODUCT_UNAVAILABLE'));
    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('cart-compat-resolve')), findsNothing);
    await t.tap(find.byKey(const Key('cart-compat-keep')));
    await t.pumpAndSettle();
    expect(h.results, [false]);
  });

  testWidgets('when the server cannot be asked the add is still attempted (the server stays authoritative)', (t) async {
    final h = await _pump(t, null);
    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('cart-compat-dialog')), findsNothing);
    expect(h.results, [true]);
  });

  testWidgets('Arabic: the dialog reads right-to-left in Arabic', (t) async {
    await _pump(t, const CartCompatibility(compatible: false, code: 'MULTI_VENDOR_DISABLED', resolution: 'START_NEW_CART'), locale: const Locale('ar'));
    await t.tap(find.byKey(const Key('go')));
    await t.pumpAndSettle();
    expect(find.text('إفراغ السلة وإضافة المنتج'), findsOneWidget);
    expect(find.text('الإبقاء على سلتي'), findsOneWidget);
    expect(Directionality.of(t.element(find.byKey(const Key('cart-compat-dialog')))), TextDirection.rtl);
  });
}
