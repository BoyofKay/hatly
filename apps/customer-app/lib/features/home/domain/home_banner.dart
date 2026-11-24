/// Where tapping a banner leads (mirrors the backend's `HomeBannerActionType`; there is deliberately no external link).
enum HomeBannerAction { none, product, vendor, sector }

/// An admin-managed promotional banner on Home (`GET /home-banners`). Only banners the server considers eligible right now ever
/// arrive here; the app adds no filtering of its own beyond refusing items it cannot display safely.
class HomeBanner {
  const HomeBanner({
    required this.id,
    required this.title,
    this.titleAr,
    required this.imageUrl,
    this.imageUrlAr,
    this.action = HomeBannerAction.none,
    this.targetId,
    this.sectorId,
  });

  final String id;
  final String title;
  final String? titleAr;

  /// The server's stable upload reference (`/uploads/files/<name>`) or an absolute URL; resolved by the shared media resolver.
  final String imageUrl;
  final String? imageUrlAr;

  String localizedImage(bool arabic) => arabic && imageUrlAr != null && imageUrlAr!.trim().isNotEmpty ? imageUrlAr! : imageUrl;
  final HomeBannerAction action;
  final String? targetId;
  final String? sectorId;

  /// The accessible description / label in the app's language (Arabic when the admin gave one).
  String displayTitle(bool arabic) =>
      arabic && titleAr != null && titleAr!.trim().isNotEmpty
          ? titleAr!
          : title;

  bool get isTappable =>
      action != HomeBannerAction.none &&
      targetId != null &&
      targetId!.isNotEmpty;

  /// Null when the item is unusable (no id/title/image) — the caller drops it instead of failing the whole list.
  static HomeBanner? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final title = raw['title'];
    final imageUrl = raw['imageUrl'];
    if (id is! String ||
        id.isEmpty ||
        title is! String ||
        title.trim().isEmpty ||
        imageUrl is! String ||
        imageUrl.trim().isEmpty) {
      return null;
    }
    final action = switch (raw['actionType']) {
      'PRODUCT' => HomeBannerAction.product,
      'VENDOR' => HomeBannerAction.vendor,
      'SECTOR' => HomeBannerAction.sector,
      _ => HomeBannerAction.none,
    };
    final target = raw['actionTargetId'];
    return HomeBanner(
      id: id,
      title: title.trim(),
      titleAr:
          raw['titleAr'] is String ? (raw['titleAr'] as String).trim() : null,
      imageUrl: imageUrl.trim(),
      imageUrlAr: raw['imageUrlAr'] is String ? (raw['imageUrlAr'] as String).trim() : null,
      action: action,
      // A destination type this app version does not know, or one without a target, simply makes the banner non-tappable.
      targetId: target is String && target.isNotEmpty ? target : null,
      sectorId: raw['sectorId'] is String ? raw['sectorId'] as String : null,
    );
  }
}
