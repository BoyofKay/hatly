import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../checkout/domain/checkout_quote.dart';
import '../domain/order_details.dart';

/// "35–40 minutes" / "about 35 minutes" from a checkout quote's ETA, or the honest reason there is none — never a made-up
/// number.
String quoteEtaLabel(BuildContext context, QuoteEta eta) {
  final l10n = AppLocalizations.of(context);
  final min = eta.rangeMinMinutes;
  final max = eta.rangeMaxMinutes;
  if (!eta.available || min == null) {
    return etaUnavailableLabel(context, eta.reason);
  }
  if (max == null || max == min) return l10n.etaAboutMinutes(min);
  return l10n.etaRangeMinutes(min, max);
}

/// Why no ETA exists (the server's reason code), in the customer's words.
String etaUnavailableLabel(BuildContext context, String? reason) {
  final l10n = AppLocalizations.of(context);
  switch (reason) {
    case 'PREPARATION_TIME_NOT_CONFIGURED':
      return l10n.etaUnavailablePreparation;
    default:
      return l10n.etaUnavailable;
  }
}

/// The expected delivery / ready window of an existing order — a clock-time range — or null when the order has none to show
/// (finished, cancelled, or the estimate is unavailable; use [orderEtaUnavailableText] for the latter).
String? orderEtaWindow(BuildContext context, OrderEta eta,
    {required bool isPickup}) {
  if (!eta.isEstimated) return null;
  final l10n = AppLocalizations.of(context);
  final locale = Localizations.localeOf(context).languageCode;
  final format = DateFormat.jm(locale);
  final from = format.format(eta.estimatedAt!.toLocal());
  final until = eta.estimatedUntil == null
      ? null
      : format.format(eta.estimatedUntil!.toLocal());
  if (until == null || until == from) {
    return isPickup ? l10n.etaReadyAt(from) : l10n.etaDeliveryAt(from);
  }
  return isPickup
      ? l10n.etaReadyBetween(from, until)
      : l10n.etaDeliveryBetween(from, until);
}

/// Text for an order whose ETA state is UNAVAILABLE (an ongoing order with nothing to estimate from).
String? orderEtaUnavailableText(BuildContext context, OrderEta eta) {
  if (eta.state != 'UNAVAILABLE') return null;
  return etaUnavailableLabel(context, eta.reason);
}
