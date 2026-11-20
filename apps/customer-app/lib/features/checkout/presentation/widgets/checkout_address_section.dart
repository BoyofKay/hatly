import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../domain/checkout_quote.dart';

/// Where the order goes (Delivery) or where it is collected (Pickup). For delivery it shows the address exactly as it would
/// be frozen on the order, tells the customer when it is their default, and states plainly when it cannot be served.
class CheckoutAddressSection extends StatelessWidget {
  const CheckoutAddressSection({
    super.key,
    required this.quote,
    required this.onPickAddress,
  });

  final CheckoutQuote quote;
  final VoidCallback onPickAddress;

  String _eligibilityMessage(AppLocalizations l10n, QuoteEligibility e) {
    switch (e.code) {
      case 'VENDOR_DOES_NOT_DELIVER':
        return l10n.checkoutAddressVendorDoesNotDeliver;
      case 'VENDOR_OUTSIDE_DELIVERY_AREA':
        return l10n.checkoutAddressVendorOutsideArea;
      // PD-009: a pin-less address needs its delivery zone; a deactivated zone is never silently replaced.
      case 'ADDRESS_ZONE_REQUIRED':
        return l10n.checkoutAddressZoneRequired;
      case 'DELIVERY_ZONE_UNAVAILABLE':
        return l10n.checkoutAddressZoneUnavailable;
      default:
        return l10n.checkoutAddressOutOfServiceArea;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final fulfillment = quote.fulfillment;

    if (fulfillment != null && fulfillment.isPickup) {
      final branch = fulfillment.pickupBranch;
      return HatlySection(
        title: l10n.checkoutPickupFrom,
        icon: Icons.storefront_outlined,
        child: HatlySurface(
          child: Row(
            children: [
              Icon(Icons.storefront_outlined, color: p.textMuted),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (branch?.name != null)
                      Text(branch!.name!, style: context.type.title),
                    if (branch?.address != null)
                      Text(branch!.address!, style: context.type.small),
                  ],
                ),
              ),
            ],
          ),
        ),
      );
    }

    final snapshot = quote.address?.snapshot;
    final isDefault = quote.address?.source == 'DEFAULT';
    final eligibility = quote.eligibility;
    final notServiceable =
        snapshot != null && eligibility != null && !eligibility.serviceable;
    // chevron_right is a directional icon: Flutter mirrors it in RTL, so it always points "forward".
    const chevron = Icons.chevron_right;

    return HatlySection(
      title: l10n.checkoutAddressLabel,
      icon: Icons.location_on_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          HatlySurface(
            key: const Key('checkout-address-card'),
            onTap: onPickAddress,
            semanticLabel: snapshot == null
                ? l10n.checkoutSelectAddressCta
                : l10n.checkoutChangeAddress,
            borderColor: notServiceable ? p.urgent : null,
            child: Row(
              children: [
                Icon(Icons.location_on_outlined,
                    color: snapshot == null ? p.link : p.textMuted),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: snapshot == null
                      ? Text(l10n.checkoutSelectAddressCta,
                          style: context.type.body.copyWith(
                              color: p.link, fontWeight: FontWeight.w600))
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                if (snapshot.label?.isNotEmpty == true)
                                  Flexible(
                                    child: Text(snapshot.label!,
                                        style: context.type.title,
                                        overflow: TextOverflow.ellipsis),
                                  ),
                                if (isDefault) ...[
                                  const SizedBox(width: HatlySpacing.sm),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: HatlySpacing.sm,
                                        vertical: 2),
                                    decoration: BoxDecoration(
                                      color: p.accentSoft,
                                      borderRadius: BorderRadius.circular(
                                          HatlyRadius.chip),
                                    ),
                                    child: Text(l10n.checkoutDefaultAddress,
                                        style: context.type.caption
                                            .copyWith(color: p.link)),
                                  ),
                                ],
                              ],
                            ),
                            for (final line in snapshot.detailLinesFor(
                                Localizations.localeOf(context).languageCode ==
                                    'ar'))
                              Text(line, style: context.type.small),
                            if (snapshot.instructions?.isNotEmpty == true)
                              Text(snapshot.instructions!,
                                  style: context.type.caption),
                          ],
                        ),
                ),
                Icon(chevron, color: p.textMuted),
              ],
            ),
          ),
          if (notServiceable)
            Padding(
              padding: const EdgeInsets.only(top: HatlySpacing.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.error_outline, size: 18, color: p.urgent),
                  const SizedBox(width: HatlySpacing.sm),
                  Expanded(
                    child: Text(_eligibilityMessage(l10n, eligibility),
                        key: const Key('checkout-address-error'),
                        style: context.type.small.copyWith(color: p.urgent)),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
