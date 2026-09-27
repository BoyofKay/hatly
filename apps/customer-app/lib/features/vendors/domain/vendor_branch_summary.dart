/// A single physical branch's operational details — mirrors the
/// backend's `VendorBranch` entity (address, lat/long, openingHours,
/// isOpen). This is what a customer actually orders from (backend
/// `Order.vendorBranchId` references this, never a bare vendor id) —
/// never merge these fields onto [VendorProfile].
///
/// The app currently only supports one branch per vendor in the UI
/// (see FixtureVendorRepository) — a real multi-branch "choose your
/// nearest branch" flow is out of scope for Phase 2C and is called out
/// as a known limitation.
class VendorBranchSummary {
  const VendorBranchSummary({
    required this.id,
    required this.vendorId,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    required this.isOpen,
    required this.openingHours,
  });

  final String id;
  final String vendorId;
  final String name; // e.g. "Downtown Branch" — not the vendor's brand name
  final String address;
  final double latitude;
  final double longitude;
  final bool isOpen;

  /// Day key ('mon'..'sun') -> {open, close} in 24h "HH:mm", matching
  /// the backend's `opening_hours` jsonb shape.
  final Map<String, OpeningHoursRange> openingHours;
}

class OpeningHoursRange {
  const OpeningHoursRange({required this.open, required this.close});
  final String open;
  final String close;
}
