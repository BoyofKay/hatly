import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';
import 'hatly_chip.dart';

/// UI/UX-2. Thin wrapper around HatlyChip's availability variant —
/// CONFIRMED, receives the actual availability boolean from its
/// caller (e.g. VendorBranchSummary.isOpen, itself real backend
/// data) and performs no business-availability logic of its own.
/// Open uses HatlyColors.success; closed uses
/// HatlyColors.closedUnavailable — NEVER red, which stays reserved
/// for errors/destructive/Flash Sale semantics.
class AvailabilityBadge extends StatelessWidget {
  const AvailabilityBadge(
      {super.key,
      required this.isOpen,
      required this.openLabel,
      required this.closedLabel});

  final bool isOpen;
  final String openLabel;
  final String closedLabel;

  @override
  Widget build(BuildContext context) {
    return HatlyChip(
      label: isOpen ? openLabel : closedLabel,
      variant: HatlyChipVariant.availability,
      selected: true,
      color: isOpen ? HatlyColors.success : HatlyColors.closedUnavailable,
    );
  }
}
