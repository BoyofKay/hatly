import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_key_value_row.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../../cart/domain/cart.dart';
import '../../domain/checkout_quote.dart';

/// What is being bought, grouped by vendor, from the cart the server already holds. Read-only: no price is computed here —
/// a line shows the cart's own line total, or the honest "pending" text when the price is not known yet.
class CheckoutItemsSummary extends StatelessWidget {
  const CheckoutItemsSummary({super.key, required this.cart});

  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (cart.groups.isEmpty) return const SizedBox.shrink();
    return HatlySection(
      title: l10n.checkoutOrderSummary,
      child: Column(
        children: [
          for (final group in cart.groups)
            Padding(
              padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
              child: HatlySurface(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(group.vendorName ?? group.adHocPlaceName ?? l10n.cart,
                        style: context.type.title),
                    const SizedBox(height: HatlySpacing.xs),
                    for (final item in group.items)
                      _ItemRow(
                          item: item, isAdHocService: group.isAdHocService),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({required this.item, required this.isAdHocService});

  final CartItem item;
  final bool isAdHocService;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isCustomRequest = item.isAdHoc && !isAdHocService;
    final name = item.productName ?? item.freeTextDescription ?? '';
    final quantity = item.isWeighted
        ? '${l10n.orderRequestedWeightLabel}: ${((item.requestedWeightGrams ?? 0) / 1000).toStringAsFixed(2)} kg'
        : 'x${item.quantity}';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: HatlySpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: context.type.body),
                if (isCustomRequest)
                  Text(l10n.cartCustomRequestBadge, style: context.type.caption)
                else
                  LtrText(quantity, style: context.type.caption),
              ],
            ),
          ),
          if (item.lineTotalMinor != null)
            LtrText(formatMinorUnits(item.lineTotalMinor!, context),
                style: context.type.small.copyWith(color: p.textPrimary))
          else if (isCustomRequest)
            Text(l10n.cartCustomRequestPricePending,
                style: context.type.caption)
          else if (isAdHocService)
            // A Hatly Service request: an explicit pending price (never a 0), confirmed while the order is prepared.
            Flexible(
              child: Text(l10n.hatlyServicePricePending,
                  key: const Key('checkout-item-price-pending'),
                  textAlign: TextAlign.end,
                  style: context.type.caption),
            ),
        ],
      ),
    );
  }
}

/// The server's totals: subtotal, discount, delivery fee, wallet, total and what is still due.
class CheckoutTotals extends StatelessWidget {
  const CheckoutTotals({super.key, required this.quote});

  final CheckoutQuote quote;

  @override
  Widget build(BuildContext context) {
    final summary = quote.summary;
    if (summary == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isPickup = quote.fulfillment?.isPickup ?? false;

    Widget row(String label, String value,
        {Color? color, bool bold = false, Key? valueKey, bool ltr = true}) {
      return HatlyKeyValueRow(
        label: label,
        value: value,
        ltr: ltr,
        valueKey: valueKey,
        style: (bold ? context.type.title : context.type.body)
            .copyWith(color: color),
      );
    }

    return HatlySurface(
      key: const Key('checkout-totals'),
      child: Column(
        children: [
          // Pending Hatly Service price: the server's subtotal is 0 only because nothing is priced yet — shown as the pending state,
          // never as a zero that would read as free.
          quote.hasPendingPricing
              ? row(l10n.checkoutSubtotalLabel, l10n.hatlyServicePricePending,
                  ltr: false, valueKey: const Key('checkout-subtotal-pending'))
              : row(l10n.checkoutSubtotalLabel,
                  formatMinorUnits(summary.subtotalMinor, context)),
          if (summary.discountMinor > 0)
            row(l10n.orderDiscountLabel,
                '-${formatMinorUnits(summary.discountMinor, context)}',
                color: p.success),
          if (!isPickup)
            summary.deliveryFeeMinor != null
                ? row(l10n.deliveryFee,
                    formatMinorUnits(summary.deliveryFeeMinor!, context))
                : row(l10n.deliveryFee, l10n.checkoutDeliveryFeePending,
                    ltr: false),
          if (summary.walletAppliedMinor > 0)
            row(l10n.checkoutWalletApplied,
                '-${formatMinorUnits(summary.walletAppliedMinor, context)}',
                color: p.success),
          const Divider(height: HatlySpacing.lg),
          row(
              l10n.orderTotalLabel,
              summary.totalMinor == null
                  ? (quote.hasPendingPricing
                      ? l10n.hatlyServicePricePending
                      : l10n.checkoutTotalPending)
                  : formatMinorUnits(summary.totalMinor!, context),
              bold: true,
              ltr: summary.totalMinor != null),
          if (summary.walletAppliedMinor > 0 && summary.amountDueMinor != null)
            row(l10n.checkoutAmountDue,
                formatMinorUnits(summary.amountDueMinor!, context)),
        ],
      ),
    );
  }
}
