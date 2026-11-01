import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_configuration.dart';
import 'package:hatly_customer/features/products/presentation/widgets/weight_inline_input.dart';

import '../../support/test_app.dart';

Product _kofta(int priceMinorPerKg) => Product(id: 'p', vendorBranchId: 'b', categoryId: 'c', name: 'Kofta', priceMinor: priceMinorPerKg, isAvailable: true, pricingUnit: 'WEIGHT', inventoryMode: 'OPEN');

void main() {
  group('instant estimate = the server\'s round(price × grams / 1000), in integers', () {
    test('typical weights', () {
      expect(const ProductConfiguration(requestedWeightGrams: 1500).estimatedTotalMinor(_kofta(11000)), 16500);
      expect(const ProductConfiguration(requestedWeightGrams: 250).estimatedTotalMinor(_kofta(11000)), 2750);
      expect(const ProductConfiguration(requestedWeightGrams: 1000).estimatedTotalMinor(_kofta(9999)), 9999);
    });
    test('rounds half up exactly like Math.round (7.5 → 8, 83.25 → 83, 0.5 boundaries never drift)', () {
      expect(const ProductConfiguration(requestedWeightGrams: 300).estimatedTotalMinor(_kofta(25)), 8); // 7.5
      expect(const ProductConfiguration(requestedWeightGrams: 250).estimatedTotalMinor(_kofta(333)), 83); // 83.25
      expect(const ProductConfiguration(requestedWeightGrams: 100).estimatedTotalMinor(_kofta(5)), 1); // 0.5
      expect(const ProductConfiguration(requestedWeightGrams: 100).estimatedTotalMinor(_kofta(4)), 0); // 0.4
      expect(const ProductConfiguration(requestedWeightGrams: 50000).estimatedTotalMinor(_kofta(1234567)), (1234567 * 50000 + 500) ~/ 1000);
    });
  });

  group('WeightInlineInput', () {
    Future<List<int>> mount(WidgetTester t, {int grams = 500, int min = 100, int max = 5000}) async {
      final sent = <int>[];
      var current = grams;
      await t.pumpWidget(hatlyTestApp(
        StatefulBuilder(builder: (context, setState) => Padding(
          padding: const EdgeInsets.all(16),
          child: WeightInlineInput(grams: current, minGrams: min, maxGrams: max, onChanged: (g) { sent.add(g); setState(() => current = g); }),
        )),
        locale: const Locale('en'),
      ));
      return sent;
    }

    testWidgets('shows the current weight in kilograms and sends exact grams for what is typed', (t) async {
      final sent = await mount(t, grams: 1500);
      expect(find.widgetWithText(TextField, '1.5'), findsOneWidget);
      await t.enterText(find.byKey(const Key('weight-inline-field')), '2.25');
      await t.pump();
      expect(sent, [2250]);
      await t.enterText(find.byKey(const Key('weight-inline-field')), '0,3'); // a decimal comma is accepted
      await t.pump();
      expect(sent.last, 300);
    });

    testWidgets('a weight outside the range is explained and NEVER sent', (t) async {
      final sent = await mount(t, grams: 500, min: 100, max: 5000);
      await t.enterText(find.byKey(const Key('weight-inline-field')), '0.05');
      await t.pump();
      expect(find.textContaining('Enter a weight between'), findsOneWidget);
      await t.enterText(find.byKey(const Key('weight-inline-field')), '7');
      await t.pump();
      expect(find.textContaining('Enter a weight between'), findsOneWidget);
      expect(sent, isEmpty);
      // finishing with something invalid puts the last good weight back
      await t.testTextInput.receiveAction(TextInputAction.done);
      await t.pump();
      expect(find.textContaining('Enter a weight between'), findsNothing);
      expect(find.widgetWithText(TextField, '0.5'), findsOneWidget);
    });

    testWidgets('letters and other characters cannot be typed', (t) async {
      await mount(t, grams: 500);
      await t.enterText(find.byKey(const Key('weight-inline-field')), '1a.5b');
      await t.pump();
      expect(find.widgetWithText(TextField, '1.5'), findsOneWidget);
    });

    testWidgets('a preset or the stepper moving the weight updates the field', (t) async {
      var grams = 500;
      late StateSetter set;
      await t.pumpWidget(hatlyTestApp(
        StatefulBuilder(builder: (context, setState) { set = setState; return WeightInlineInput(grams: grams, minGrams: 100, maxGrams: 5000, onChanged: (_) {}); }),
        locale: const Locale('en'),
      ));
      set(() => grams = 2000);
      await t.pump();
      expect(find.widgetWithText(TextField, '2'), findsOneWidget);
    });
  });
}
