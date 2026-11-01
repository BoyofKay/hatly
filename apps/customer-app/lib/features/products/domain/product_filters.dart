/// Filters V1. The Product List's active filter state (Vendor/Branch
/// menu). Subcategory is deliberately NOT here — a product belongs to
/// the vendor's OWN `ProductCategory` (Level 2), a completely
/// different, unrelated taxonomy from the marketplace `MarketplaceSector`
/// (Level 1) / `MarketplaceSubcategory` (Level 1.5) — the existing
/// category chip row above the product list already IS that "narrow
/// this vendor's own menu" control; this milestone deliberately does
/// not force a second, unrelated concept into the same UI.
class ProductFilters {
  const ProductFilters({
    this.availableOnly = false,
    this.hasOffers = false,
    this.minPriceMinor,
    this.maxPriceMinor,
  });

  /// Real `Product.isAvailable` — never inferred/defaulted to available.
  final bool availableOnly;

  /// Real, currently-active `Offer` targeting (branch-wide, category,
  /// or this specific product) — never fabricated.
  final bool hasOffers;

  /// Integer minor currency units — inclusive bounds. Both null means
  /// no price filter at all. Bounds are derived from the vendor's own
  /// currently-loaded product prices (see `ProductFilterSheet`), never
  /// a hardcoded business limit.
  final int? minPriceMinor;
  final int? maxPriceMinor;

  static const empty = ProductFilters();

  bool get isEmpty =>
      !availableOnly &&
      !hasOffers &&
      minPriceMinor == null &&
      maxPriceMinor == null;

  int get activeCount =>
      (availableOnly ? 1 : 0) +
      (hasOffers ? 1 : 0) +
      (minPriceMinor != null || maxPriceMinor != null ? 1 : 0);

  ProductFilters copyWith({
    bool? availableOnly,
    bool? hasOffers,
    Object? minPriceMinor = _unset,
    Object? maxPriceMinor = _unset,
  }) {
    return ProductFilters(
      availableOnly: availableOnly ?? this.availableOnly,
      hasOffers: hasOffers ?? this.hasOffers,
      minPriceMinor:
          minPriceMinor == _unset ? this.minPriceMinor : minPriceMinor as int?,
      maxPriceMinor:
          maxPriceMinor == _unset ? this.maxPriceMinor : maxPriceMinor as int?,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is ProductFilters &&
      other.availableOnly == availableOnly &&
      other.hasOffers == hasOffers &&
      other.minPriceMinor == minPriceMinor &&
      other.maxPriceMinor == maxPriceMinor;

  @override
  int get hashCode =>
      Object.hash(availableOnly, hasOffers, minPriceMinor, maxPriceMinor);
}

const _unset = Object();
