import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/checkout/data/checkout_api.dart';
import 'package:hatly_customer/features/checkout/domain/checkout_quote.dart';

import '../../support/checkout_fixtures.dart';

void main() {
  group('CheckoutQuote.fromJson', () {
    test('Hatly promotions: list and delivery-fee discount (absent on an older server = none)', () {
      final json = quoteJson(discount: 1000)
        ..['promotions'] = [
          {'name': 'Free delivery week', 'nameAr': 'أسبوع توصيل مجاني', 'code': null, 'target': 'DELIVERY_FEE', 'discountMinor': 1500},
          {'name': 'Welcome', 'code': 'WELCOME', 'target': 'ITEMS', 'discountMinor': 1000},
        ]
        ..['deliveryFeeDiscountMinor'] = 1500;
      final q = CheckoutQuote.fromJson(json);
      expect(q.promotions, hasLength(2));
      expect(q.promotions.first.isDeliveryFee, isTrue);
      expect(q.promotions.first.displayName(true), 'أسبوع توصيل مجاني');
      expect(q.promotions.last.code, 'WELCOME');
      expect(q.deliveryFeeDiscountMinor, 1500);
      final old = CheckoutQuote.fromJson(quoteJson());
      expect(old.promotions, isEmpty);
      expect(old.deliveryFeeDiscountMinor, 0);
    });

    test('parses the full server quote field for field', () {
      final q = CheckoutQuote.fromJson(quoteJson(discount: 1000, wallet: 2000));
      expect(q.canPlaceOrder, isTrue);
      expect(q.fulfillment!.type, 'DELIVERY');
      expect(q.fulfillment!.pickupAvailable, isTrue);
      expect(q.address!.source, 'DEFAULT');
      expect(q.address!.addressId, 'addr-1');
      expect(q.address!.snapshot!.governorate, 'الشرقية');
      expect(q.eligibility!.serviceable, isTrue);
      expect(q.summary!.subtotalMinor, 10000);
      expect(q.summary!.discountMinor, 1000);
      expect(q.summary!.deliveryFeeMinor, 1500);
      expect(q.summary!.totalMinor, 10500);
      expect(q.summary!.walletAppliedMinor, 2000);
      expect(q.summary!.amountDueMinor, 8500);
      expect(q.delivery!.baseFeeMinor, 1500);
      expect(q.delivery!.distanceMeters, 3400);
      expect(q.delivery!.vendors.single.name, 'مطعم النخيل');
      expect(q.delivery!.eta.rangeMinMinutes, 35);
      expect(q.delivery!.eta.rangeMaxMinutes, 45);
      expect(q.vendors.single.preparationMinutes, 20);
      expect(q.payment!.options.electronicMethods, hasLength(5));
      expect(q.payment!.wallet.balanceMinor, 5000);
      expect(q.quoteToken, 'token-1');
      expect(q.expiresAt, isNotNull);
    });

    test('an unquotable delivery keeps a null fee and total — never 0', () {
      final q = CheckoutQuote.fromJson(quoteJson(fee: null, canPlace: false));
      expect(q.summary!.deliveryFeeMinor, isNull);
      expect(q.summary!.totalMinor, isNull);
      expect(q.summary!.amountDueMinor, isNull);
    });

    test('the minimal blocked response (empty cart) parses without the sections it does not carry', () {
      final q = CheckoutQuote.fromJson({
        'canPlaceOrder': false,
        'blockers': [
          {'code': 'EMPTY_CART', 'message': 'Your cart is empty.'}
        ],
        'quoteToken': null,
        'expiresAt': null,
      });
      expect(q.isEmptyCart, isTrue);
      expect(q.summary, isNull);
      expect(q.payment, isNull);
      expect(q.coupon.status, 'NONE');
      expect(q.hasBlocker('EMPTY_CART'), isTrue);
    });

    test('coupon states', () {
      final applied = CheckoutQuote.fromJson(quoteJson(overrides: {
        'coupon': {'status': 'APPLIED', 'code': 'SAVE10', 'discountMinor': 1000, 'vendorName': 'X'},
      }));
      expect(applied.coupon.isApplied, isTrue);
      expect(applied.coupon.discountMinor, 1000);
      final rejected = CheckoutQuote.fromJson(quoteJson(overrides: {
        'coupon': {'status': 'REJECTED', 'code': 'OLD', 'reasonCode': 'COUPON_EXPIRED', 'message': 'expired'},
      }));
      expect(rejected.coupon.isRejected, isTrue);
      expect(rejected.coupon.reasonCode, 'COUPON_EXPIRED');
    });

    test('an unavailable ETA carries its reason and no numbers', () {
      final q = CheckoutQuote.fromJson(quoteJson(overrides: {
        'delivery': {
          'applicable': true,
          'source': 'FRESH',
          'vendorCount': 1,
          'vendors': [],
          'eta': {'available': false, 'reason': 'PREPARATION_TIME_NOT_CONFIGURED'},
        },
      }));
      expect(q.delivery!.eta.available, isFalse);
      expect(q.delivery!.eta.reason, 'PREPARATION_TIME_NOT_CONFIGURED');
      expect(q.delivery!.eta.rangeMinMinutes, isNull);
      expect(q.delivery!.hasBreakdown, isFalse);
    });

    test('pickup: a branch instead of an address', () {
      final q = CheckoutQuote.fromJson(quoteJson(fee: 0, overrides: {
        'fulfillment': {
          'type': 'PICKUP',
          'pickupAvailable': true,
          'pickupBranch': {'vendorBranchId': 'b1', 'name': 'الفرع', 'address': 'شارع البحر'},
        },
      }));
      expect(q.fulfillment!.isPickup, isTrue);
      expect(q.fulfillment!.pickupBranch!.name, 'الفرع');
    });
  });

  group('QuoteAddressSnapshot.detailLines', () {
    test('lists the address, building/floor/apartment, landmark and city/governorate — skipping blanks', () {
      final full = CheckoutQuote.fromJson(quoteJson()).address!.snapshot!;
      expect(full.detailLines, [
        'شارع الجمهورية، بلبيس',
        '12 · 3 · 8',
        'بجوار الصيدلية',
        'بلبيس، الشرقية',
      ]);
      const sparse = QuoteAddressSnapshot(line1: 'شارع', latitude: 1, longitude: 2);
      expect(sparse.detailLines, ['شارع']);
    });
  });

  group('CheckoutRequest.toJson', () {
    test('carries only the customer\'s choices — never an amount, fee or ETA', () {
      const r = CheckoutRequest(
        addressId: 'a1',
        paymentMethod: 'MANUAL_TRANSFER',
        electronicPaymentMethod: 'ORANGE_CASH',
        useWallet: false,
        couponCode: 'SAVE10',
        quoteToken: 't',
      );
      expect(r.toJson(), {
        'addressId': 'a1',
        'paymentMethod': 'MANUAL_TRANSFER',
        'electronicPaymentMethod': 'ORANGE_CASH',
        'couponCode': 'SAVE10',
      });
      expect(r.toJson(includeToken: true)['quoteToken'], 't');
      expect(r.toJson().keys.where((k) => k.toLowerCase().contains('fee') || k.toLowerCase().contains('total')), isEmpty);
    });

    test('a wallet cap is only sent while the wallet is on', () {
      const on = CheckoutRequest(paymentMethod: 'COD', useWallet: true, walletAmountMinor: 500);
      const off = CheckoutRequest(paymentMethod: 'COD', walletAmountMinor: 500);
      expect(on.toJson()['walletAmountMinor'], 500);
      expect(off.toJson().containsKey('walletAmountMinor'), isFalse);
    });
  });
}
