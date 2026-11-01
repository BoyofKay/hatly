import 'product.dart';
import 'product_option.dart';

/// The customer's in-progress choices for ONE product listing: selected option values, piece quantity
/// and — for weighted products — the requested grams. Pure and immutable (no Flutter, no I/O), so the
/// rules are unit-tested and the Product Details screen just holds one of these in its own state, which is
/// therefore discarded with the screen.
///
/// The rules mirror the backend's cart validation (`cart.service.ts validateSelectedOptions`): a REQUIRED
/// option needs at least one selected value, a single-select option holds at most one. Nothing here adds
/// a limit of its own beyond the ones the product screen already had (see [maxQuantity]).
class ProductConfiguration {
  const ProductConfiguration({
    this.selections = const {},
    this.quantity = 1,
    this.requestedWeightGrams = minWeightGrams,
  });

  /// Weighted products step in 100g, never below 100g — same as the cart's weight editor.
  static const int weightStepGrams = 100;
  static const int minWeightGrams = 100;

  /// The product screen's existing UX cap for piece quantity (the backend stays authoritative).
  static const int maxPieceQuantity = 50;

  /// UX ceiling for a typed weight (50 kg); the backend validates every weight on its own.
  static const int maxWeightGrams = 50000;

  /// The heaviest weight offered: the known stock for a TRACKED listing, otherwise the UX ceiling.
  int maxWeightFor(Product product) =>
      product.isTracked && product.quantity != null
          ? product.quantity!.clamp(0, maxWeightGrams)
          : maxWeightGrams;

  /// A weight the customer picked or typed, kept inside [minWeightGrams, maxWeightFor]. Any whole number of grams in range is
  /// valid — 1 kg, 1.25 kg and 100 g all stay possible; nothing forces whole kilograms.
  ProductConfiguration withWeight(Product product, int grams) {
    final max = maxWeightFor(product);
    final bounded = max < minWeightGrams
        ? minWeightGrams
        : grams.clamp(minWeightGrams, max);
    return copyWith(requestedWeightGrams: bounded);
  }

  /// optionId → selected value ids.
  final Map<String, Set<String>> selections;
  final int quantity;
  final int requestedWeightGrams;

  /// A required single-select option starts on its first value (unchanged behaviour: no extra tap for the
  /// common "Regular" case). Everything else starts empty.
  factory ProductConfiguration.initial(Product product) {
    return ProductConfiguration(selections: {
      for (final option in product.options)
        if (option.isRequired &&
            !option.allowsMultiple &&
            option.values.isNotEmpty)
          option.id: {option.values.first.id},
    });
  }

  Set<String> selectedFor(ProductOption option) =>
      selections[option.id] ?? const {};

  /// Toggle/replace one value according to the option's rules.
  ProductConfiguration toggle(ProductOption option, String valueId) {
    final current = {...selectedFor(option)};
    if (option.allowsMultiple) {
      if (current.contains(valueId)) {
        current.remove(valueId);
      } else {
        // At the group's maximum a further value is simply not added (the customer must untick one first).
        final max = option.effectiveMax;
        if (max != null && current.length >= max) return this;
        current.add(valueId);
      }
    } else {
      current
        ..clear()
        ..add(valueId);
    }
    return copyWith(selections: {...selections, option.id: current});
  }

  /// Required options that currently have nothing selected.
  List<ProductOption> missingRequired(Product product) => [
        for (final option in product.options)
          if (option.isRequired && selectedFor(option).isEmpty) option,
      ];

  /// Groups with something chosen, but fewer than their minimum (e.g. "choose at least 2", one chosen).
  List<ProductOption> belowMinimum(Product product) => [
        for (final option in product.options)
          if (selectedFor(option).isNotEmpty &&
              selectedFor(option).length < option.effectiveMin)
            option,
      ];

  bool isValid(Product product) =>
      missingRequired(product).isEmpty && belowMinimum(product).isEmpty;

  List<String> selectedValueIds() =>
      [for (final set in selections.values) ...set];

  int selectedDeltaMinor(Product product) => product.options
      .expand((o) => o.values)
      .where((v) => selections.values.any((set) => set.contains(v.id)))
      .fold<int>(0, (sum, v) => sum + v.priceDeltaMinor);

  /// Client-side ESTIMATE for immediate feedback only — never sent to the server. The authoritative price
  /// always comes back from the cart. Weighted: price is per kg, scaled by the requested grams (a weighed item is never
  /// discounted).
  ///
  /// A piece product on a valid FLASH_SALE shows its special price in the header, so the estimate must use it too — it used
  /// to show 90 up top and then 110 in the total. This mirrors how checkout plans a flash sale (`planFlashSaleForCart`):
  /// the special price replaces the product's BASE price only (never below it) for up to `perOrderLimit` units (all units
  /// when there is no cap); paid modifiers are added on top of the promotional base and are paid on every unit, and units
  /// beyond the cap cost the normal base price. e.g. base 150, special 100, option +20 → 120 per promoted unit.
  int estimatedTotalMinor(Product product) {
    final unit = product.priceMinor + selectedDeltaMinor(product);
    if (product.isWeighted) {
      // Integer arithmetic only (round half up), the same result as the server's Math.round(price × grams / 1000) — no floating point.
      return (unit * requestedWeightGrams + 500) ~/ 1000;
    }
    final offer = product.activeOffer;
    final special = offer?.specialPriceMinor;
    if (offer != null && offer.isFlashSale && special != null) {
      final perUnitDiscount =
          product.priceMinor > special ? product.priceMinor - special : 0;
      final cap = offer.perOrderLimit;
      final discountedUnits =
          cap == null ? quantity : (quantity < cap ? quantity : cap);
      return unit * quantity - discountedUnits * perUnitDiscount;
    }
    return unit * quantity;
  }

  /// The highest piece quantity offered: known stock for a TRACKED listing (capped by the UX maximum),
  /// otherwise the UX maximum. Never raises a backend limit.
  int maxQuantity(Product product) => product.isTracked
      ? (product.quantity ?? 0).clamp(0, maxPieceQuantity)
      : maxPieceQuantity;

  bool canIncreaseQuantity(Product product) => quantity < maxQuantity(product);
  bool get canDecreaseQuantity => quantity > 1;

  /// Weighted "+" is disabled once another step would exceed known tracked stock (grams).
  bool canIncreaseWeight(Product product) => !(product.isTracked &&
      product.quantity != null &&
      requestedWeightGrams >= product.quantity!);
  bool get canDecreaseWeight => requestedWeightGrams > minWeightGrams;

  ProductConfiguration copyWith({
    Map<String, Set<String>>? selections,
    int? quantity,
    int? requestedWeightGrams,
  }) =>
      ProductConfiguration(
        selections: selections ?? this.selections,
        quantity: quantity ?? this.quantity,
        requestedWeightGrams: requestedWeightGrams ?? this.requestedWeightGrams,
      );
}
