/// Brand-level vendor identity — mirrors the backend's `Vendor` entity
/// exactly (name, nameAr, category, logoUrl). Deliberately does NOT
/// include anything branch-specific (address, hours, open/closed,
/// minimum order) — those belong to [VendorBranchSummary]. A vendor
/// can have multiple branches; this class represents the one thing
/// that's shared across all of them.
class VendorProfile {
  const VendorProfile({
    required this.id,
    required this.name,
    this.nameAr,
    required this.category,
    this.logoUrl,
  });

  final String id;
  final String name;
  final String? nameAr;
  final String category;
  final String? logoUrl;
}
