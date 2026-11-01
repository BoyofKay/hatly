import '../../../core/network/api_client.dart';
import '../domain/vendor.dart';
import '../domain/vendor_details.dart';
import '../domain/vendor_profile.dart';
import '../domain/vendor_branch_summary.dart';
import 'vendor_repository.dart';

/// Real implementation of [VendorRepository] for the marketplace
/// listing — calls the actual `GET /vendors?sectorId=X` endpoint
/// implemented in this same phase
/// (marketplace-vendors.controller.ts / marketplace-vendors.service.ts).
///
/// LAUNCH TRACK L1-B: [getVendorDetails] now calls the real
/// `GET /vendor-branches/:id` endpoint — the FixtureVendorRepository
/// delegation is REMOVED. A real id (confirmed: the `/vendors` list's
/// own `id` field is already the VendorBranch id, not a Vendor id —
/// see MarketplaceVendorsService's own `id: branch.id` mapping) now
/// resolves real data; a nonexistent id throws a real 404 via the
/// existing ApiClient error path, never a silent fixture fallback.
class ApiVendorRepository implements VendorRepository {
  ApiVendorRepository(this._client);

  final ApiClient _client;

  /// [category], despite its name (kept to match [VendorRepository]'s
  /// existing signature exactly — see that file's own comment), is now
  /// a MarketplaceSector id, not a fixture category string.
  ///
  /// `null` (Home's own unfiltered "vendors near you" preview section
  /// — see `home_screen.dart`) is NOT supported by the real endpoint
  /// yet: `GET /vendors` requires a `sectorId` (see
  /// MarketplaceVendorsController) — an unfiltered "all vendors near
  /// me" marketplace view is a future Discovery-chunk concern, not
  /// this taxonomy chunk's. Returns an empty list rather than
  /// throwing, so that still-existing call site degrades gracefully
  /// into its own already-built "no vendors found" empty state instead
  /// of a permanent error banner on Home.
  @override
  Future<List<Vendor>> getVendors({String? category}) async {
    if (category == null) {
      return const [];
    }

    return _client.request(
      (dio) => dio.get('/vendors', queryParameters: {'sectorId': category}),
      (data) => (data['data'] as List)
          .map((e) => _toVendor(e as Map<String, dynamic>))
          .toList(),
    );
  }

  /// [vendorId] is actually a VendorBranch id (see this class's own
  /// top comment). `ratingAverage` and `ratingCount` come pre-computed
  /// from the backend (same `ratingSumStars/ratingCount` formula
  /// `MarketplaceVendorsService` already uses for the list) — no
  /// client-side rating math. `etaMinMinutes`/`etaMaxMinutes`/
  /// `deliveryFeeMinor` remain explicit `0` placeholders and
  /// `hasPromotion` remains `false` — CONFIRMED (L1-B design review):
  /// none of these are backed by a real schema/endpoint yet; this
  /// preserves the exact same existing compatibility placeholders the
  /// list mapping (`_toVendor` below) already uses, not a new
  /// fabrication introduced here.
  @override
  Future<VendorDetails> getVendorDetails(String vendorId) {
    return _client.request(
      (dio) => dio.get('/vendor-branches/$vendorId'),
      (data) {
        final json = data['data'] as Map<String, dynamic>;
        final vendorJson = json['vendor'] as Map<String, dynamic>;
        final openingHoursJson = json['openingHours'] as Map<String, dynamic>;

        return VendorDetails(
          vendor: VendorProfile(
            id: vendorJson['id'] as String,
            name: vendorJson['name'] as String,
            nameAr: vendorJson['nameAr'] as String?,
            category:
                '', // same as _toVendor below — no longer sourced from the legacy Vendor.category column
            logoUrl: vendorJson['logoUrl'] as String?,
          ),
          branch: VendorBranchSummary(
            id: json['id'] as String,
            vendorId: vendorJson['id'] as String,
            name: vendorJson['name']
                as String, // no separate branch display-name field on the backend yet
            address: json['address'] as String,
            latitude: (json['latitude'] as num).toDouble(),
            longitude: (json['longitude'] as num).toDouble(),
            isOpen: json['isOpen'] as bool,
            allowsCustomRequests:
                json['allowsCustomRequests'] as bool? ?? false,
            openingHours: openingHoursJson.map(
              (day, hours) => MapEntry(
                day,
                OpeningHoursRange(
                  open: (hours as Map<String, dynamic>)['open'] as String,
                  close: hours['close'] as String,
                ),
              ),
            ),
          ),
          ratingAverage: (json['ratingAverage'] as num).toDouble(),
          ratingCount: json['ratingCount'] as int,
          etaMinMinutes: 0,
          etaMaxMinutes: 0,
          deliveryFeeMinor: 0,
          hasPromotion: false,
        );
      },
    );
  }

  /// CONFIRMED (Discovery & Ranking): the real paginated/sortable/
  /// searchable marketplace listing — `sort`/`search`/`page`/`limit`
  /// flow straight through to the real backend query parameters,
  /// never computed or re-ordered client-side.
  @override
  Future<VendorListPage> getVendorsPage(
    String sectorId, {
    String? sort,
    String? search,
    int page = 1,
    int limit = 20,
    double? latitude,
    double? longitude,
    String? deliveryZoneId,
    String? subcategoryId,
    bool? openNow,
    bool? hasOffers,
    double? minRating,
  }) async {
    // LAUNCH TRACK L1-A CORRECTION: coordinates are sent as an atomic
    // pair — never independently. If either is null, neither is sent;
    // a partial pair would be worse than none (a bare latitude or
    // longitude is meaningless to the backend's point-in-radius
    // ServiceArea check). No fake/default/zero value is substituted
    // for a missing half of the pair.
    final hasCoordinates = latitude != null && longitude != null;

    return _client.request(
      (dio) => dio.get(
        '/vendors',
        queryParameters: {
          'sectorId': sectorId,
          if (sort != null) 'sort': sort,
          if (search != null && search.isNotEmpty) 'search': search,
          'page': page,
          'limit': limit,
          if (hasCoordinates) 'latitude': latitude,
          if (hasCoordinates) 'longitude': longitude,
          if (deliveryZoneId != null) 'deliveryZoneId': deliveryZoneId,
          if (subcategoryId != null) 'subcategoryId': subcategoryId,
          // Filters V1.
          if (openNow == true) 'openNow': 'true',
          if (hasOffers == true) 'hasOffers': 'true',
          if (minRating != null) 'minRating': minRating,
        },
      ),
      (data) {
        final meta = data['meta'] as Map<String, dynamic>;
        return VendorListPage(
          data: (data['data'] as List)
              .map((e) => _toVendor(e as Map<String, dynamic>))
              .toList(),
          page: meta['page'] as int,
          limit: meta['limit'] as int,
          total: meta['total'] as int,
        );
      },
    );
  }

  /// Maps `MarketplaceVendorView` (backend) -> `Vendor` (Flutter). The
  /// foundational listing endpoint deliberately does not compute
  /// delivery-fee/ETA (both require a customer location context this
  /// endpoint doesn't take — a Discovery-chunk concern) or a
  /// promotion badge (Offers integration is out of this chunk's
  /// scope) — placeholders are used for those specific fields only,
  /// clearly not real business values, so the existing `VendorCard`
  /// widget (which expects them as non-nullable) doesn't break.
  /// The one mapping from a backend vendor-listing JSON to [Vendor] — also used by the Home aggregation response.
  static Vendor vendorFromJson(Map<String, dynamic> json) => _toVendor(json);

  static Vendor _toVendor(Map<String, dynamic> json) {
    return Vendor(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      category:
          '', // no longer sourced from the legacy Vendor.category column — unused by any real UI rendering
      logoUrl: json['logoUrl'] as String?,
      ratingAverage: (json['ratingAverage'] as num).toDouble(),
      ratingCount: json['ratingCount'] as int,
      etaMinMinutes:
          0, // not yet computed by the foundational endpoint — see this method's own comment
      etaMaxMinutes: 0,
      deliveryFeeMinor: 0,
      isOpen: json['isOpen'] as bool,
      // Filters V1: real data now (`MarketplaceVendorView.hasOffer`) — a currently-active Offer for
      // this branch, batch-resolved server-side. Read defensively (`?? false`) so an older cached
      // response shape (before this field existed) still degrades safely.
      hasPromotion: json['hasOffer'] as bool? ?? false,
    );
  }
}
