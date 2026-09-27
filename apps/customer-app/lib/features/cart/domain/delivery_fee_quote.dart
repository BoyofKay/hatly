/// Mirrors the real backend `quoteDeliveryFee` response exactly
/// (`{ applicable, reason?, deliveryFeeMinor? }` — see
/// `cart.service.ts`). CONFIRMED (Cart & Checkout Stabilization,
/// decision 2): Checkout uses this directly; no delivery-fee formula
/// is ever computed client-side.
class DeliveryFeeQuote {
  const DeliveryFeeQuote(
      {required this.applicable, this.reason, this.deliveryFeeMinor});

  final bool applicable;

  /// `'AD_HOC_SERVICE_NOT_APPLICABLE'` or `'EMPTY_CART'` when
  /// [applicable] is false — never fabricated, shown as-is.
  final String? reason;
  final int? deliveryFeeMinor;

  factory DeliveryFeeQuote.fromJson(Map<String, dynamic> json) {
    return DeliveryFeeQuote(
      applicable: json['applicable'] as bool,
      reason: json['reason'] as String?,
      deliveryFeeMinor: json['deliveryFeeMinor'] as int?,
    );
  }
}
