import 'package:flutter/material.dart';
import '../core/theme/hatly_theme.dart';
import '../core/utils/money_formatter.dart';

/// UI/UX-0 Design System. A PURELY VISUAL component — it never
/// computes, derives, or invents a price; it only decides how to
/// render whichever minor-unit values the caller already resolved
/// from the backend. Supports exactly the four price states the
/// approved Design Review identified as needing visual
/// distinction:
///
/// - normal fixed price (finalAmountMinor set, no estimate)
/// - Custom Request, unknown price (finalAmountMinor null, isPending true)
/// - Custom Request, final price known (finalAmountMinor set, isPending false)
/// - Weighted product whose final differs from its initial estimate
///   (both finalAmountMinor and estimatedAmountMinor set — shown as
///   "final (was ~estimate)")
///
/// Never displays an unknown price as "0" — CONFIRMED, the pending
/// branch renders [pendingLabel] text, never a numeric zero.
class HatlyPriceLabel extends StatelessWidget {
  const HatlyPriceLabel({
    super.key,
    this.finalAmountMinor,
    this.estimatedAmountMinor,
    this.isPending = false,
    required this.pendingLabel,
  });

  final int? finalAmountMinor;
  final int? estimatedAmountMinor;
  final bool isPending;
  final String pendingLabel;

  @override
  Widget build(BuildContext context) {
    final priceStyle = Theme.of(context).textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.bold,
          color: HatlyColors.primaryOrangeDark,
        );

    if (isPending || finalAmountMinor == null) {
      return Text(
        pendingLabel,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: HatlyColors.textMuted),
      );
    }

    if (estimatedAmountMinor != null &&
        estimatedAmountMinor != finalAmountMinor) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(formatMinorUnits(finalAmountMinor!, context), style: priceStyle),
          const SizedBox(width: HatlySpacing.xs),
          Text(
            '(~${formatMinorUnits(estimatedAmountMinor!, context)})',
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(decoration: TextDecoration.lineThrough),
          ),
        ],
      );
    }

    return Text(formatMinorUnits(finalAmountMinor!, context),
        style: priceStyle);
  }
}
