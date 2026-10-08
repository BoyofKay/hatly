import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/presentation/cart_screen.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';
import '../../support/router_test_app.dart';

/// A Hatly Service request sits in the cart with an explicit pending price: the customer reads when it will be confirmed, and no
/// "0" is shown for it. A vendor's normal items are unchanged.
void main() {
  Future<void> pump(WidgetTester tester, FakeCartApi api,
      {Locale locale = const Locale('ar')}) async {
    tester.view.physicalSize = const Size(390 * 3, 1600 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(hatlyRouterApp(
      locale: locale,
      overrides: [cartApiProvider.overrideWithValue(api)],
      routes: [
        GoRoute(path: '/', builder: (c, s) => const CartScreen()),
        probeRoute('/checkout'),
        probeRoute('/hatly-service'),
      ],
    ));
    await tester.pumpAndSettle();
  }

  testWidgets(
      'the Hatly Service line says the price will be confirmed while the order is prepared — not 0',
      (tester) async {
    await pump(tester, FakeCartApi(hatlyServiceCart()));
    expect(find.text('بنادول إكسترا ٥٠٠ ملجم، علبتين'), findsOneWidget);
    expect(find.byKey(const Key('cart-item-price-pending')), findsOneWidget);
    expect(find.text('سيتم تأكيد السعر أثناء تجهيز الطلب'), findsOneWidget);
    expect(find.text('0 ج.م'), findsNothing);
  });

  testWidgets('English wording', (tester) async {
    await pump(tester, FakeCartApi(hatlyServiceCart()),
        locale: const Locale('en'));
    expect(
        find.text(
            'The price will be confirmed while your order is being prepared'),
        findsOneWidget);
  });

  testWidgets('a normal vendor cart is unchanged: real prices, no pending text',
      (tester) async {
    await pump(tester, FakeCartApi());
    expect(find.byKey(const Key('cart-item-price-pending')), findsNothing);
    expect(find.text('سيتم تأكيد السعر أثناء تجهيز الطلب'), findsNothing);
    expect(find.text('100 ج.م'), findsWidgets);
  });

  testWidgets(
      '"Continue to checkout" is enabled for a pending Hatly Service request, with no "not ready" warning (the server now reports it ready)',
      (tester) async {
    await pump(tester, FakeCartApi(hatlyServiceCart()));
    expect(
        find.text(
            'الدفع غير جاهز بعد. يرجى إكمال العناصر المعلقة قبل تقديم الطلب.'),
        findsNothing);
    final cta = find.text('متابعة لإتمام الطلب');
    expect(cta, findsOneWidget);
    await tester.tap(cta);
    await tester.pumpAndSettle();
    expect(find.text('page /checkout'), findsOneWidget);
  });

  testWidgets(
      'a cart the server reports NOT ready still shows the warning and a disabled button (the app does not override the server)',
      (tester) async {
    await pump(tester, FakeCartApi(hatlyServiceCart(ready: false)));
    expect(
        find.text(
            'الدفع غير جاهز بعد. يرجى إكمال العناصر المعلقة قبل تقديم الطلب.'),
        findsOneWidget);
    await tester.tap(find.text('متابعة لإتمام الطلب'), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(find.text('page /checkout'), findsNothing,
        reason: 'disabled: the tap goes nowhere');
  });
}
