/// Mirrors the real `GET /sectors/:sectorId/subcategories` response
/// field-for-field (see
/// `apps/backend/src/modules/sectors/entities/marketplace-subcategory.entity.ts`).
/// Consolidated customer-commerce milestone, Part E — a real,
/// Admin-managed Level-1.5 taxonomy WITHIN an existing
/// [MarketplaceSector], never hardcoded here.
class MarketplaceSubcategory {
  const MarketplaceSubcategory({
    required this.id,
    required this.name,
    this.nameAr,
    required this.sortOrder,
    this.imageUrl,
  });

  final String id;
  final String name;
  final String? nameAr;
  final int sortOrder;

  /// Optional icon/photo — not seeded with a real asset yet (see the
  /// backend seed script's own comment); read defensively so it lights
  /// up as soon as a real one is set, same convention as
  /// `MarketplaceSector.imageUrl`.
  final String? imageUrl;

  factory MarketplaceSubcategory.fromJson(Map<String, dynamic> json) {
    return MarketplaceSubcategory(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      sortOrder: json['sortOrder'] as int,
      imageUrl: json['imageUrl'] as String?,
    );
  }
}
