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
  ActiveOffer? activeOffer,
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
      activeOffer: activeOffer,
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

  group(
      'estimated total follows the SAME flash-sale rules as checkout (Kefta showed 90 in the header and 110 in the total)',
      () {
    const flash = ActiveOffer(mechanism: 'FLASH_SALE', specialPriceMinor: 9000);

    test(
        'one unit on a flash sale: the total is the special price, matching the price shown on the card',
        () {
      final product = _product(price: 11000, activeOffer: flash);
      expect(const ProductConfiguration().estimatedTotalMinor(product), 9000);
    });

    test(
        'several units with no per-order cap: every unit gets the special price',
        () {
      final product = _product(price: 11000, activeOffer: flash);
      expect(
          const ProductConfiguration(quantity: 3).estimatedTotalMinor(product),
          27000);
    });

    test(
        'a per-order cap: only that many units are discounted, the rest cost the normal price',
        () {
      final product = _product(
          price: 11000,
          activeOffer: const ActiveOffer(
              mechanism: 'FLASH_SALE',
              specialPriceMinor: 9000,
              perOrderLimit: 2));
      expect(
          const ProductConfiguration(quantity: 1).estimatedTotalMinor(product),
          9000);
      expect(
          const ProductConfiguration(quantity: 2).estimatedTotalMinor(product),
          18000);
      expect(
          const ProductConfiguration(quantity: 3).estimatedTotalMinor(product),
          18000 + 11000);
    });

    test(
        'a special price that is not below the price is no discount (never a price increase)',
        () {
      final product = _product(
          price: 11000,
          activeOffer: const ActiveOffer(
              mechanism: 'FLASH_SALE', specialPriceMinor: 12000));
      expect(
          const ProductConfiguration(quantity: 2).estimatedTotalMinor(product),
          22000);
    });

    test(
        'paid modifiers are added ON TOP of the promotional base (base 110, special 90, option +10 → 100), never absorbed',
        () {
      final product = _product(
          price: 11000,
          options: [
            _option('extra', values: const [('x', 1000)])
          ],
          activeOffer: flash);
      final config =
          const ProductConfiguration().toggle(product.options.first, 'extra-x');
      expect(config.estimatedTotalMinor(product), 10000);
    });

    test(
        'base 150, promo base 100, option +20 → 120 per promoted unit; the cap leaves the rest at base + option',
        () {
      final product = _product(
          price: 15000,
          options: [
            _option('extra', values: const [('x', 2000)])
          ],
          activeOffer: const ActiveOffer(
              mechanism: 'FLASH_SALE',
              specialPriceMinor: 10000,
              perOrderLimit: 2));
      final one =
          const ProductConfiguration().toggle(product.options.first, 'extra-x');
      expect(one.estimatedTotalMinor(product), 12000);
      expect(one.copyWith(quantity: 2).estimatedTotalMinor(product), 24000);
      expect(one.copyWith(quantity: 3).estimatedTotalMinor(product),
          24000 + 17000);
    });

    test('a negative option still leaves the promotional base untouched', () {
      final product = _product(
          price: 11000,
          options: [
            _option('small', values: const [('s', -1000)])
          ],
          activeOffer: flash);
      final config =
          const ProductConfiguration().toggle(product.options.first, 'small-s');
      expect(config.estimatedTotalMinor(product),
          8000); // 90 promo base − 10 option
    });

    test('a SUBTOTAL_DISCOUNT presence signal changes no unit price', () {
      final product = _product(
          price: 11000,
          activeOffer: const ActiveOffer(mechanism: 'SUBTOTAL_DISCOUNT'));
      expect(
          const ProductConfiguration(quantity: 2).estimatedTotalMinor(product),
          22000);
    });

    test(
        'a weighed product is never discounted (it is per kg, scaled by the grams)',
        () {
      final product =
          _product(price: 11000, pricingUnit: 'WEIGHT', activeOffer: flash);
      expect(
          const ProductConfiguration(requestedWeightGrams: 500)
              .estimatedTotalMinor(product),
          5500);
    });
  });

  group('explicit minimum / maximum selections (mirror the backend rules)', () {
    ProductOption limited({int min = 0, int? max, bool required = false}) =>
        ProductOption(
          id: 'top',
          name: 'Toppings',
          isRequired: required,
          allowsMultiple: true,
          minSelections: min,
          maxSelections: max,
          values: const [
            ProductOptionValue(id: 'a', name: 'A'),
            ProductOptionValue(id: 'b', name: 'B'),
            ProductOptionValue(id: 'c', name: 'C'),
          ],
        );

    test(
        'effective limits fall back to the original flags (a legacy group is unchanged)',
        () {
      const legacySingle = ProductOption(
          id: 's',
          name: 's',
          isRequired: true,
          allowsMultiple: false,
          values: []);
      expect([legacySingle.effectiveMin, legacySingle.effectiveMax], [1, 1]);
      const legacyMulti = ProductOption(
          id: 'm',
          name: 'm',
          isRequired: false,
          allowsMultiple: true,
          values: []);
      expect([legacyMulti.effectiveMin, legacyMulti.effectiveMax], [0, null]);
      expect([
        limited(min: 2, max: 4).effectiveMin,
        limited(min: 2, max: 4).effectiveMax
      ], [
        2,
        4
      ]);
    });

    test(
        'a further value is not added once the maximum is reached; unticking frees a slot',
        () {
      final option = limited(max: 2);
      final product = _product(options: [option]);
      var config = const ProductConfiguration();
      config =
          config.toggle(option, 'a').toggle(option, 'b').toggle(option, 'c');
      expect(config.selectedFor(option), {'a', 'b'});
      config = config.toggle(option, 'a').toggle(option, 'c');
      expect(config.selectedFor(option), {'b', 'c'});
      expect(config.isValid(product), isTrue);
    });

    test(
        'below the minimum is invalid (but nothing chosen is the "required" case, not "below minimum")',
        () {
      final option = limited(min: 2);
      final product = _product(options: [option]);
      var config = const ProductConfiguration();
      expect(config.missingRequired(product), isEmpty,
          reason:
              'min without isRequired flag: the server marks min >= 1 as required, the app learns that from isRequired');
      config = config.toggle(option, 'a');
      expect(config.belowMinimum(product), [option]);
      expect(config.isValid(product), isFalse);
      config = config.toggle(option, 'b');
      expect(config.belowMinimum(product), isEmpty);
      expect(config.isValid(product), isTrue);
    });
  });
}
