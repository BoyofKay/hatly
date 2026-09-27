/// One selectable value within a [ProductOption] — e.g. "Large" within
/// a "Size" option. Mirrors the backend's proposed
/// `ProductOptionValue` entity. `priceDeltaMinor` follows the same
/// naming convention the backend already uses for order-item option
/// snapshots (`OrderItemOption.optionsSnapshot[].priceDeltaMinor` in
/// `order-item.entity.ts`) — a signed integer minor-unit delta added
/// to the base product price when this value is selected.
class ProductOptionValue {
  const ProductOptionValue(
      {required this.id,
      required this.name,
      this.nameAr,
      this.priceDeltaMinor = 0});

  final String id;
  final String name;
  final String? nameAr;
  final int priceDeltaMinor;
}

/// A group of selectable values on a product — e.g. "Size" (choose
/// one, required) or "Extra toppings" (choose multiple, optional).
/// Mirrors the backend's proposed `ProductOption` entity.
///
/// This is a FOUNDATION model only: it supports rendering and local
/// selection state (see product_details_screen.dart), not submitting a
/// configured line item anywhere — there is no cart in this phase.
class ProductOption {
  const ProductOption({
    required this.id,
    required this.name,
    this.nameAr,
    required this.isRequired,
    required this.allowsMultiple,
    required this.values,
  });

  final String id;
  final String name;
  final String? nameAr;
  final bool isRequired;
  final bool
      allowsMultiple; // false = single-select (radio), true = multi-select (checkboxes)
  final List<ProductOptionValue> values;
}
