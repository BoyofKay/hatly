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
    final p = context.palette;
    // Dark Mode fix: the price text used to hardcode
    // `HatlyColors.primaryOrangeDark` — a shade meant for a PRESSED button
    // state (per its own doc comment in hatly_theme.dart), not idle text,
    // and too dim against a dark background. `p.link` is the theme's own
    // "emphasised orange text" token — identical value in Light Mode,
    // brighter brand orange in Dark Mode.
    final priceStyle = Theme.of(context).textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.bold,
          color: p.link,
        );

    if (isPending || finalAmountMinor == null) {
      return Text(
        pendingLabel,
        style: Theme.of(context)
            .textTheme
            .labelLarge
            ?.copyWith(color: p.textMuted),
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
