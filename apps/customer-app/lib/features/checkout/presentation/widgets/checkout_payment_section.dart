import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../data/checkout_controller.dart';
import '../../domain/checkout_quote.dart';
import '../payment_labels.dart';

/// How the customer pays. Which options exist — and which electronic methods are offered — is the server's decision
/// (`quote.payment.options`); a method that cannot be used is shown disabled with the reason, never silently dropped.
class CheckoutPaymentSection extends StatelessWidget {
  const CheckoutPaymentSection({
    super.key,
    required this.quote,
    required this.selection,
    required this.onSelect,
    required this.onSelectElectronic,
  });

  final CheckoutQuote quote;
  final CheckoutSelection selection;

  /// (method, electronicMethod-to-keep)
  final void Function(String method, String? electronicMethod) onSelect;
  final ValueChanged<String> onSelectElectronic;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final payment = quote.payment;
    if (payment == null) return const SizedBox.shrink();
    final options = payment.options;

    // The wallet alone covers the whole order: nothing is left to choose.
    if (payment.method == 'WALLET') {
      return HatlySection(
        title: l10n.checkoutPaymentMethodLabel,
        child: HatlySurface(
          key: const Key('checkout-paid-by-wallet'),
          child: Row(
            children: [
              Icon(Icons.account_balance_wallet_outlined, color: p.success),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                  child: Text(l10n.checkoutPaidFullyByWallet,
                      style: context.type.body)),
            ],
          ),
        ),
      );
    }

    final needsMethod =
        selection.needsElectronicMethod && selection.electronicMethod == null;

    String transferReason() {
      switch (options.manualTransferReason) {
        case 'WEIGHED_ITEMS':
          return l10n.checkoutTransferUnavailableWeighed;
        case 'UNPRICED_ORDER':
          return l10n.checkoutTransferUnavailableUnpriced;
        default:
          return l10n.checkoutTransferUnavailable;
      }
    }

    return HatlySection(
      title: l10n.checkoutPaymentMethodLabel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (options.cod)
            _PaymentOption(
              optionKey: const Key('payment-cod'),
              icon: Icons.payments_outlined,
              title: l10n.checkoutPaymentCod,
              selected: selection.paymentMethod == 'COD',
              onTap: () => onSelect('COD', null),
            ),
          if (options.payAtDelivery) ...[
            const SizedBox(height: HatlySpacing.sm),
            _PaymentOption(
              optionKey: const Key('payment-pay-at-delivery'),
              icon: Icons.contactless_outlined,
              title: l10n.checkoutPaymentPayAtDelivery,
              subtitle: l10n.checkoutPaymentPayAtDeliveryHint,
              selected: selection.paymentMethod == 'PAY_AT_DELIVERY',
              onTap: () =>
                  onSelect('PAY_AT_DELIVERY', selection.electronicMethod),
            ),
          ],
          // U2: never offered for a pickup order (cash at the counter only) — hidden, not merely disabled.
          if (options.manualTransferReason != 'PICKUP_CASH_ONLY') ...[
            const SizedBox(height: HatlySpacing.sm),
            _PaymentOption(
              optionKey: const Key('payment-manual-transfer'),
              icon: Icons.swap_horiz,
              title: l10n.checkoutPaymentManualTransfer,
              subtitle: options.manualTransferAvailable
                  ? l10n.checkoutPaymentManualTransferHint
                  : transferReason(),
              selected: selection.paymentMethod == 'MANUAL_TRANSFER',
              enabled: options.manualTransferAvailable,
              onTap: () =>
                  onSelect('MANUAL_TRANSFER', selection.electronicMethod),
            ),
          ],
          // Hatly Service with a price still to be confirmed: cash on delivery is the only way to pay (the server rejects anything
          // else), and the customer is told why the other methods are unavailable and when the price will be known.
          // U2: a pickup order is paid in cash at the counter — the server offers nothing else (and refuses anything else).
          if (options.manualTransferReason == 'PICKUP_CASH_ONLY') ...[
            const SizedBox(height: HatlySpacing.sm),
            Text(l10n.checkoutPickupCashNote,
                key: const Key('checkout-pickup-cash-note'),
                style: context.type.small.copyWith(color: p.textMuted)),
          ],
          if (quote.hasPendingPricing) ...[
            const SizedBox(height: HatlySpacing.sm),
            Text(l10n.checkoutHatlyServiceCodNote,
                key: const Key('checkout-hatly-service-cod-note'),
                style: context.type.small.copyWith(color: p.textMuted)),
          ],
          if (selection.needsElectronicMethod) ...[
            const SizedBox(height: HatlySpacing.ms),
            // A prompt only while nothing is chosen; once a method is picked this is a plain label, never a request.
            Text(
                needsMethod
                    ? l10n.checkoutChooseElectronicMethod
                    : l10n.checkoutElectronicMethodHeading,
                key: const Key('checkout-electronic-heading'),
                style: context.type.small.copyWith(
                    color: needsMethod ? p.warning : p.textMuted,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: HatlySpacing.sm),
            Wrap(
              spacing: HatlySpacing.sm,
              runSpacing: HatlySpacing.sm,
              children: [
                for (final method in options.electronicMethods)
                  ChoiceChip(
                    key: Key('electronic-$method'),
                    avatar: Icon(electronicMethodIcon(method),
                        size: 18,
                        color: selection.electronicMethod == method
                            ? p.link
                            : p.textMuted),
                    label: Text(electronicMethodLabel(context, method)),
                    labelStyle: context.type.small.copyWith(
                        color: p.textPrimary,
                        fontWeight: selection.electronicMethod == method
                            ? FontWeight.w700
                            : FontWeight.w400),
                    showCheckmark: false,
                    selected: selection.electronicMethod == method,
                    selectedColor: p.accentSoft,
                    backgroundColor: p.surface,
                    side: BorderSide(
                        color: selection.electronicMethod == method
                            ? p.accent
                            : p.border,
                        width: selection.electronicMethod == method ? 1.5 : 1),
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onSelected: (_) => onSelectElectronic(method),
                  ),
              ],
            ),
            if (options.electronicMethods.isEmpty)
              Text(l10n.checkoutNoElectronicMethods,
                  style: context.type.small.copyWith(color: p.urgent)),
          ],
        ],
      ),
    );
  }
}

/// One payment option: a single tappable row that announces itself as a radio button (checked / disabled) to screen readers.
class _PaymentOption extends StatelessWidget {
  const _PaymentOption({
    required this.optionKey,
    required this.icon,
    required this.title,
    this.subtitle,
    required this.selected,
    required this.onTap,
    this.enabled = true,
  });

  final Key optionKey;
  final IconData icon;
  final String title;
  final String? subtitle;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    final radius = BorderRadius.circular(HatlyRadius.card);
    return Semantics(
      key: optionKey,
      inMutuallyExclusiveGroup: true,
      checked: selected,
      enabled: enabled,
      button: true,
      label: subtitle == null ? title : '$title. $subtitle',
      excludeSemantics: true,
      onTap: enabled ? onTap : null,
      child: Opacity(
        opacity: enabled ? 1 : 0.55,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: radius,
          child: Container(
            constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
            padding: const EdgeInsets.all(HatlySpacing.md),
            decoration: BoxDecoration(
              color: selected ? p.accentSoft : p.surface,
              borderRadius: radius,
              border: Border.all(
                  color: selected ? p.accent : p.border,
                  width: selected ? 1.5 : 1),
            ),
            child: Row(
              children: [
                Icon(icon, color: selected ? p.link : p.textMuted),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title,
                          style: context.type.body
                              .copyWith(fontWeight: FontWeight.w600)),
                      if (subtitle != null)
                        Text(subtitle!, style: context.type.caption),
                    ],
                  ),
                ),
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: selected ? p.link : p.textMuted,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
