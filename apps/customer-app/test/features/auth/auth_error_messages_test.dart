import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/presentation/auth_error_messages.dart';

import '../../support/test_app.dart';

/// UI code must never branch on the backend's raw `message` — only on the stable `code`.
/// This locks the exact string each known code maps to, and — the point of this file —
/// that `SMS_PROVIDER_UNAVAILABLE` (the backend's honest "the SMS provider genuinely
/// failed/unconfigured" code) gets its OWN specific message rather than silently falling
/// through to the generic "something went wrong" default, which would hide a real,
/// actionable provider problem from whoever is testing/using the app.
void main() {
  Future<String> messageFor(WidgetTester tester, String? code) async {
    late String result;
    await tester.pumpWidget(hatlyTestApp(Builder(builder: (context) {
      result = localizedErrorMessage(context, code);
      return const SizedBox.shrink();
    })));
    return result;
  }

  testWidgets(
      'SMS_PROVIDER_UNAVAILABLE gets its own specific message, not the generic fallback',
      (tester) async {
    final smsMessage = await messageFor(tester, 'SMS_PROVIDER_UNAVAILABLE');
    final genericMessage = await messageFor(tester, 'SOME_UNMAPPED_CODE');
    expect(smsMessage, isNot(equals(genericMessage)));
    expect(smsMessage, contains('رمز التحقق'));
  });

  testWidgets('known codes map to their own distinct messages', (tester) async {
    final network = await messageFor(tester, 'NETWORK_ERROR');
    final badRequest = await messageFor(tester, 'BAD_REQUEST');
    final unauthorized = await messageFor(tester, 'UNAUTHORIZED');
    final tooMany = await messageFor(tester, 'TOO_MANY_REQUESTS');
    final sms = await messageFor(tester, 'SMS_PROVIDER_UNAVAILABLE');

    final messages = {network, badRequest, unauthorized, tooMany, sms};
    expect(messages.length, 5,
        reason: 'each known code must map to its own distinct string');
  });

  testWidgets('an unrecognized or null code falls back to the generic message',
      (tester) async {
    final unmapped =
        await messageFor(tester, 'SOMETHING_NEW_THE_APP_DOES_NOT_KNOW');
    final nullCode = await messageFor(tester, null);
    expect(unmapped, equals(nullCode));
  });

  testWidgets(
      'CUSTOMER_OTP_DISABLED (verification switched off by the Admin) gets its own specific message',
      (tester) async {
    final disabled = await messageFor(tester, 'CUSTOMER_OTP_DISABLED');
    final generic = await messageFor(tester, 'SOME_UNMAPPED_CODE');
    expect(disabled, isNot(equals(generic)));
    expect(disabled, contains('التحقق من الهاتف'));
  });

  group('sign-in / registration form errors (localizedPasswordAuthError)', () {
    Future<String> formMessage(WidgetTester tester, String? code,
        {required bool registering}) async {
      late String result;
      await tester.pumpWidget(hatlyTestApp(Builder(builder: (context) {
        result =
            localizedPasswordAuthError(context, code, registering: registering);
        return const SizedBox.shrink();
      })));
      return result;
    }

    testWidgets(
        'UNAUTHORIZED means "wrong credentials" when signing in but "registration refused" when registering — never "wrong OTP"',
        (tester) async {
      final login =
          await formMessage(tester, 'UNAUTHORIZED', registering: false);
      final register =
          await formMessage(tester, 'UNAUTHORIZED', registering: true);
      final otp = await messageFor(tester, 'UNAUTHORIZED');
      expect({login, register, otp}.length, 3);
      expect(login, 'رقم الهاتف أو كلمة المرور غير صحيحة');
      expect(register, contains('تعذر إكمال التسجيل'));
    });

    testWidgets(
        'every known code has its own distinct message; unknown codes fall back to the generic one',
        (tester) async {
      final messages = <String>{};
      for (final code in [
        'NETWORK_ERROR',
        'UNAUTHORIZED',
        'TOO_MANY_FAILED_LOGINS',
        'TOO_MANY_REQUESTS',
        'BAD_REQUEST',
      ]) {
        messages.add(await formMessage(tester, code, registering: false));
      }
      expect(messages.length, 5);

      final generic = await messageFor(tester, null);
      expect(
          await formMessage(tester, 'WHATEVER', registering: false), generic);
      expect(await formMessage(tester, null, registering: true), generic);
    });
  });
}
