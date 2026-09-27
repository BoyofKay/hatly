import '../../products/domain/product.dart';

/// Models for the marketplace product identity ("Catalog Foundation"). They mirror the backend responses
/// of `GET /products?sectorId=` and `GET /catalog-products/:id` field for field and add NO behaviour:
/// nothing here fabricates ETA, delivery fee or any other data the API does not return.

/// One item of the product-first sector listing (`GET /products?sectorId=`).
///
/// A linked catalog product collapses all its vendor listings into ONE item ([catalogProductId] set,
/// [listingId] only when exactly one relevant listing exists). An unlinked listing is its own item:
/// [catalogProductId] is null and [listingId] is its (existing) product id, [storeCount] 1.
class CatalogProductSummary {
  const CatalogProductSummary({
    this.catalogProductId,
    this.listingId,
    required this.name,
    this.nameAr,
    this.imageUrl,
    this.brand,
    required this.pricingUnit,
    required this.fromPriceMinor,
    required this.storeCount,
    required this.hasOffer,
  });

  final String? catalogProductId;
  final String? listingId;
  final String name;
  final String? nameAr;
  final String? imageUrl;
  final String? brand;
  final String pricingUnit;

  /// Lowest listing price among the relevant listings (a plain price — offers are signalled by [hasOffer]).
  final int fromPriceMinor;
  final int storeCount;
  final bool hasOffer;

  bool get isLinked => catalogProductId != null;
  bool get isWeighted => pricingUnit == 'WEIGHT';

  factory CatalogProductSummary.fromJson(Map<String, dynamic> json) {
    return CatalogProductSummary(
      catalogProductId: json['catalogProductId'] as String?,
      listingId: json['listingId'] as String?,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      imageUrl: json['imageUrl'] as String?,
      brand: json['brand'] as String?,
      pricingUnit: json['pricingUnit'] as String,
      fromPriceMinor: (json['fromPriceMinor'] as num).toInt(),
      storeCount: (json['storeCount'] as num).toInt(),
      hasOffer: json['hasOffer'] as bool,
    );
  }
}

/// One page of the product-first listing.
class CatalogProductPage {
  const CatalogProductPage(
      {required this.data,
      required this.page,
      required this.limit,
      required this.total});

  final List<CatalogProductSummary> data;
  final int page;
  final int limit;
  final int total;

  bool get hasMore => page * limit < total;

  factory CatalogProductPage.fromJson(Map<String, dynamic> json) {
    final meta = json['meta'] as Map<String, dynamic>;
    return CatalogProductPage(
      data: (json['data'] as List)
          .map((e) => CatalogProductSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      page: (meta['page'] as num).toInt(),
      limit: (meta['limit'] as num).toInt(),
      total: (meta['total'] as num).toInt(),
    );
  }
}

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
