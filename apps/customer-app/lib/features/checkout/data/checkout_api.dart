import '../../../core/network/api_client.dart';
import '../domain/checkout_quote.dart';

/// What the customer has chosen so far. The server turns this into the authoritative quote; nothing here is a price.
class CheckoutRequest {
  const CheckoutRequest({
    this.addressId,
    this.paymentMethod,
    this.electronicPaymentMethod,
    this.useWallet = false,
    this.walletAmountMinor,
    this.couponCode,
    this.quoteToken,
  });

  /// Null = let the server preselect the customer's default address (only when it is serviceable).
  final String? addressId;

  /// `COD` · `PAY_AT_DELIVERY` · `MANUAL_TRANSFER` · `WALLET`.
  final String? paymentMethod;
  final String? electronicPaymentMethod;
  final bool useWallet;
  final int? walletAmountMinor;
  final String? couponCode;

  /// Only sent when placing the order — freezes the confirmed delivery fee.
  final String? quoteToken;

  Map<String, dynamic> toJson({bool includeToken = false}) => {
        if (addressId != null) 'addressId': addressId,
        if (paymentMethod != null) 'paymentMethod': paymentMethod,
        if (electronicPaymentMethod != null &&
            (paymentMethod == 'PAY_AT_DELIVERY' ||
                paymentMethod == 'MANUAL_TRANSFER'))
          'electronicPaymentMethod': electronicPaymentMethod,
        if (useWallet) 'useWallet': true,
        if (useWallet && walletAmountMinor != null)
          'walletAmountMinor': walletAmountMinor,
        if (couponCode != null && couponCode!.isNotEmpty)
          'couponCode': couponCode,
        if (includeToken && quoteToken != null) 'quoteToken': quoteToken,
      };
}

class CheckoutApi {
  CheckoutApi(this._client);

  final ApiClient _client;

  /// `POST /checkout/quote` — read-only, authoritative price/delivery/payment breakdown for the current cart.
  Future<CheckoutQuote> quote(CheckoutRequest request) {
    return _client.request(
      (dio) => dio.post('/checkout/quote', data: request.toJson()),
      (data) => CheckoutQuote.fromJson(data['data'] as Map<String, dynamic>),
    );
  }
}
