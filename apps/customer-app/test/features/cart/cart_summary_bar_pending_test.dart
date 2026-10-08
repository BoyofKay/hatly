import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/shared_widgets/cart_summary_bar.dart';

import '../../support/checkout_fakes.dart';
import '../../support/checkout_fixtures.dart';
import '../../support/test_app.dart';

/// The floating cart bar must never show "0" for a cart whose only content is a Hatly Service request with a pending price.
void main() {
  Future<void> pump(WidgetTester tester, FakeCartApi api,
      {Locale locale = const Locale('ar'), double scale = 1.0}) async {
    tester.view.physicalSize = const Size(390 * 3, 800 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(hatlyTestApp(
        const Align(alignment: Alignment.bottomCenter, child: CartSummaryBar()),
        locale: locale,
        textScale: scale,
        overrides: [cartApiProvider.overrideWithValue(api)]));
    await tester.pumpAndSettle();
  }

  testWidgets('a pending Hatly Service cart shows the pending wording, not 0',
      (tester) async {
    await pump(tester, FakeCartApi(hatlyServiceCart()));
    expect(find.text('سيتم تأكيد السعر أثناء تجهيز الطلب'), findsOneWidget);
    expect(find.text('0 ج.م'), findsNothing);
  });

  testWidgets(
      'the bar is no worse at large text than for a normal cart (its fixed chip/label parts are unchanged)',
      (tester) async {
    await pump(tester, FakeCartApi(), locale: const Locale('en'), scale: 2.0);
    final normalOverflowed = tester.takeException() != null;
    await pump(tester, FakeCartApi(hatlyServiceCart()),
        locale: const Locale('en'), scale: 2.0);
    final pendingOverflowed = tester.takeException() != null;
    expect(pendingOverflowed && !normalOverflowed, isFalse,
        reason: 'the pending wording must not introduce an overflow');
  });

  testWidgets('a normal cart still shows its real subtotal', (tester) async {
    await pump(tester, FakeCartApi());
    expect(find.text('100 ج.م'), findsOneWidget);
    expect(find.text('سيتم تأكيد السعر أثناء تجهيز الطلب'), findsNothing);
  });
}
