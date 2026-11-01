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
    case 'CUSTOMER_OTP_DISABLED':
      // The Admin switched phone verification off: an honest, specific message, not the generic fallback.
      return l10n.errorPhoneVerificationUnavailable;
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

/// Error text for the sign-in / registration form (phone + password). Distinct from [localizedErrorMessage], where an
/// `UNAUTHORIZED` means "wrong or expired OTP code": here it is a failed sign-in (generic on purpose — the backend never
/// reveals whether a phone has an account) or a registration the backend refused (for example the phone already has a
/// password; the backend answers identically for every refusal, and so does this text).
String localizedPasswordAuthError(BuildContext context, String? code,
    {required bool registering}) {
  final l10n = AppLocalizations.of(context);
  switch (code) {
    case 'NETWORK_ERROR':
      return l10n.errorNetwork;
    case 'UNAUTHORIZED':
      return registering
          ? l10n.errorRegistrationUnavailable
          : l10n.errorInvalidCredentials;
    case 'TOO_MANY_FAILED_LOGINS':
      return l10n.errorTooManyFailedLogins;
    case 'TOO_MANY_REQUESTS':
      return l10n.errorTooManyAttempts;
    case 'BAD_REQUEST':
      return l10n.errorInvalidInput;
    default:
      return l10n.somethingWentWrong;
  }
}

/// Error text for changing the password from Profile. `403 CURRENT_PASSWORD_INVALID` and `400
/// CURRENT_PASSWORD_REQUIRED` are the backend's answers when the current password was missing or wrong; a `TOO_MANY_FAILED_LOGINS` is the per-account lockout shared with sign-in.
String localizedPasswordChangeError(BuildContext context, String? code) {
  final l10n = AppLocalizations.of(context);
  switch (code) {
    case 'CURRENT_PASSWORD_REQUIRED':
      return l10n.errorCurrentPasswordRequired;
    case 'CURRENT_PASSWORD_INVALID':
      return l10n.errorCurrentPasswordInvalid;
    case 'TOO_MANY_FAILED_LOGINS':
      return l10n.errorTooManyFailedLogins;
    case 'TOO_MANY_REQUESTS':
      return l10n.errorTooManyAttempts;
    case 'NETWORK_ERROR':
      return l10n.errorNetwork;
    case 'BAD_REQUEST':
      return l10n.errorInvalidInput;
    default:
      return l10n.somethingWentWrong;
  }
}
