import 'package:flutter/widgets.dart';

/// Formats an integer minor-unit amount (piasters — see the backend's
/// `common/utils/money.ts` and hatly-api-contract.md "Money" section)
/// into a display string. The API always sends/receives money as
/// integer minor units — this is the one place in the customer app
/// that converts that into something a customer reads, e.g.
/// `1250` -> "12.50 EGP" / "12.50 ج.م".
///
/// No vendor/order data exists over the wire yet in Phase 2B (vendor
/// listings are a fixture — see FixtureVendorRepository), but this
/// formatter is written against the real contract now so swapping the
/// fixture for a live API later needs no change here.
String formatMinorUnits(int minorUnits, BuildContext context) {
  final isArabic = Localizations.localeOf(context).languageCode == 'ar';
  final major = minorUnits / 100;
  final formatted = major == major.roundToDouble()
      ? major.toStringAsFixed(0)
      : major.toStringAsFixed(2);
  return isArabic ? '$formatted ج.م' : '$formatted EGP';
}
