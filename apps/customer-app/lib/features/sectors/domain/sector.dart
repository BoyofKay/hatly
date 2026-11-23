/// Mirrors the real `GET /sectors` response field-for-field (see
/// `apps/backend/src/modules/sectors/entities/marketplace-sector.entity.ts`).
/// Replaces `home/data/category_fixture.dart`'s static list — that
/// file's own comment says outright the fixture categories are
/// "TEMPORARY... NOT A BUSINESS DECISION." The real sector list is
/// dynamic Admin-configured data; nothing about it is hardcoded here.
class MarketplaceSector {
  const MarketplaceSector({
    required this.id,
    required this.name,
    this.nameAr,
    required this.slug,
    required this.sortOrder,
    this.imageUrl,
    this.bannerUrl,
    this.accentColor,
  });

  final String id;
  final String name;
  final String? nameAr;

  /// Stable identifier — this is what a local presentation icon
  /// mapping keys off (see `sectorIcon` in
  /// `home_category_section.dart`), never the display `name`, which
  /// Admin can freely rename without breaking anything.
  final String slug;
  final int sortOrder;

  /// Optional category photo (Image Tile). Not returned by the backend yet;
  /// read defensively so it lights up as soon as it is.
  final String? imageUrl;
  final String? bannerUrl;
  final String? accentColor;

  factory MarketplaceSector.fromJson(Map<String, dynamic> json) {
    return MarketplaceSector(
      id: json['id'] as String,
      name: json['name'] as String,
      nameAr: json['nameAr'] as String?,
      slug: json['slug'] as String,
      sortOrder: json['sortOrder'] as int,
      imageUrl: json['imageUrl'] as String?,
      bannerUrl: json['bannerUrl'] as String?,
      accentColor: json['accentColor'] as String?,
    );
  }
}
