import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/checkout/presentation/checkout_error_messages.dart';

import '../../support/test_app.dart';

/// Hatly Service location rule: the customer's own place is required (never a Hatly default). A cart that already holds a request
/// without it must get a specific, actionable checkout message — not the generic blocker text.
void main() {
  Future<T> inContext<T>(
      WidgetTester tester, T Function(BuildContext) read) async {
    late T result;
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        result = read(context);
        return const SizedBox.shrink();
      }),
      locale: const Locale('en'),
    ));
    return result;
  }

  testWidgets(
      'quote blockers for a missing Hatly Service place are specific and actionable',
      (tester) async {
    final pickup = await inContext(tester,
        (c) => checkoutBlockerMessage(c, 'BUY_FROM_PLACE_PICKUP_REQUIRED'));
    final destination = await inContext(
        tester,
        (c) =>
            checkoutBlockerMessage(c, 'DELIVER_TO_PLACE_DESTINATION_REQUIRED'));
    final generic = await inContext(
        tester, (c) => checkoutBlockerMessage(c, 'SOME_UNMAPPED_CODE'));

    expect(pickup, isNotNull);
    expect(destination, isNotNull);
    expect({pickup, destination, generic}.length, 3,
        reason: 'each code gets its own message');
    expect(pickup, contains('pickup location'));
    expect(destination, contains('destination'));
    expect(pickup, contains('Remove it from your cart'));
  });

  testWidgets(
      'an order rejected for a missing Hatly Service place shows the same specific messages',
      (tester) async {
    ApiException error(String code) => ApiException(
        code: 'BAD_REQUEST', message: 'never read', details: {'code': code});
    final pickup = await inContext(
        tester,
        (c) => localizedCheckoutErrorMessage(
            c, error('BUY_FROM_PLACE_PICKUP_REQUIRED')));
    final destination = await inContext(
        tester,
        (c) => localizedCheckoutErrorMessage(
            c, error('DELIVER_TO_PLACE_DESTINATION_REQUIRED')));
    final generic = await inContext(tester,
        (c) => localizedCheckoutErrorMessage(c, error('SOME_UNMAPPED_CODE')));

    expect({pickup, destination, generic}.length, 3);
    expect(pickup, contains('pickup location'));
    expect(destination, contains('destination'));
  });
}
