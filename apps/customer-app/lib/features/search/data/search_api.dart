import '../../../core/network/api_client.dart';
import '../../products/domain/product.dart';
import '../../vendors/domain/opening_hours.dart';
import '../../vendors/domain/vendor_branch_summary.dart';

/// Customer Search. Lean, dedicated result types — deliberately NOT
/// the full `Vendor`/`Product` domain models, which carry fields
/// (ETA, delivery fee, options, etc.) this endpoint's response
/// genuinely does not provide. Reusing those models here would mean
/// fabricating data that doesn't exist; these mirror the real
/// `SearchVendorResult`/`SearchProductResult` backend shapes exactly.
class SearchVendorResult {
  const SearchVendorResult({
    required this.id,
    required this.name,
    this.nameAr,
    this.logoUrl,
    required this.isOpen,
    required this.ratingAverage,
    required this.ratingCount,
    this.openingHours = const {},
  });

  /// VendorBranch.id — CONFIRMED, matches the existing Vendor Details route's id exactly.
  final String id;
  final String name;
  final String? nameAr;
  final String? logoUrl;
  final bool isOpen;
  final double ratingAverage;
  final int ratingCount;
  final Map<String, OpeningHoursRange> openingHours;

  factory SearchVendorResult.fromJson(Map<String, dynamic> json) {
    return SearchVendorResult(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      logoUrl: json['logoUrl'] as String?,
      isOpen: json['isOpen'] as bool,
      ratingAverage: (json['ratingAverage'] as num).toDouble(),
      ratingCount: json['ratingCount'] as int,
      openingHours: openingHoursFromJson(json['openingHours']),
    );
  }
}

class SearchProductResult {
  const SearchProductResult({
    required this.id,
    this.catalogProductId,
    required this.vendorBranchId,
    required this.name,
    this.nameAr,
    this.imageUrl,
    required this.priceMinor,
    required this.pricingUnit,
    required this.inventoryMode,
    this.quantity,
    required this.isAvailable,
    required this.vendorName,
    this.vendorNameAr,
    this.vendorLogoUrl,
    this.activeOffer,
  });

  final String id;

  /// Marketplace product identity when this listing is linked to an ACTIVE catalog product; else null.
  final String? catalogProductId;
  final String vendorBranchId;
  final String name;
  final String? nameAr;
  final String? imageUrl;
  final int priceMinor;
  final String pricingUnit;
  final String inventoryMode;
  final int? quantity;
  final bool isAvailable;
  final String vendorName;
  final String? vendorNameAr;
  final String? vendorLogoUrl;

  /// Customer Product-Level Offers Display. Same shape/contract as
  /// Product Card/Details — reused verbatim, never a separate Search-
  /// specific representation.
  final ActiveOffer? activeOffer;

  bool get isWeighted => pricingUnit == 'WEIGHT';

  factory SearchProductResult.fromJson(Map<String, dynamic> json) {
    return SearchProductResult(
      id: json['id'] as String,
      catalogProductId: json['catalogProductId'] as String?,
      vendorBranchId: json['vendorBranchId'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      imageUrl: json['imageUrl'] as String?,
      priceMinor: json['priceMinor'] as int,
      pricingUnit: json['pricingUnit'] as String,
      inventoryMode: json['inventoryMode'] as String,
      quantity: json['quantity'] as int?,
      isAvailable: json['isAvailable'] as bool,
      vendorName: json['vendorName'] as String,
      vendorNameAr: json['vendorNameAr'] as String?,
      vendorLogoUrl: json['vendorLogoUrl'] as String?,
      activeOffer: json['activeOffer'] != null
          ? ActiveOffer.fromJson(json['activeOffer'] as Map<String, dynamic>)
          : null,
    );
  }
}

class SearchResultPage<T> {
  const SearchResultPage(
      {required this.data,
      required this.page,
      required this.limit,
      required this.total});
  final List<T> data;
  final int page;
  final int limit;
  final int total;
}

class SearchResults {
  const SearchResults({required this.vendors, required this.products});
  final SearchResultPage<SearchVendorResult> vendors;
  final SearchResultPage<SearchProductResult> products;
}

/// Calls the real backend `GET search` (public — matches the existing
/// discovery/catalog public-browsing convention, no auth required).
class SearchApi {
  SearchApi(this._client);

  final ApiClient _client;

  Future<SearchResults> search({
    required String q,
    double? latitude,
    double? longitude,
  }) {
    return _client.request(
      (dio) => dio.get(
        '/search',
        queryParameters: {
          'q': q,
          // Real coordinates only, never fabricated — matches the
          // existing optional-coordinate contract exactly.
          if (latitude != null) 'latitude': latitude,
          if (longitude != null) 'longitude': longitude,
        },
      ),
      (data) {
        final json = data['data'] as Map<String, dynamic>;
        final vendorsJson = json['vendors'] as Map<String, dynamic>;
        final productsJson = json['products'] as Map<String, dynamic>;
        return SearchResults(
          vendors: SearchResultPage<SearchVendorResult>(
            data: (vendorsJson['data'] as List)
                .map((e) =>
                    SearchVendorResult.fromJson(e as Map<String, dynamic>))
                .toList(),
            page: vendorsJson['page'] as int,
            limit: vendorsJson['limit'] as int,
            total: vendorsJson['total'] as int,
          ),
          products: SearchResultPage<SearchProductResult>(
            data: (productsJson['data'] as List)
                .map((e) =>
                    SearchProductResult.fromJson(e as Map<String, dynamic>))
                .toList(),
            page: productsJson['page'] as int,
            limit: productsJson['limit'] as int,
            total: productsJson['total'] as int,
          ),
        );
      },
    );
  }
}
