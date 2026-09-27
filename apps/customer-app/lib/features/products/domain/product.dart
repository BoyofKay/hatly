import 'product_option.dart';

/// Mirrors the backend's proposed (not yet implemented — see the
/// Phase 2C assessment) `Product` entity: belongs to one
/// `vendorBranchId` and one `categoryId`, priced in integer minor
/// units, with a flat list of [ProductOption]s (empty for a product
/// with no add-ons/customization).
///
/// Used for both the product list (categoryId/name/imageUrl/priceMinor
/// are enough to render a list tile) and the product details screen
/// (which also uses description/options) — one model, not two, since
/// nothing here is expensive to carry around unused in the list
/// context, unlike e.g. a paginated field.
class Product {
  const Product({
    required this.id,
    required this.vendorBranchId,
    required this.categoryId,
    required this.name,
    this.nameAr,
    this.description,
    this.descriptionAr,
    this.imageUrl,
    required this.priceMinor,
    required this.isAvailable,
    this.pricingUnit = 'PIECE',
    this.inventoryMode = 'OPEN',
    this.quantity,
    this.options = const [],
    this.activeOffer,
    this.catalogProductId,
    this.vendor,
  });

  final String id;
  final String vendorBranchId;
  final String categoryId;
  final String name;
  final String? nameAr;
  final String? description;
  final String? descriptionAr;
  final String? imageUrl;
  final int priceMinor;
  final bool isAvailable;

  /// `'PIECE'` or `'WEIGHT'` (Weighted Products) — added for Cart &
  /// Checkout Stabilization so the Cart's own `pricingUnit` field can
  /// be traced back to its source Product; defaults to `'PIECE'` so
  /// every existing construction call site remains valid unchanged.
  final String pricingUnit;

  /// Tracked Inventory Order-Time Enforcement. `'OPEN'` or `'TRACKED'`
  /// — mirrors the backend `Product.inventoryMode` exactly (Inventory
  /// Foundation). Defaults `'OPEN'` so every existing construction
  /// call site remains valid unchanged. `quantity` is currently known
  /// stock — pieces for a PIECE product, grams for a WEIGHT product
  /// (same units as `requestedWeightGrams` elsewhere) — null for OPEN,
  /// and used ONLY as a Cart UX guard (max "+" quantity); the backend
  /// remains the sole authoritative check at Order creation.
  final String inventoryMode;
  final int? quantity;

  final List<ProductOption> options;

  /// Customer Product-Level Offers Display. Null when no active offer
  /// currently applies — CONFIRMED informational only, never a
  /// reservation/guarantee; checkout independently re-validates.
  final ActiveOffer? activeOffer;

  /// The shared marketplace product identity this vendor listing belongs to, when an admin linked it to
  /// an ACTIVE catalog product (`GET /products/:id` only). `null` for an unlinked listing — which then
  /// behaves exactly as before. This [id] stays the listing id used for the cart.
  final String? catalogProductId;

  /// Small summary of the selling vendor/branch (`GET /products/:id` only; null elsewhere).
  final ProductVendorSummary? vendor;

  bool get isWeighted => pricingUnit == 'WEIGHT';
  bool get isTracked => inventoryMode == 'TRACKED';
}

/// Customer Product-Level Offers Display. Mirrors the backend's
/// `ActiveOfferSummary` exactly — `specialPriceMinor` only meaningful
/// when `mechanism == 'FLASH_SALE'`. Never carries `discountType`/
/// `discountValue`/limits/budget — those remain Admin-internal.
class ActiveOffer {
  const ActiveOffer({required this.mechanism, this.specialPriceMinor});

  final String mechanism;
  final int? specialPriceMinor;

  bool get isFlashSale => mechanism == 'FLASH_SALE';

  factory ActiveOffer.fromJson(Map<String, dynamic> json) {
    return ActiveOffer(
      mechanism: json['mechanism'] as String,
      specialPriceMinor: json['specialPriceMinor'] as int?,
    );
  }
}

/// The vendor/branch that sells a product listing — mirrors the `vendor` block the backend adds to
/// `GET /products/:id`. Ratings are the branch's real rating (0 / 0 when it has none).
class ProductVendorSummary {
  const ProductVendorSummary({
    required this.id,
    required this.vendorBranchId,
    required this.name,
    this.nameAr,
    this.logoUrl,
    required this.branchName,
    required this.isOpen,
    required this.ratingAverage,
    required this.ratingCount,
  });

  final String id;
  final String vendorBranchId;
  final String name;
  final String? nameAr;
  final String? logoUrl;
  final String branchName;
  final bool isOpen;
  final double ratingAverage;
  final int ratingCount;

  factory ProductVendorSummary.fromJson(Map<String, dynamic> json) {
    return ProductVendorSummary(
      id: json['id'] as String,
      vendorBranchId: json['vendorBranchId'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      logoUrl: json['logoUrl'] as String?,
      branchName: json['branchName'] as String,
      isOpen: json['isOpen'] as bool,
      ratingAverage: (json['ratingAverage'] as num).toDouble(),
      ratingCount: (json['ratingCount'] as num).toInt(),
    );
  }
}
