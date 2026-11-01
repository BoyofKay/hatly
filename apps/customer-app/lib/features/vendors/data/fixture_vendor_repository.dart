import '../domain/vendor.dart';
import '../domain/vendor_details.dart';
import '../domain/vendor_profile.dart';
import '../domain/vendor_branch_summary.dart';
import 'vendor_repository.dart';

/// ============================================================
/// TEMPORARY PRESENTATION FIXTURE — NOT REAL BACKEND DATA.
/// ============================================================
///
/// The backend has no vendor-listing endpoint yet (the `vendors`
/// NestJS module only registers TypeORM entities — see
/// `apps/backend/src/modules/vendors/vendors.module.ts` — there is no
/// controller). Per the Phase 2B brief: "Do not invent backend
/// endpoints that don't exist" / "do not fabricate data as if it came
/// from the backend."
///
/// This class exists ONLY so the UI/presentation layer has something
/// to render while that endpoint doesn't exist, and is deliberately:
///   - kept out of `domain/` entirely (the `Vendor` model itself is
///     real/future-API-shaped; only this data source is fake)
///   - the ONLY implementation of `VendorRepository` right now
///   - swappable for a real `ApiVendorRepository` later via a single
///     line in `vendor_providers.dart`, with no UI change required
///
/// The artificial delay simulates real network latency so the
/// loading/skeleton state in the UI is actually exercised rather than
/// resolving instantly.
class FixtureVendorRepository implements VendorRepository {
  static final List<Vendor> _all = [
    const Vendor(
      id: 'fixture-vendor-1',
      name: 'Al Salam Grill',
      nameAr: 'مشويات السلام',
      category: 'restaurants',
      ratingAverage: 4.6,
      ratingCount: 312,
      etaMinMinutes: 25,
      etaMaxMinutes: 35,
      deliveryFeeMinor: 1500,
      isOpen: true,
      hasPromotion: true,
    ),
    const Vendor(
      id: 'fixture-vendor-2',
      name: 'Cairo Bakery House',
      nameAr: 'بيت القاهرة للمخبوزات',
      category: 'bakery',
      ratingAverage: 4.8,
      ratingCount: 154,
      etaMinMinutes: 15,
      etaMaxMinutes: 25,
      deliveryFeeMinor: 1000,
      isOpen: true,
    ),
    const Vendor(
      id: 'fixture-vendor-3',
      name: 'Fresh Mart Groceries',
      nameAr: 'فريش مارت للبقالة',
      category: 'groceries',
      ratingAverage: 4.3,
      ratingCount: 89,
      etaMinMinutes: 30,
      etaMaxMinutes: 45,
      deliveryFeeMinor: 2000,
      isOpen: false,
    ),
    const Vendor(
      id: 'fixture-vendor-4',
      name: 'Nile Pharmacy',
      nameAr: 'صيدلية النيل',
      category: 'pharmacy',
      ratingAverage: 4.9,
      ratingCount: 421,
      etaMinMinutes: 20,
      etaMaxMinutes: 30,
      deliveryFeeMinor: 1200,
      isOpen: true,
    ),
    const Vendor(
      id: 'fixture-vendor-5',
      name: 'Sweet Corner Desserts',
      nameAr: 'ركن الحلويات',
      category: 'desserts',
      ratingAverage: 4.5,
      ratingCount: 203,
      etaMinMinutes: 20,
      etaMaxMinutes: 30,
      deliveryFeeMinor: 1500,
      isOpen: true,
      hasPromotion: true,
    ),
    const Vendor(
      id: 'fixture-vendor-6',
      name: 'Quick Bite Express',
      nameAr: 'كويك بايت إكسبريس',
      category: 'fast_food',
      ratingAverage: 4.1,
      ratingCount: 67,
      etaMinMinutes: 15,
      etaMaxMinutes: 20,
      deliveryFeeMinor: 1000,
      isOpen: true,
    ),
    const Vendor(
      id: 'fixture-vendor-7',
      name: 'Refresh Juice Bar',
      nameAr: 'ريفريش بار العصائر',
      category: 'drinks',
      ratingAverage: 4.7,
      ratingCount: 145,
      etaMinMinutes: 10,
      etaMaxMinutes: 20,
      deliveryFeeMinor: 800,
      isOpen: false,
    ),
  ];

  @override
  Future<List<Vendor>> getVendors({String? category}) async {
    await Future.delayed(const Duration(milliseconds: 700));

    if (category == null) return List.unmodifiable(_all);
    return List.unmodifiable(_all.where((v) => v.category == category));
  }

  /// Fixture-only, simplified — no sort/search filtering, no longer
  /// the active implementation for the Vendor List screen (see
  /// ApiVendorRepository). Kept only to satisfy the interface.
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
    await Future.delayed(const Duration(milliseconds: 700));
    final matching = _all.where((v) => v.category == sectorId).toList();
    final start = (page - 1) * limit;
    final end = (start + limit).clamp(0, matching.length);
    final pageItems =
        start >= matching.length ? <Vendor>[] : matching.sublist(start, end);
    return VendorListPage(
        data: pageItems, page: page, limit: limit, total: matching.length);
  }

  // Fixed 09:00-23:00 every day for every fixture vendor — sufficient
  // to exercise the UI's "hours today" display without modeling real
  // per-day variation, which the backend's actual openingHours jsonb
  // already supports whenever a real API exists.
  static const _standardHours =
      OpeningHoursRange(open: '09:00', close: '23:00');
  static final _weeklyHours = {
    for (final day in ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
      day: _standardHours,
  };

  /// The app currently supports exactly one branch per vendor — see
  /// the "known limitation" note in vendor_branch_summary.dart. This
  /// synthesizes that one branch deterministically from the vendor's
  /// own fixture data rather than adding a second, separately-curated
  /// fixture list to keep in sync by hand.
  @override
  Future<VendorDetails> getVendorDetails(String vendorId) async {
    await Future.delayed(const Duration(milliseconds: 500));

    Vendor? vendor;
    for (final v in _all) {
      if (v.id == vendorId) {
        vendor = v;
        break;
      }
    }
    if (vendor == null) {
      throw StateError('No fixture vendor found for id "$vendorId".');
    }

    final branch = VendorBranchSummary(
      id: '${vendor.id}-branch-1',
      vendorId: vendor.id,
      name: '${vendor.name} — Main Branch',
      address: '12 Market Street',
      latitude: 30.4181,
      longitude: 31.5626,
      isOpen: vendor.isOpen,
      openingHours: _weeklyHours,
    );

    return VendorDetails(
      vendor: VendorProfile(
        id: vendor.id,
        name: vendor.name,
        nameAr: vendor.nameAr,
        category: vendor.category,
        logoUrl: vendor.logoUrl,
      ),
      branch: branch,
      ratingAverage: vendor.ratingAverage,
      ratingCount: vendor.ratingCount,
      etaMinMinutes: vendor.etaMinMinutes,
      etaMaxMinutes: vendor.etaMaxMinutes,
      deliveryFeeMinor: vendor.deliveryFeeMinor,
      hasPromotion: vendor.hasPromotion,
    );
  }
}
