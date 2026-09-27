import 'package:url_launcher/url_launcher.dart';

/// CONFIRMED (Payment Verification chunk, section 10): WhatsApp is a
/// customer communication channel ONLY. This helper only ever
/// constructs an outbound `wa.me` link and opens it externally — it
/// never reads, receives, or processes anything from WhatsApp. No
/// webhook, no bot, no backend WhatsApp integration exists or is
/// implied by this file.
///
/// `whatsappNumber` comes from BusinessConfig
/// (`CUSTOMER_SERVICE_WHATSAPP_NUMBER`) — never hardcoded here. Two SEPARATE
/// use cases share this one launcher, and must stay separate:
///  * Manual-transfer payment proof — number from `ManualTransferApi.getConfig()`,
///    message from [buildTransferProofMessage] (below).
///  * General customer support — number from `SupportContactApi` (see
///    features/support), message from the localized support strings.
///
/// [buildWhatsAppUri]: `https://wa.me/<digits>` — with `?text=` only when a non-blank [message] is given.
Uri buildWhatsAppUri({required String phoneNumber, String? message}) {
  final digitsOnly = phoneNumber.replaceAll(RegExp(r'[^\d]'), '');
  final text = message?.trim();
  return Uri.parse(text == null || text.isEmpty
      ? 'https://wa.me/$digitsOnly'
      : 'https://wa.me/$digitsOnly?text=${Uri.encodeComponent(text)}');
}

/// Opens [uri] in the external WhatsApp app / browser. Kept as a typedef so the launch is replaceable in tests.
typedef WhatsAppLauncher = Future<bool> Function(Uri uri);

Future<bool> launchWhatsAppUri(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

Future<bool> openWhatsAppWithMessage(
    {required String phoneNumber, required String message}) {
  return launchWhatsAppUri(
      buildWhatsAppUri(phoneNumber: phoneNumber, message: message));
}

/// Minimum useful order context for the pre-filled message — Hatly
/// Order ID, payment method, payable amount — nothing more. The
/// customer still types/sends the actual proof themselves; this is
/// only the message shell.
String buildTransferProofMessage({
  required String orderId,
  required String paymentMethodLabel,
  required String formattedAmount,
}) {
  return 'Hatly Order #$orderId\n'
      'Payment method: $paymentMethodLabel\n'
      'Amount: $formattedAmount\n\n'
      'Hi, I\'ve sent the payment for this order. Attaching my transfer proof below.';
}
