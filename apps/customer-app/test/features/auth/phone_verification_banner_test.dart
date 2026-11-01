import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/data/auth_api.dart';
import 'package:hatly_customer/features/auth/presentation/widgets/phone_verification_banner.dart';

import '../../support/auth_fakes.dart';
import '../../support/test_app.dart';

/// The post-login "verify your phone" banner (Home): the backend alone says whether it shows and whether verification is
/// currently possible — the app never assumes either.
void main() {
  late FakeAuthApi api;
  late FakeAuthTokenStorage storage;

  Future<void> pumpBanner(WidgetTester tester, {bool verified = false}) async {
    api = FakeAuthApi()..phoneVerified = verified;
    storage = FakeAuthTokenStorage();
    await tester.pumpWidget(hatlyTestApp(const PhoneVerificationBanner(),
        overrides: authOverrides(api, storage)));
    await tester.pumpAndSettle();
  }

  testWidgets('an already verified phone shows nothing', (tester) async {
    await pumpBanner(tester, verified: true);
    expect(find.text('تحقق من رقم هاتفك'), findsNothing);
  });

  testWidgets(
      'an unverified phone shows the prompt; with OTP enabled the code field appears',
      (tester) async {
    await pumpBanner(tester);
    expect(find.text('تحقق من رقم هاتفك'), findsOneWidget);

    await tester.tap(find.text('تحقق'));
    await tester.pumpAndSettle();
    expect(api.calls, contains('requestPhoneVerification'));
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets(
      'with OTP DISABLED nothing is asked of the customer: no "verify your phone" prompt (it could not be followed), and the phone is not treated as verified',
      (tester) async {
    api = FakeAuthApi()..otpEnabled = false;
    storage = FakeAuthTokenStorage();
    await tester.pumpWidget(hatlyTestApp(const PhoneVerificationBanner(),
        overrides: authOverrides(api, storage)));
    await tester.pumpAndSettle();

    expect(find.text('تحقق من رقم هاتفك'), findsNothing);
    expect(find.text('تحقق'), findsNothing);
    expect(api.phoneVerified, isFalse, reason: 'never falsely verified');
    expect(api.calls, ['getPhoneVerificationStatus'],
        reason: 'no code was requested, nothing was claimed');
  });

  testWidgets(
      'the Admin switching OTP back ON brings the prompt back for a still-unverified customer, and verification then works',
      (tester) async {
    api = FakeAuthApi()..otpEnabled = false;
    storage = FakeAuthTokenStorage();
    await tester.pumpWidget(hatlyTestApp(const PhoneVerificationBanner(),
        overrides: authOverrides(api, storage)));
    await tester.pumpAndSettle();
    expect(find.text('تحقق من رقم هاتفك'), findsNothing);

    api.otpEnabled = true;
    await tester.pumpWidget(
        const SizedBox()); // a fresh Home visit re-reads the status (the provider is autoDispose)
    await tester.pumpWidget(hatlyTestApp(const PhoneVerificationBanner(),
        overrides: authOverrides(api, storage)));
    await tester.pumpAndSettle();
    expect(find.text('تحقق من رقم هاتفك'), findsOneWidget);
    await tester.tap(find.text('تحقق'));
    await tester.pumpAndSettle();
    expect(find.byType(TextField), findsOneWidget);
  });

  testWidgets(
      'if OTP is switched off between showing the prompt and tapping it, the customer gets the specific "unavailable" message — never a generic error or a stuck spinner',
      (tester) async {
    await pumpBanner(tester);
    api.otpEnabled = false;

    await tester.tap(find.text('تحقق'));
    await tester.pumpAndSettle();

    expect(find.text('التحقق من الهاتف غير متاح حاليًا'), findsOneWidget);
    expect(find.text('حدث خطأ ما'), findsNothing);
    expect(find.byType(TextField), findsNothing);
    expect(find.text('تحقق'), findsOneWidget);
    expect(api.phoneVerified, isFalse);
  });

  testWidgets(
      'a failed status check (offline) never blocks anything: the banner simply stays hidden',
      (tester) async {
    api = FakeAuthApi();
    storage = FakeAuthTokenStorage();
    // getPhoneVerificationStatus throws when the request error is scripted on the API double's status call path
    final failing = _FailingStatusApi();
    await tester.pumpWidget(hatlyTestApp(const PhoneVerificationBanner(),
        overrides: authOverrides(failing, storage)));
    await tester.pumpAndSettle();
    expect(find.text('تحقق من رقم هاتفك'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}

class _FailingStatusApi extends FakeAuthApi {
  @override
  Future<PhoneVerificationStatus> getPhoneVerificationStatus() async =>
      throw apiError('NETWORK_ERROR');
}
