import '../domain/vendor.dart';
import '../domain/vendor_details.dart';

/// A single paginated page of the marketplace vendor listing —
/// mirrors the backend's `{ data, meta: { page, limit, total } }`
/// envelope exactly (see `MarketplaceVendorsController`).
class VendorListPage {
  const VendorListPage(
      {required this.data,
      required this.page,
      required this.limit,
      required this.total});

  final List<Vendor> data;
  final int page;
  final int limit;
  final int total;

  bool get hasMore => page * limit < total;
}

/// The only thing the UI/providers depend on. Real, API-backed
/// implementation: [ApiVendorRepository] (see that file).
abstract class VendorRepository {
  /// [category] is now a real MarketplaceSector id (kept named
  /// `category` to match the pre-existing signature — see
  /// [ApiVendorRepository]'s own comment), or null for "all vendors
  /// near the customer" (Home's own unfiltered preview only — see
  /// that call site). Unchanged by the Discovery phase.
  Future<List<Vendor>> getVendors({String? category});

  /// CONFIRMED (Discovery & Ranking): the paginated, sortable,
  /// searchable marketplace listing used by the Vendor List screen —
  /// additive to this interface, `getVendors` above is untouched.
  /// [sort] is `'highestRated'` or `'newest'` (mirrors the backend's
  /// own `VendorSortOption` exactly). [search] below 2 characters has
  /// no effect server-side (see `normalizedSearchTerm` on the
  /// backend) — this method never filters client-side itself.
  ///
  /// LAUNCH TRACK L1-A: [latitude]/[longitude] are OPTIONAL, mirroring
  /// the real backend's own optional query params exactly (Multi-City
  /// / Phase I-B) — omitted when no real Saved Address coordinates are
  /// available, never a fake/zero/placeholder pair. Passing them never
  /// changes ranking/sorting logic itself — that decision belongs
  /// entirely to the backend's own ServiceArea filter, unmodified here.
  /// [subcategoryId] (consolidated customer-commerce milestone, Part E)
  /// is OPTIONAL, same backward-conscious discipline as
  /// [latitude]/[longitude] — omitted, every branch in the sector is
  /// returned (unchanged pre-existing behavior); when set, filters to
  /// branches assigned to that subcategory. Selecting a subcategory
  /// never turns this into a product listing — it stays the exact same
  /// vendor/branch listing shape, just filtered (CONFIRMED navigation
  /// decision: Sector -> Vendors/Stores -> Vendor/Branch -> Products).
  ///
  /// Filters V1: [openNow]/[hasOffers]/[minRating] — all OPTIONAL, all
  /// real backend data (`VendorBranch.isOpen`, real active `Offer`
  /// existence, real `ratingSumStars/ratingCount`). Omitting all three
  /// reproduces the exact pre-Filters-V1 listing.
  Future<VendorListPage> getVendorsPage(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
    String? subcategoryId,
    bool? openNow,
    bool? hasOffers,
    double? minRating,
  });

  /// Full vendor + branch details for the Vendor Details screen. Throws
  /// if [vendorId] doesn't exist — callers handle that via the normal
  /// AsyncValue.error path (see vendor_details_screen.dart).
  Future<VendorDetails> getVendorDetails(String vendorId);
}
