import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/presentation/widgets/product_grid_card.dart';

import '../../support/test_app.dart';

Product _product(
        {String id = 'p1',
        bool available = true,
        String pricingUnit = 'PIECE',
        ActiveOffer? offer}) =>
    Product(
      id: id,
      vendorBranchId: 'b1',
      categoryId: 'c',
      name: 'Banana',
      nameAr: 'موز بلدي',
      priceMinor: 2800,
      isAvailable: available,
      pricingUnit: pricingUnit,
      inventoryMode: 'OPEN',
      options: const [],
      activeOffer: offer,
    );

void main() {
  testWidgets('shows the Arabic name and the backend price; tap and "+" work',
      (tester) async {
    var taps = 0, adds = 0;
    await tester.pumpWidget(hatlyTestApp(SizedBox(
        width: 180,
        child: IntrinsicHeight(
          child: ProductGridCard(
              product: _product(),
              onTap: () => taps++,
              onQuickAdd: () => adds++),
        ))));
    expect(find.text('موز بلدي'), findsOneWidget);
    expect(find.textContaining('28'), findsOneWidget);
    await tester.tap(find.byKey(const Key('product-quick-add-p1')));
    await tester.tap(find.text('موز بلدي'));
    expect(adds, 1);
    expect(taps, 1);
  });

  testWidgets(
      'no "+" for a weighted product; an unavailable one is not tappable',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(hatlyTestApp(Column(children: [
      SizedBox(
          width: 180,
          child: IntrinsicHeight(
              child: ProductGridCard(
                  product: _product(id: 'w', pricingUnit: 'WEIGHT'),
                  onTap: () {},
                  onQuickAdd: () {}))),
      SizedBox(
          width: 180,
          child: IntrinsicHeight(
              child: ProductGridCard(
                  product: _product(id: 'off', available: false),
                  onTap: () => taps++,
                  onQuickAdd: () {}))),
    ])));
    expect(find.byKey(const Key('product-quick-add-w')), findsNothing);
    expect(find.byKey(const Key('product-quick-add-off')), findsNothing);
    await tester.tap(find.byKey(const Key('product-grid-card-off')));
    expect(taps, 0);
  });

  testWidgets('flash sale shows the special price and the struck original',
      (tester) async {
    await tester.pumpWidget(hatlyTestApp(SizedBox(
        width: 180,
        child: IntrinsicHeight(
          child: ProductGridCard(
              product: _product(
                  offer: const ActiveOffer(
                      mechanism: 'FLASH_SALE', specialPriceMinor: 2000)),
              onTap: () {}),
        ))));
    expect(find.textContaining('20'), findsWidgets);
    expect(find.textContaining('28'), findsOneWidget);
  });

  testWidgets(
      'TwoColumnRows: two per row, RTL first item on the right, no overflow at 2x',
      (tester) async {
    tester.view.physicalSize = const Size(320, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(hatlyTestApp(
        SingleChildScrollView(
          child: TwoColumnRows(children: [
            for (var i = 0; i < 3; i++)
              ProductGridCard(product: _product(id: 'p$i'), onTap: () {}),
          ]),
        ),
        textScale: 2.0));
    final a = tester.getRect(find.byKey(const Key('product-grid-card-p0')));
    final b = tester.getRect(find.byKey(const Key('product-grid-card-p1')));
    final c = tester.getRect(find.byKey(const Key('product-grid-card-p2')));
    expect(a.top, b.top);
    expect(a.left, greaterThan(b.left));
    expect(c.top, greaterThan(a.bottom));
    expect(tester.takeException(), isNull);
  });
}
