import 'package:flutter/material.dart';
import '../../../core/localization/l10n/app_localizations.dart';

/// Display name of one electronic payment method. Text + a generic glyph only: Hatly does not ship third-party brand logos.
String electronicMethodLabel(BuildContext context, String code) {
  final l10n = AppLocalizations.of(context);
  switch (code) {
    case 'INSTAPAY':
      return l10n.paymentMethodInstapay;
    case 'VODAFONE_CASH':
      return l10n.paymentMethodVodafoneCash;
    case 'ORANGE_CASH':
      return l10n.paymentMethodOrangeCash;
    case 'ETISALAT_CASH':
      return l10n.paymentMethodEtisalatCash;
    case 'WE_PAY':
      return l10n.paymentMethodWePay;
    default:
      return code;
  }
}

IconData electronicMethodIcon(String code) {
  switch (code) {
    case 'INSTAPAY':
      return Icons.account_balance_outlined;
    default:
      return Icons.smartphone_outlined;
  }
}

/// One-line description of how an order is paid — used by the success screen, the order list, details and tracking.
/// [method] is the order's `paymentMethod`; [electronicMethod] its stored electronic method (if any).
String paymentSummaryLabel(BuildContext context, String method,
    {String? electronicMethod}) {
  final l10n = AppLocalizations.of(context);
  final electronic = electronicMethod == null
      ? null
      : electronicMethodLabel(context, electronicMethod);
  switch (method) {
    case 'COD':
      return l10n.paymentCodLabel;
    case 'PAY_AT_DELIVERY':
      return electronic == null
          ? l10n.paymentPayAtDeliveryLabel
          : l10n.paymentPayAtDeliveryWith(electronic);
    case 'MANUAL_TRANSFER':
      return electronic == null
          ? l10n.paymentManualTransferLabel
          : l10n.paymentManualTransferWith(electronic);
    case 'WALLET':
      return l10n.paymentWalletLabel;
    default:
      return method;
  }
}
