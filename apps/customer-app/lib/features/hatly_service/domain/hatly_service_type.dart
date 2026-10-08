/// Standalone Hatly Service ("AD_HOC_SERVICE" cart group). NOT the
/// Vendor/Pharmacy Custom Request (`CustomRequestAction` /
/// `addVendorCustomItem` — always attached to a vendor's own CATALOG
/// group, untouched by this feature) — this is the other, previously
/// unbuilt concept: a customer request that is not attached to any
/// vendor catalog at all.
///
/// Mirrors the backend's `AdHocServiceType` enum
/// (`cart/ad-hoc-service-type.enum.ts`) exactly, as a raw String per
/// this codebase's own convention (see `cart.dart`'s top-of-file
/// comment) — never a Dart `enum`, so a value round-trips through
/// `CartGroup.adHocServiceType`/JSON with no mapping layer.
library;

class HatlyServiceType {
  HatlyServiceType._();

  /// "هاتلي من مكان" — the customer describes an item; Hatly buys/picks
  /// it up from a place. The PICKUP location (the place) is REQUIRED —
  /// a missing one is rejected at checkout (`BUY_FROM_PLACE_PICKUP_REQUIRED`),
  /// never replaced by a Hatly default; the destination is always the
  /// customer's own delivery address and is never collected here (see
  /// cart.service.ts `addAdHocItem` — a destination pair is rejected with
  /// `LOCATION_DOES_NOT_MATCH_SERVICE_TYPE`).
  static const String buyFromPlace = 'BUY_FROM_PLACE';

  /// "وصلي لمكان" — Hatly delivers something to a place. Only a
  /// DESTINATION location is REQUIRED — a missing one is rejected at
  /// checkout (`DELIVER_TO_PLACE_DESTINATION_REQUIRED`), never replaced by
  /// a Hatly default; a pickup pair is never collected for this type (the
  /// customer's own checkout delivery address is always the starting
  /// point, never re-entered here).
  static const String deliverToPlace = 'DELIVER_TO_PLACE';

  static const List<String> all = [buyFromPlace, deliverToPlace];
}
