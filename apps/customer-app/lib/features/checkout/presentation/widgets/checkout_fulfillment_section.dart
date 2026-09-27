import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../domain/checkout_quote.dart';

/// Delivery ⇄ Pickup. Pickup is offered only when the server says it is possible (a single vendor whose branch supports it);
/// otherwise the option is disabled and the reason is shown — the app never decides eligibility itself.
class CheckoutFulfillmentSection extends StatelessWidget {
  const CheckoutFulfillmentSection({
    super.key,
    required this.fulfillment,
    required this.onChanged,
    this.enabled = true,
  });

  final QuoteFulfillment fulfillment;
  final ValueChanged<String> onChanged;
  final bool enabled;

  String _reason(AppLocalizations l10n) {
    switch (fulfillment.pickupUnavailableReason) {
      case 'PICKUP_SINGLE_VENDOR_ONLY':
        return l10n.checkoutPickupSingleVendorOnly;
      case 'BRANCH_PICKUP_DISABLED':
        return l10n.checkoutPickupBranchDisabled;
      default:
        return l10n.checkoutPickupUnavailable;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final pickupDisabled =
        !fulfillment.pickupAvailable && !fulfillment.isPickup;
    return HatlySection(
      title: l10n.checkoutFulfillmentTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<String>(
              key: const Key('checkout-fulfillment'),
              showSelectedIcon: false,
              segments: [
                ButtonSegment(
                  value: 'DELIVERY',
                  icon: const Icon(Icons.delivery_dining_outlined),
                  label: Text(l10n.checkoutFulfillmentDelivery),
                ),
                ButtonSegment(
                  value: 'PICKUP',
                  icon: const Icon(Icons.storefront_outlined),
                  label: Text(l10n.checkoutFulfillmentPickup),
                  enabled: !pickupDisabled,
                ),
              ],
              selected: {fulfillment.type},
              onSelectionChanged:
                  enabled ? (value) => onChanged(value.first) : null,
            ),
          ),
          if (pickupDisabled) ...[
            const SizedBox(height: HatlySpacing.xs),
            Text(_reason(l10n),
                style: context.type.caption.copyWith(color: p.textMuted)),
          ],
        ],
      ),
    );
  }
}
