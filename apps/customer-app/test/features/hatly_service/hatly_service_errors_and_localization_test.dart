import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/presentation/cart_error_messages.dart';
import 'package:hatly_customer/features/checkout/presentation/checkout_error_messages.dart';

import '../../support/test_app.dart';

/// Hatly Service: a known backend error must reach the customer as a SPECIFIC Arabic message — never the generic "حدث خطأ ما" and
/// never the backend's English text — and nothing technical (setting names, codes) may leak.
void main() {
  Future<T> inContext<T>(WidgetTester tester, T Function(BuildContext) read,
      {Locale locale = const Locale('ar')}) async {
    late T result;
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        result = read(context);
        return const SizedBox.shrink();
      }),
      locale: locale,
    ));
    return result;
  }

  ApiException business(String code,
          {int status = 400, String http = 'BAD_REQUEST'}) =>
      ApiException(
        code: http,
        message: 'A BACKEND-AUTHORED ENGLISH MESSAGE THAT MUST NEVER BE SHOWN',
        details: {'code': code, 'key': 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER'},
        statusCode: status,
      );

  bool isArabicOnly(String s) =>
      RegExp(r'[؀-ۿ]').hasMatch(s) && !RegExp(r'[A-Za-z]{3,}').hasMatch(s);

  group(
      'the mixed-cart message is the required Arabic text, not backend English',
      () {
    testWidgets(
        'CATALOG_AD_HOC_MIX_NOT_ALLOWED → the exact approved Arabic sentence',
        (tester) async {
      final text = await inContext(
          tester,
          (c) => localizedCartErrorMessage(
              c,
              business('CATALOG_AD_HOC_MIX_NOT_ALLOWED',
                  status: 409, http: 'CONFLICT')));
      expect(text,
          'لا يمكن الجمع بين منتجات المتاجر وطلبات خدمة هاتلي في سلة واحدة. امسح السلة للتبديل بينهما.');
      expect(text, isNot(contains('cart cannot contain')));
    });

    testWidgets(
        'in English it is also localized (and still not the backend text)',
        (tester) async {
      final text = await inContext(
          tester,
          (c) => localizedCartErrorMessage(
              c, business('CATALOG_AD_HOC_MIX_NOT_ALLOWED')),
          locale: const Locale('en'));
      expect(text,
          "Store items and Hatly Service requests can't share a cart. Clear your cart to switch.");
    });
  });

  group('cart errors for Hatly Service requests', () {
    const cartCodes = [
      'AD_HOC_PLACE_NAME_REQUIRED',
      'AD_HOC_SERVICE_TYPE_REQUIRED',
      'LOCATION_DOES_NOT_MATCH_SERVICE_TYPE',
      'INCOMPLETE_COORDINATE',
      'AD_HOC_SERVICE_SINGLE_LOCATION_ONLY',
      'PICKUP_REGISTERED_VENDOR_ONLY',
      'BUY_FROM_PLACE_PICKUP_REQUIRED',
      'DELIVER_TO_PLACE_DESTINATION_REQUIRED',
      'CATALOG_AD_HOC_MIX_NOT_ALLOWED',
      'TOO_MANY_IMAGES',
      'INVALID_IMAGE_REFERENCE',
      'CUSTOM_ITEM_CONTENT_REQUIRED',
      'BUSINESS_CONFIG_NOT_SET',
    ];

    testWidgets(
        'every one maps to its own Arabic-only message, never the generic one, and none leaks a technical name',
        (tester) async {
      final generic = await inContext(
          tester, (c) => AppLocalizations.of(c).somethingWentWrong);
      final seen = <String>{};
      for (final code in cartCodes) {
        final text = await inContext(
            tester, (c) => localizedCartErrorMessage(c, business(code)));
        expect(text, isNot(generic), reason: code);
        expect(isArabicOnly(text), isTrue, reason: '$code → "$text"');
        expect(text, isNot(contains('HATLY_SERVICE')), reason: code);
        expect(seen.add(text), isTrue,
            reason: '$code duplicates another message');
      }
    });

    testWidgets(
        'a rate limit and a network failure are mapped too; an unknown code still falls back safely',
        (tester) async {
      final limited = await inContext(
          tester,
          (c) => localizedCartErrorMessage(
              c,
              const ApiException(
                  code: 'TOO_MANY_REQUESTS', message: 'x', statusCode: 429)));
      expect(limited, 'محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل');
      final offline = await inContext(
          tester,
          (c) => localizedCartErrorMessage(
              c, const ApiException(code: 'NETWORK_ERROR', message: 'x')));
      expect(offline, contains('لا يوجد اتصال'));
      final unknown = await inContext(tester,
          (c) => localizedCartErrorMessage(c, business('SOMETHING_NEW')));
      expect(unknown, 'حدث خطأ ما');
    });
  });

  group('checkout / order-creation errors for a Hatly Service order', () {
    const checkoutCodes = [
      'DELIVERY_ADDRESS_REQUIRED',
      'ADDRESS_NOT_SERVICEABLE',
      'BUY_FROM_PLACE_PICKUP_REQUIRED',
      'DELIVER_TO_PLACE_DESTINATION_REQUIRED',
      'ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER',
      'WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER',
      'ONLINE_PAYMENT_NOT_AVAILABLE',
      'PAYMENT_METHOD_REQUIRED',
      'QUOTE_TOKEN_REQUIRED',
      'EMPTY_CART',
      'BUSINESS_CONFIG_NOT_SET',
    ];

    testWidgets(
        'each known code gets a specific Arabic-only message — not the generic "حدث خطأ ما"',
        (tester) async {
      final generic = await inContext(
          tester, (c) => AppLocalizations.of(c).somethingWentWrong);
      for (final code in checkoutCodes) {
        final text = await inContext(
            tester, (c) => localizedCheckoutErrorMessage(c, business(code)));
        expect(text, isNot(generic), reason: code);
        expect(isArabicOnly(text), isTrue, reason: '$code → "$text"');
        expect(text, isNot(contains('HATLY_SERVICE')), reason: code);
      }
    });

    testWidgets(
        'a missing configuration (BUSINESS_CONFIG_NOT_SET) is "service unavailable", never the setting name or the generic error',
        (tester) async {
      final order = await inContext(
          tester,
          (c) => localizedCheckoutErrorMessage(
              c,
              business('BUSINESS_CONFIG_NOT_SET',
                  status: 404, http: 'NOT_FOUND')));
      final blocker = await inContext(
          tester, (c) => checkoutBlockerMessage(c, 'BUSINESS_CONFIG_NOT_SET'));
      expect(order,
          'هذه الخدمة غير متاحة حاليًا. يرجى المحاولة لاحقًا أو التواصل مع هاتلي.');
      expect(blocker, order);
    });

    testWidgets(
        'POST /orders with no active cart left (404 with no business code) says so instead of the generic error',
        (tester) async {
      final text = await inContext(
          tester,
          (c) => localizedCheckoutErrorMessage(
              c,
              const ApiException(
                  code: 'NOT_FOUND',
                  message: 'No active cart to submit.',
                  statusCode: 404)));
      expect(text, contains('سلة نشطة'));
    });

    testWidgets(
        'the unpriced-order rejections are the specific "cash on delivery only" reasons',
        (tester) async {
      final electronic = await inContext(
          tester,
          (c) => localizedCheckoutErrorMessage(c,
              business('ELECTRONIC_PAYMENT_NOT_ALLOWED_FOR_UNPRICED_ORDER')));
      final wallet = await inContext(
          tester,
          (c) => localizedCheckoutErrorMessage(
              c, business('WALLET_NOT_ALLOWED_FOR_UNPRICED_ORDER')));
      expect(electronic, 'غير متاح لأن سعر الطلب لم يُحدَّد بعد');
      expect(wallet, contains('المحفظة'));
    });

    testWidgets(
        'blockers for payment problems are mapped; unknown ones keep the generic blocker text',
        (tester) async {
      final online = await inContext(tester,
          (c) => checkoutBlockerMessage(c, 'ONLINE_PAYMENT_NOT_AVAILABLE'));
      final unknown = await inContext(
          tester, (c) => checkoutBlockerMessage(c, 'SOMETHING_NEW'));
      expect(online, 'الدفع الإلكتروني غير متاح حاليًا.');
      expect(unknown, 'لا يمكن إتمام الطلب حاليًا. راجع سلتك وحاول مرة أخرى.');
    });
  });

  testWidgets('a saved GPS address while distance pricing is off tells the customer what to do, not the generic blocker', (tester) async {
    final gps = await inContext(tester, (c) => checkoutBlockerMessage(c, 'DISTANCE_PRICING_UNAVAILABLE'));
    expect(gps, 'التوصيل إلى موقع GPS غير متاح حاليًا. اختر عنوانًا بمنطقة توصيل أو أضف عنوانًا جديدًا.');
    expect(gps, isNot('لا يمكن إتمام الطلب حاليًا. راجع سلتك وحاول مرة أخرى.'));
  });

  testWidgets('the pending-price sentence is the approved Arabic wording',
      (tester) async {
    final text = await inContext(
        tester, (c) => AppLocalizations.of(c).hatlyServicePricePending);
    expect(text, 'سيتم تأكيد السعر أثناء تجهيز الطلب');
  });
}
