import '../../products/domain/product.dart';

/// Models for the marketplace catalog-product identity ("Catalog Foundation") — a product shared
/// across several vendor listings, reached via search/the catalog-product vendor selector (`GET
/// /catalog-products/:id`), never via category navigation (that is vendor-first everywhere — see
/// `home_category_section.dart`). They mirror the backend response field for field and add NO
/// behaviour: nothing here fabricates ETA, delivery fee or any other data the API does not return.

/// The vendor that owns a [VendorListing].
class ListingVendor {
  const ListingVendor(
      {required this.id, required this.name, this.nameAr, this.logoUrl});

  final String id;
  final String name;
  final String? nameAr;
  final String? logoUrl;

  factory ListingVendor.fromJson(Map<String, dynamic> json) => ListingVendor(
        id: json['id'] as String,
        name: json['name'] as String,
        nameAr: json['nameAr'] as String?,
        logoUrl: json['logoUrl'] as String?,
      );
}

/// One vendor's offer of a catalog product — the data a vendor selector needs. [listingId] is the existing
/// product id: it is what goes to the cart and to `GET /products/:id` (options, weight, inventory).
/// There is deliberately no ETA and no delivery fee: the backend has no reliable data for them.
class VendorListing {
  const VendorListing({
    required this.listingId,
    required this.vendorBranchId,
    required this.vendor,
    required this.branchName,
    required this.isOpen,
    required this.ratingAverage,
    required this.ratingCount,
    required this.priceMinor,
    required this.pricingUnit,
    this.activeOffer,
    required this.isAvailable,
    required this.inventoryMode,
    this.quantity,
  });

  final String listingId;
  final String vendorBranchId;
  final ListingVendor vendor;
  final String branchName;
  final bool isOpen;

  /// Real branch rating (0 / 0 when the branch has no ratings).
  final double ratingAverage;
  final int ratingCount;
  final int priceMinor;
  final String pricingUnit;
  final ActiveOffer? activeOffer;
  final bool isAvailable;

  /// `'OPEN'` or `'TRACKED'`; [quantity] is the known stock for TRACKED listings (pieces, or grams for
  /// weighted), null for OPEN.
  final String inventoryMode;
  final int? quantity;

  bool get isWeighted => pricingUnit == 'WEIGHT';
  bool get isTracked => inventoryMode == 'TRACKED';

  factory VendorListing.fromJson(Map<String, dynamic> json) {
    return VendorListing(
      listingId: json['listingId'] as String,
      vendorBranchId: json['vendorBranchId'] as String,
      vendor: ListingVendor.fromJson(json['vendor'] as Map<String, dynamic>),
      branchName: json['branchName'] as String,
      isOpen: json['isOpen'] as bool,
      ratingAverage: (json['ratingAverage'] as num).toDouble(),
      ratingCount: (json['ratingCount'] as num).toInt(),
      priceMinor: (json['priceMinor'] as num).toInt(),
      pricingUnit: json['pricingUnit'] as String,
      activeOffer: json['activeOffer'] != null
          ? ActiveOffer.fromJson(json['activeOffer'] as Map<String, dynamic>)
          : null,
      isAvailable: json['isAvailable'] as bool,
      inventoryMode: json['inventoryMode'] as String,
      quantity: (json['quantity'] as num?)?.toInt(),
    );
  }
}

/// `GET /catalog-products/:id` — the shared identity plus every relevant vendor listing, cheapest first.
class CatalogProductDetails {
  const CatalogProductDetails({
    required this.id,
    required this.name,
    this.nameAr,
    this.description,
    this.descriptionAr,
    this.imageUrl,
    this.brand,
    required this.pricingUnit,
    required this.storeCount,
    required this.listings,
  });

  final String id;
  final String name;
  final String? nameAr;
  final String? description;
  final String? descriptionAr;
  final String? imageUrl;
  final String? brand;
  final String pricingUnit;
  final int storeCount;
  final List<VendorListing> listings;

  bool get isWeighted => pricingUnit == 'WEIGHT';

  factory CatalogProductDetails.fromJson(Map<String, dynamic> json) {
    return CatalogProductDetails(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      description: json['description'] as String?,
      descriptionAr: json['descriptionAr'] as String?,
      imageUrl: json['imageUrl'] as String?,
      brand: json['brand'] as String?,
      pricingUnit: json['pricingUnit'] as String,
      storeCount: (json['storeCount'] as num).toInt(),
      listings: (json['listings'] as List)
          .map((e) => VendorListing.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
