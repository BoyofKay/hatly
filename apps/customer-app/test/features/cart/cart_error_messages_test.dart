import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/cart/presentation/cart_error_messages.dart';

import '../../support/test_app.dart';

/// UI code must never branch on the backend's raw `message` — only on
/// the stable `details.code` (`businessCode`). Locks the exact mapping
/// this consolidated customer-commerce milestone added (Part B — Hatly
/// Service location semantics fix): `DELIVER_TO_PLACE_DESTINATION_REQUIRED`
/// gets its own specific, actionable message, never the generic
/// fallback — same discipline `auth_error_messages_test.dart` already
/// established for `SMS_PROVIDER_UNAVAILABLE`.
void main() {
  Future<String> messageFor(WidgetTester tester, ApiException error) async {
    late String result;
    await tester.pumpWidget(hatlyTestApp(
      Builder(builder: (context) {
        result = localizedCartErrorMessage(context, error);
        return const SizedBox.shrink();
      }),
      locale: const Locale('en'),
    ));
    return result;
  }

  ApiException businessError(String code) => ApiException(
        code: 'BAD_REQUEST',
        message: 'irrelevant — never read for known codes',
        details: {'code': code},
      );

  testWidgets(
      'DELIVER_TO_PLACE_DESTINATION_REQUIRED gets its own specific message, not the generic fallback',
      (tester) async {
    final specific = await messageFor(
        tester, businessError('DELIVER_TO_PLACE_DESTINATION_REQUIRED'));
    final generic =
        await messageFor(tester, businessError('SOME_UNMAPPED_CODE'));

    expect(specific, isNot(equals(generic)));
    expect(specific, contains('destination'));
  });

  testWidgets(
      'BUY_FROM_PLACE_PICKUP_REQUIRED gets its own specific message, not the generic fallback',
      (tester) async {
    final specific = await messageFor(
        tester, businessError('BUY_FROM_PLACE_PICKUP_REQUIRED'));
    final generic =
        await messageFor(tester, businessError('SOME_UNMAPPED_CODE'));

    expect(specific, isNot(equals(generic)));
    expect(specific, contains('place to buy from'));
  });

  testWidgets('every AD_HOC_* business code maps to its own distinct message',
      (tester) async {
    final codes = [
      'AD_HOC_PLACE_NAME_REQUIRED',
      'AD_HOC_SERVICE_TYPE_REQUIRED',
      'LOCATION_DOES_NOT_MATCH_SERVICE_TYPE',
      'INCOMPLETE_COORDINATE',
      'AD_HOC_SERVICE_SINGLE_LOCATION_ONLY',
      'PICKUP_REGISTERED_VENDOR_ONLY',
      'DELIVER_TO_PLACE_DESTINATION_REQUIRED',
      'BUY_FROM_PLACE_PICKUP_REQUIRED',
    ];
    final messages = <String>{};
    for (final code in codes) {
      messages.add(await messageFor(tester, businessError(code)));
    }
    expect(messages.length, codes.length,
        reason: 'each known code must map to its own distinct string');
  });

  testWidgets('an unrecognized business code falls back to the generic message',
      (tester) async {
    final unmapped = await messageFor(
        tester, businessError('SOMETHING_NEW_THE_APP_DOES_NOT_KNOW'));
    final noDetails = await messageFor(
        tester, const ApiException(code: 'BAD_REQUEST', message: 'x'));
    expect(unmapped, equals(noDetails));
  });
}
