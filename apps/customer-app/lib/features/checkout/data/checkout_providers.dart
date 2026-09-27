import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/providers.dart';
import 'manual_transfer_api.dart';

/// CONFIRMED (Cart & Checkout Stabilization, decision/instruction 7):
/// `CheckoutCartSummary`/`checkoutCartApiProvider`/
/// `checkoutCartSummaryProvider` are REMOVED — Checkout now consumes
/// `cartControllerProvider` (see `cart_providers.dart`) directly, the
/// same single authoritative Cart source `CartScreen` uses. No second
/// Cart parser exists anywhere in this feature anymore.

final manualTransferApiProvider = Provider<ManualTransferApi>(
    (ref) => ManualTransferApi(ref.watch(apiClientProvider)));

/// CONFIRMED: fails closed (throws) if the destination/WhatsApp number
/// aren't configured in BusinessConfig yet — see
/// `ManualTransferApi.getConfig`'s own comment. The checkout screen
/// treats a failure here as "this payment method isn't available yet"
/// rather than inventing a fallback value.
final manualTransferConfigProvider =
    FutureProvider.autoDispose<ManualTransferConfig>((ref) {
  return ref.watch(manualTransferApiProvider).getConfig();
});
