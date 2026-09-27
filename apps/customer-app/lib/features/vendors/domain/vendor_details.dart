import 'vendor_profile.dart';
import 'vendor_branch_summary.dart';

/// What the Vendor Details screen renders: the vendor's brand identity
/// plus the (currently: one and only) branch's operational info, kept
/// as two nested objects rather than one flattened class — see
/// vendor_profile.dart / vendor_branch_summary.dart for why conflating
/// them would misrepresent the real Vendor/VendorBranch relationship.
///
/// [ratingAverage], [ratingCount], [etaMinMinutes], [etaMaxMinutes],
/// and [deliveryFeeMinor] are carried over from the Phase 2B vendor
/// card model for display consistency (a customer taps a card showing
/// these and should see the same numbers on the details screen) but
/// — same caveat as Phase 2B — none of them are backed by a real
/// schema yet: there's no Review/Rating table, and no
/// DeliveryFee/ServiceArea table either. Not new to this phase, just
/// carried forward and re-flagged.
class VendorDetails {
  const VendorDetails({
    required this.vendor,
    required this.branch,
    required this.ratingAverage,
    required this.ratingCount,
    required this.etaMinMinutes,
    required this.etaMaxMinutes,
    required this.deliveryFeeMinor,
    this.hasPromotion = false,
  });

  final VendorProfile vendor;
  final VendorBranchSummary branch;
  final double ratingAverage;
  final int ratingCount;
  final int etaMinMinutes;
  final int etaMaxMinutes;
  final int deliveryFeeMinor;
  final bool hasPromotion;
}
