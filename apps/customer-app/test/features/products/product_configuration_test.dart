import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/products/domain/product.dart';
import 'package:hatly_customer/features/products/domain/product_configuration.dart';
import 'package:hatly_customer/features/products/domain/product_option.dart';

ProductOption _option(String id,
        {bool required = false,
        bool multiple = false,
        List<(String, int)> values = const [('a', 0), ('b', 500)]}) =>
    ProductOption(
      id: id,
      name: id,
      isRequired: required,
      allowsMultiple: multiple,
      values: [
        for (final v in values)
          ProductOptionValue(
              id: '$id-${v.$1}', name: v.$1, priceDeltaMinor: v.$2),
      ],
    );

Product _product({
  List<ProductOption> options = const [],
  int price = 10000,
  String pricingUnit = 'PIECE',
  String inventoryMode = 'OPEN',
  int? quantity,
}) =>
    Product(
      id: 'p',
      vendorBranchId: 'b',
      categoryId: 'c',
      name: 'P',
      priceMinor: price,
      isAvailable: true,
      pricingUnit: pricingUnit,
      inventoryMode: inventoryMode,
      quantity: quantity,
      options: options,
    );

void main() {
  group(
      'required / optional options (mirrors the backend OPTION_REQUIRED rule)',
      () {
    test('a REQUIRED single-select starts on its first value and is valid', () {
      final product = _product(options: [_option('size', required: true)]);
      final config = ProductConfiguration.initial(product);
      expect(config.selectedFor(product.options.first), {'size-a'});
      expect(config.isValid(product), isTrue);
    });

    test(
        'a single-select holds exactly one value: choosing another replaces it',
        () {
      final product = _product(options: [_option('size', required: true)]);
      final option = product.options.first;
      final config =
          ProductConfiguration.initial(product).toggle(option, 'size-b');
      expect(config.selectedFor(option), {'size-b'});
    });

    test(
        'a REQUIRED multi-select starts empty → invalid until at least one value is chosen',
        () {
      final product = _product(
          options: [_option('extras', required: true, multiple: true)]);
      final option = product.options.first;
      var config = ProductConfiguration.initial(product);
      expect(config.isValid(product), isFalse);
      expect(config.missingRequired(product).map((o) => o.id), ['extras']);

      config = config.toggle(option, 'extras-a');
      expect(config.isValid(product), isTrue);
      config = config.toggle(option, 'extras-b');
      expect(config.selectedFor(option), {'extras-a', 'extras-b'});
      // un-choosing everything makes it invalid again
      config = config.toggle(option, 'extras-a').toggle(option, 'extras-b');
      expect(config.isValid(product), isFalse);
    });

    test('OPTIONAL options never block, whether single or multi', () {
      final product = _product(options: [
        _option('sauce'),
        _option('toppings', multiple: true),
      ]);
      final config = ProductConfiguration.initial(product);
      expect(config.isValid(product), isTrue);
      expect(config.selectedValueIds(), isEmpty);
      expect(config.missingRequired(product), isEmpty);
    });

    test('selectedValueIds gathers every selected value across options', () {
      final product = _product(options: [
        _option('size', required: true),
        _option('extras', multiple: true),
      ]);
      final config = ProductConfiguration.initial(product)
          .toggle(product.options[1], 'extras-a')
          .toggle(product.options[1], 'extras-b');
      expect(config.selectedValueIds()..sort(),
          ['extras-a', 'extras-b', 'size-a']);
    });
  });

  group('price estimate (never sent to the server)', () {
    test('piece: (price + selected deltas) × quantity', () {
      final product =
          _product(price: 10000, options: [_option('extras', multiple: true)]);
      var config = ProductConfiguration.initial(product)
          .toggle(product.options.first, 'extras-b') // +500
          .copyWith(quantity: 3);
      expect(config.estimatedTotalMinor(product), (10000 + 500) * 3);
      config = config.toggle(product.options.first, 'extras-b');
      expect(config.estimatedTotalMinor(product), 10000 * 3);
    });

    test('weighted: price is per kg, scaled by the requested grams', () {
      final product = _product(price: 8000, pricingUnit: 'WEIGHT');
      expect(
          const ProductConfiguration(requestedWeightGrams: 250)
              .estimatedTotalMinor(product),
          2000);
    });
  });

  group('quantity rules (the screen\'s existing UX limits, no new ones)', () {
    test('quantity never goes below 1; the default UX cap is 50', () {
      final product = _product();
      var config = const ProductConfiguration();
      expect(config.canDecreaseQuantity, isFalse);
      config = config.copyWith(quantity: 49);
      expect(config.canIncreaseQuantity(product), isTrue);
      config = config.copyWith(quantity: 50);
      expect(config.canIncreaseQuantity(product), isFalse);
    });

    test('a TRACKED piece product is capped at its known stock', () {
      final product = _product(inventoryMode: 'TRACKED', quantity: 3);
      expect(
          const ProductConfiguration(quantity: 2).canIncreaseQuantity(product),
          isTrue);
      expect(
          const ProductConfiguration(quantity: 3).canIncreaseQuantity(product),
          isFalse);
      expect(
          _product(inventoryMode: 'TRACKED', quantity: 400).isTracked, isTrue);
      expect(
          const ProductConfiguration()
              .maxQuantity(_product(inventoryMode: 'TRACKED', quantity: 400)),
          50);
    });

    test(
        'weighted: 100g steps, never below 100g, tracked stock (grams) is respected',
        () {
      final open = _product(pricingUnit: 'WEIGHT');
      var config = const ProductConfiguration();
      expect(config.requestedWeightGrams, 100);
      expect(config.canDecreaseWeight, isFalse);
      config = config.copyWith(requestedWeightGrams: 200);
      expect(config.canDecreaseWeight, isTrue);
      expect(config.canIncreaseWeight(open), isTrue);

      final tracked = _product(
          pricingUnit: 'WEIGHT', inventoryMode: 'TRACKED', quantity: 300);
      expect(
          const ProductConfiguration(requestedWeightGrams: 200)
              .canIncreaseWeight(tracked),
          isTrue);
      expect(
          const ProductConfiguration(requestedWeightGrams: 300)
              .canIncreaseWeight(tracked),
          isFalse);
      expect(ProductConfiguration.weightStepGrams, 100);
    });
  });
}
