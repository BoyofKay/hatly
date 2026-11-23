import 'vendor_branch_summary.dart';

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
    this.vendorId,
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
    this.openingHours = const {},
  });

  /// Branch id used for navigation, cart and product loading. */
  final String id;
  /// Owning vendor id used only for vendor-level favorites. */
  final String? vendorId;
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

  /// Weekly working hours (empty = no hour limit) — today's are shown on the card and in the "closed" popup.
  final Map<String, OpeningHoursRange> openingHours;
}
