/// Customer-facing vendor summary, as it will eventually come from a
/// real `GET /vendors` endpoint (not implemented on the backend yet —
/// see FixtureVendorRepository). Field shapes deliberately mirror the
/// backend's actual `Vendor`/`VendorBranch` entities and the API
/// contract (money as integer minor units, plain string category —
/// there's no VendorCategory table yet either) so that wiring up the
/// real endpoint later is a data-source swap, not a model rewrite.
class Vendor {
  const Vendor({
    required this.id,
    required this.name,
    this.nameAr,
    required this.category,
    this.logoUrl,
    required this.ratingAverage,
    required this.ratingCount,
    required this.etaMinMinutes,
    required this.etaMaxMinutes,
    required this.deliveryFeeMinor,
    required this.isOpen,
    this.hasPromotion = false,
    this.coverImageUrl,
  });

  final String id;
  final String name;
  final String? nameAr;
  final String
      category; // matches backend Vendor.category: plain string, no enum/table yet
  final String? logoUrl;
  final double ratingAverage;
  final int ratingCount;
  final int etaMinMinutes;
  final int etaMaxMinutes;
  final int
      deliveryFeeMinor; // integer minor units — see core/utils/money_formatter.dart
  final bool isOpen;
  final bool hasPromotion;

  /// Optional cover photo for the marketplace vendor card. The backend does not
  /// return one yet — `null` renders the soft placeholder, so the field can be
  /// wired later without touching any widget.
  final String? coverImageUrl;
}
