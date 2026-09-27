import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_key_value_row.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../../../shared_widgets/ltr_text.dart';
import '../../../orders/presentation/order_eta_text.dart';
import '../../domain/checkout_quote.dart';

/// The delivery (or pickup) estimate: overall ETA, the delivery fee, and an expandable breakdown — base fee, additional-vendor
/// charge, distance and each vendor's preparation time. Every value is the server's; a missing part is simply not shown, and
/// an unknown ETA says so instead of guessing.
class CheckoutDeliverySection extends StatelessWidget {
  const CheckoutDeliverySection({super.key, required this.quote});

  final CheckoutQuote quote;

  @override
  Widget build(BuildContext context) {
    final delivery = quote.delivery;
    if (delivery == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final isPickup = quote.fulfillment?.isPickup ?? false;
    final feeMinor = delivery.feeMinor;
    final hasDetails =
        delivery.hasBreakdown || quote.vendors.any((v) => v.name != null);

    return HatlySection(
      title: isPickup
          ? l10n.checkoutPickupEstimate
          : l10n.checkoutDeliveryEstimate,
      child: HatlySurface(
        padding: EdgeInsets.zero,
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            key: const Key('checkout-delivery-breakdown'),
            tilePadding: const EdgeInsets.symmetric(
                horizontal: HatlySpacing.md, vertical: HatlySpacing.xs),
            childrenPadding: const EdgeInsets.fromLTRB(
                HatlySpacing.md, 0, HatlySpacing.md, HatlySpacing.md),
            // With nothing to expand the tile is a plain summary.
            enabled: hasDetails,
            trailing: hasDetails ? null : const SizedBox.shrink(),
            title: Row(
              children: [
                Icon(Icons.schedule, size: 20, color: p.textMuted),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                  child: Text(quoteEtaLabel(context, delivery.eta),
                      key: const Key('checkout-eta'),
                      style: context.type.title),
                ),
              ],
            ),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: HatlySpacing.xs),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                        isPickup
                            ? l10n.checkoutPickupNoDeliveryFee
                            : l10n.deliveryFee,
                        style: context.type.small),
                  ),
                  if (!isPickup)
                    feeMinor == null
                        ? Flexible(
                            child: Text(l10n.checkoutDeliveryFeePending,
                                textAlign: TextAlign.end,
                                style: context.type.small))
                        : LtrText(formatMinorUnits(feeMinor, context),
                            key: const Key('checkout-delivery-fee'),
                            style: context.type.body
                                .copyWith(fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            children: [
              if (delivery.hasBreakdown) ...[
                _row(context, l10n.checkoutBreakdownBase,
                    delivery.baseFeeMinor!),
                if ((delivery.additionalVendorChargeMinor ?? 0) > 0)
                  _row(
                      context,
                      l10n.checkoutBreakdownAdditionalVendors(
                          delivery.vendorCount - 1),
                      delivery.additionalVendorChargeMinor!),
                if (delivery.distanceMeters != null)
                  HatlyKeyValueRow(
                    label: l10n.checkoutBreakdownDistance,
                    value: l10n.checkoutDistanceKm(
                        (delivery.distanceMeters! / 1000).toStringAsFixed(1)),
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    style: context.type.small,
                  ),
              ],
              if (quote.vendors.any((v) => v.name != null)) ...[
                const SizedBox(height: HatlySpacing.sm),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(l10n.checkoutVendorPreparation,
                      style: context.type.caption),
                ),
                for (final vendor in quote.vendors.where((v) => v.name != null))
                  HatlyKeyValueRow(
                    label: vendor.name!,
                    ltr: false,
                    padding: const EdgeInsets.symmetric(vertical: 2),
                    style: context.type.small,
                    value: vendor.preparationMinutes == null
                        ? l10n.checkoutPreparationUnknown
                        : l10n.checkoutPreparationMinutes(
                            vendor.preparationMinutes!),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _row(BuildContext context, String label, int amountMinor) =>
      HatlyKeyValueRow(
        label: label,
        value: formatMinorUnits(amountMinor, context),
        padding: const EdgeInsets.symmetric(vertical: 2),
        style: context.type.small,
      );
}
