import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_configuration.dart';
import 'package:hatly_customer/shared_widgets/weight_selector.dart';

Product _weighed({String inventoryMode = 'OPEN', int? stockGrams}) => Product(
      id: 'p',
      vendorBranchId: 'b',
      categoryId: 'c',
      name: 'Kofta',
      priceMinor: 11000,
      isAvailable: true,
      pricingUnit: 'WEIGHT',
      inventoryMode: inventoryMode,
      quantity: stockGrams,
    );

void main() {
  group('parseKilogramsToGrams — exact integer grams, no floating point', () {
    test('whole and fractional kilograms', () {
      expect(parseKilogramsToGrams('1'), 1000);
      expect(parseKilogramsToGrams('2'), 2000);
      expect(parseKilogramsToGrams('0.1'), 100);
      expect(parseKilogramsToGrams('0.3'),
          300); // 0.3 * 1000 is 300.00000000000006 in floating point
      expect(parseKilogramsToGrams('1.25'), 1250);
      expect(parseKilogramsToGrams('1.005'), 1005);
      expect(parseKilogramsToGrams('12.5'), 12500);
    });

    test('a comma or Arabic digits are accepted (Egyptian keyboards)', () {
      expect(parseKilogramsToGrams('1,5'), 1500);
      expect(parseKilogramsToGrams('١'), 1000);
      expect(parseKilogramsToGrams('١٫٢٥'), 1250);
      expect(parseKilogramsToGrams('  2  '), 2000);
    });

    test('anything else is rejected, never guessed', () {
      for (final bad in [
        '',
        ' ',
        'abc',
        '1.2.3',
        '-1',
        '+1',
        '1e3',
        '1.2345',
        '.5',
        '1.',
        '1000',
        '1 kg',
        'NaN'
      ]) {
        expect({bad, parseKilogramsToGrams(bad)}, {bad, null});
      }
    });
  });

  group(
      'the weight a customer can pick (1 kg is one tap; fractions stay possible)',
      () {
    test('the presets are the amounts people ask for: ¼, ½, 1, 1½, 2, 3 kg', () {
      expect(kQuickWeightsGrams, [250, 500, 1000, 1500, 2000, 3000]);
    });

    test('the stepper snaps to quarter kilos', () {
      expect(weightStepUp(250), 500);
      expect(weightStepUp(300), 500);
      expect(weightStepUp(1000), 1250);
      expect(weightStepDown(500), 250);
      expect(weightStepDown(300), 250);
      expect(weightStepDown(1300), 1250);
      expect(weightStepDown(250), 250); // never below a quarter
    });

    test(
        'withWeight sets exactly 1 kg, 1.25 kg, 100 g — nothing is forced to whole kilograms',
        () {
      final product = _weighed();
      const base = ProductConfiguration();
      expect(base.withWeight(product, 1000).requestedWeightGrams, 1000);
      expect(base.withWeight(product, 1250).requestedWeightGrams, 1250);
      expect(base.withWeight(product, 100).requestedWeightGrams, 100);
    });

    test('and stays inside the minimum (100 g) and the ceiling (50 kg)', () {
      final product = _weighed();
      const base = ProductConfiguration();
      expect(base.withWeight(product, 10).requestedWeightGrams, 100);
      expect(base.withWeight(product, 999999).requestedWeightGrams, 50000);
    });

    test('a tracked listing never lets the weight exceed its known stock', () {
      final product = _weighed(inventoryMode: 'TRACKED', stockGrams: 1500);
      const base = ProductConfiguration();
      expect(base.maxWeightFor(product), 1500);
      expect(base.withWeight(product, 2000).requestedWeightGrams, 1500);
      expect(base.withWeight(product, 1000).requestedWeightGrams, 1000);
    });

    test(
        'the estimated total for 1 kg, 1.25 kg and 3 kg is exact integer money (price per kg × grams / 1000)',
        () {
      final product = _weighed(); // 110.00 per kg
      const base = ProductConfiguration();
      expect(
          base.withWeight(product, 1000).estimatedTotalMinor(product), 11000);
      expect(
          base.withWeight(product, 1250).estimatedTotalMinor(product), 13750);
      expect(
          base.withWeight(product, 3000).estimatedTotalMinor(product), 33000);
      expect(base.withWeight(product, 100).estimatedTotalMinor(product), 1100);
    });
  });
}
