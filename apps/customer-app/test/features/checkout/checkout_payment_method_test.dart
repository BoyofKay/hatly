import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/cart/domain/delivery_fee_quote.dart';

/// CONFIRMED (Cart & Checkout Stabilization, decisions 2 & 10): these
/// are pure-function tests — no network/mocking library exists in
/// this project, so `CartApi.quoteDeliveryFee`/`createOrder` network
/// calls themselves are not exercised here; that would require adding
/// a mocking dependency, which is out of this chunk's scope and not
/// silently added.
void main() {
  group('DeliveryFeeQuote.fromJson — used directly, never recomputed', () {
    test('parses an applicable quote with a fee', () {
      final quote = DeliveryFeeQuote.fromJson(
          {'applicable': true, 'deliveryFeeMinor': 1500});
      expect(quote.applicable, true);
      expect(quote.deliveryFeeMinor, 1500);
      expect(quote.reason, isNull);
    });

    test('parses a non-applicable quote with a reason, never a fabricated fee',
        () {
      final quote = DeliveryFeeQuote.fromJson(
          {'applicable': false, 'reason': 'EMPTY_CART'});
      expect(quote.applicable, false);
      expect(quote.reason, 'EMPTY_CART');
      expect(quote.deliveryFeeMinor, isNull);
    });

    test('parses a zero-fee pickup quote as a real 0, not a missing value', () {
      final quote = DeliveryFeeQuote.fromJson(
          {'applicable': true, 'deliveryFeeMinor': 0});
      expect(quote.applicable, true);
      expect(quote.deliveryFeeMinor, 0);
    });
  });
}
