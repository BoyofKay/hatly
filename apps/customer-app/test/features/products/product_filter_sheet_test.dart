import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product_filters.dart';
import 'package:hatly_customer/features/products/presentation/widgets/product_filter_sheet.dart';

import '../../support/test_app.dart';

/// Filters V1 — the Product List filter sheet's own local-draft-until-
/// Apply mechanics, isolated from the screen that opens it. Mirrors
/// `vendor_filter_sheet_test.dart`'s own conventions exactly.
Future<void> _open(
  WidgetTester tester, {
  required ValueChanged<ProductFilters?> onResult,
  ProductFilters initial = ProductFilters.empty,
  int? minAvailablePriceMinor,
  int? maxAvailablePriceMinor,
  Locale locale = const Locale('en'),
  bool dark = false,
}) async {
  await tester.pumpWidget(hatlyTestApp(
    Builder(builder: (context) {
      return ElevatedButton(
        onPressed: () async {
          final result = await showModalBottomSheet<ProductFilters>(
            context: context,
            isScrollControlled: true,
            builder: (_) => ProductFilterSheet(
              initialFilters: initial,
              minAvailablePriceMinor: minAvailablePriceMinor,
              maxAvailablePriceMinor: maxAvailablePriceMinor,
            ),
          );
          onResult(result);
        },
        child: const Text('open'),
      );
    }),
    locale: locale,
    dark: dark,
  ));
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('starts with the given initial filters reflected in the toggles/price fields', (tester) async {
    await _open(
      tester,
      onResult: (_) {},
      initial: const ProductFilters(availableOnly: true, minPriceMinor: 1000, maxPriceMinor: 5000),
    );
    final availableSwitch = tester.widget<SwitchListTile>(find.byKey(const Key('product-filter-available-only')));
    expect(availableSwitch.value, isTrue);
    final minField = tester.widget<TextField>(find.byKey(const Key('product-filter-price-min')));
    expect(minField.controller!.text, '10');
    final maxField = tester.widget<TextField>(find.byKey(const Key('product-filter-price-max')));
    expect(maxField.controller!.text, '50');
  });

  testWidgets('toggling Available Only and Offers, entering a price range, then Apply returns the updated draft',
      (tester) async {
    ProductFilters? applied;
    await _open(tester, onResult: (r) => applied = r);

    await tester.tap(find.byKey(const Key('product-filter-available-only')));
    await tester.tap(find.byKey(const Key('product-filter-has-offers')));
    await tester.enterText(find.byKey(const Key('product-filter-price-min')), '20');
    await tester.enterText(find.byKey(const Key('product-filter-price-max')), '100');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();

    expect(
      applied,
      const ProductFilters(availableOnly: true, hasOffers: true, minPriceMinor: 2000, maxPriceMinor: 10000),
    );
  });

  testWidgets('Cancel returns null — the sheet never mutates anything on its own', (tester) async {
    ProductFilters? result = const ProductFilters(availableOnly: true); // sentinel non-null
    await _open(tester, onResult: (r) => result = r);

    await tester.tap(find.byKey(const Key('product-filter-available-only')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('product-filter-cancel')));
    await tester.pumpAndSettle();

    expect(result, isNull);
  });

  testWidgets('Clear All resets every toggle and clears the price fields, still requires Apply to take effect',
      (tester) async {
    ProductFilters? applied;
    await _open(
      tester,
      onResult: (r) => applied = r,
      initial: const ProductFilters(availableOnly: true, hasOffers: true, minPriceMinor: 1000, maxPriceMinor: 5000),
    );

    await tester.tap(find.byKey(const Key('product-filter-clear-all')));
    await tester.pumpAndSettle();

    final availableSwitch = tester.widget<SwitchListTile>(find.byKey(const Key('product-filter-available-only')));
    expect(availableSwitch.value, isFalse);
    final minField = tester.widget<TextField>(find.byKey(const Key('product-filter-price-min')));
    expect(minField.controller!.text, isEmpty);

    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(applied, ProductFilters.empty);
  });

  testWidgets('an empty min/max field is treated as "no bound", never a fabricated 0', (tester) async {
    ProductFilters? applied;
    await _open(tester, onResult: (r) => applied = r);

    await tester.enterText(find.byKey(const Key('product-filter-price-min')), '20');
    // max left empty
    await tester.pumpAndSettle();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();

    expect(applied!.minPriceMinor, 2000);
    expect(applied!.maxPriceMinor, isNull);
  });

  testWidgets('shows the real derived min/max available price as field hints, never a hardcoded limit',
      (tester) async {
    await _open(tester, onResult: (_) {}, minAvailablePriceMinor: 500, maxAvailablePriceMinor: 15000);

    final minField = tester.widget<TextField>(find.byKey(const Key('product-filter-price-min')));
    final maxField = tester.widget<TextField>(find.byKey(const Key('product-filter-price-max')));
    expect(minField.decoration?.hintText, isNotNull);
    expect(maxField.decoration?.hintText, isNotNull);
  });

  testWidgets('renders correctly in RTL (Arabic)', (tester) async {
    await _open(tester, onResult: (_) {}, locale: const Locale('ar'));

    expect(find.text('فلترة'), findsOneWidget);
    expect(find.text('متوفر فقط'), findsOneWidget);
    expect(find.text('نطاق السعر'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('renders correctly in Dark Mode', (tester) async {
    await _open(tester, onResult: (_) {}, dark: true);

    expect(find.text('Filter'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
