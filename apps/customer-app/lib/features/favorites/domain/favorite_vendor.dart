/// Favorites Chunk 2. The backend's `FavoriteVendorView`
/// (customer-orders.service.ts-style read model, see
/// favorites.service.ts on the backend) doesn't map cleanly onto
/// either existing Vendor domain model — `Vendor` (used for
/// discovery listings) carries fields Favorites never returns
/// (`isOpen`/rating placeholders/etc.), and `VendorProfile` lacks
/// `isActive`/`favoritedAt` entirely — so this is a small, dedicated
/// mapping rather than a forced reuse of either.
///
/// `isActive` is read live from the real Vendor record by the
/// backend at request time (never a stale snapshot) — a Vendor that
/// becomes inactive after being favorited still appears here with
/// `isActive: false`, per the approved product decision.
class FavoriteVendor {
  const FavoriteVendor({
    required this.vendorId,
    this.branchId,
    required this.name,
    this.nameAr,
    this.logoUrl,
    required this.isActive,
    required this.favoritedAt,
  });

  final String vendorId;
  /// Branch route is distinct from vendor-level favorite identity. */
  final String? branchId;
  final String name;
  final String? nameAr;
  final String? logoUrl;
  final bool isActive;
  final DateTime favoritedAt;

  factory FavoriteVendor.fromJson(Map<String, dynamic> json) {
    return FavoriteVendor(
      vendorId: json['vendorId'] as String,
      branchId: json['branchId'] as String?,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      logoUrl: json['logoUrl'] as String?,
      isActive: json['isActive'] as bool,
      favoritedAt: DateTime.parse(json['favoritedAt'] as String),
    );
  }
}
