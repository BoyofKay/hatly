import 'package:flutter/widgets.dart';
import '../../../core/localization/l10n/app_localizations.dart';

/// UI code must never branch on or display the backend's raw error
/// `message` directly — that's backend-authored English text, not
/// localized, and not meant as a UI string (spec: "never make UI
/// behavior depend on backend message text" / "do not display raw
/// backend exceptions"). This is the one place a backend error `code`
/// (see ApiException.code) gets turned into something to show a
/// customer. Takes the bare code string so callers holding just a
/// persisted `errorCode` (e.g. OtpFlowState) don't need an
/// ApiException instance to use it.
String localizedErrorMessage(BuildContext context, String? code) {
  final l10n = AppLocalizations.of(context);

  switch (code) {
    case 'NETWORK_ERROR':
      return l10n.errorNetwork;
    case 'BAD_REQUEST':
      return l10n.errorInvalidOtp;
    case 'UNAUTHORIZED':
      return l10n.errorInvalidOrExpiredOtp;
    case 'TOO_MANY_REQUESTS':
      return l10n.errorTooManyAttempts;
    case 'SMS_PROVIDER_UNAVAILABLE':
      // The backend's OTP send genuinely failed (e.g. the SMS provider is
      // unreachable or unconfigured) — an honest, specific message, never
      // the generic fallback that would otherwise hide a real, actionable
      // provider problem behind "something went wrong."
      return l10n.errorSmsProviderUnavailable;
    default:
      return l10n.somethingWentWrong;
  }
}
