import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/auth/data/auth_api.dart';
import 'package:hatly_customer/features/auth/presentation/otp_flow_controller.dart';
import 'package:hatly_customer/features/auth/presentation/screens/forced_password_change_screen.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';

import '../../support/auth_fakes.dart';
import '../../support/test_app.dart';

/// Owner decision 2026-11-23: after a temporary password set by Hatly, the customer chooses their own before using the app.
void main() {
  late FakeAuthApi api;

  Future<ProviderContainer> pump(WidgetTester tester) async {
    api = FakeAuthApi();
    await tester.pumpWidget(hatlyTestApp(const ForcedPasswordChangeScreen(),
        overrides: authOverrides(api, FakeAuthTokenStorage())));
    await tester.pumpAndSettle();
    final c = ProviderScope.containerOf(
        tester.element(find.byType(ForcedPasswordChangeScreen)));
    c.read(sessionControllerProvider); // let the stored-session check finish first
    await tester.pumpAndSettle();
    c
        .read(sessionControllerProvider.notifier)
        .markAuthenticated(mustChangePassword: true);
    return c;
  }

  Future<void> fill(WidgetTester tester, String key, String text) =>
      tester.enterText(
          find.descendant(
              of: find.byKey(Key(key)), matching: find.byType(TextField)),
          text);

  Future<void> save(WidgetTester tester) async {
    await tester.ensureVisible(find.byKey(const Key('temp-password-save')));
    await tester.tap(find.byKey(const Key('temp-password-save')));
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  testWidgets('sends the temporary + new password, then the app opens',
      (tester) async {
    final c = await pump(tester);
    await fill(tester, 'temp-password-current', 'abcd-2345');
    await fill(tester, 'temp-password-new', 'my-own-pass');
    await fill(tester, 'temp-password-confirm', 'my-own-pass');
    await save(tester);
    expect(api.setPasswordCalls, [
      {'password': 'my-own-pass', 'currentPassword': 'abcd-2345'}
    ]);
    expect(c.read(sessionControllerProvider).mustChangePassword, isFalse);
  });

  testWidgets('checks before sending: repeat mismatch, same as temporary',
      (tester) async {
    final c = await pump(tester);
    await fill(tester, 'temp-password-current', 'abcd-2345');
    await fill(tester, 'temp-password-new', 'my-own-pass');
    await fill(tester, 'temp-password-confirm', 'other-pass');
    await save(tester);
    expect(find.text('كلمتا المرور الجديدتان غير متطابقتين.'), findsOneWidget);

    await fill(tester, 'temp-password-new', 'abcd-2345');
    await fill(tester, 'temp-password-confirm', 'abcd-2345');
    await save(tester);
    expect(find.text('اختر كلمة مرور مختلفة عن المؤقتة.'), findsOneWidget);
    expect(api.setPasswordCalls, isEmpty);
    expect(c.read(sessionControllerProvider).mustChangePassword, isTrue);
  });

  test('a login with a temporary password marks the session', () async {
    final fake = FakeAuthApi()
      ..loginTokens = const AuthTokens(
          accessToken: 'a', refreshToken: 'r', mustChangePassword: true);
    final c = ProviderContainer(
        overrides: authOverrides(fake, FakeAuthTokenStorage()));
    addTearDown(c.dispose);
    await Future<void>.delayed(Duration.zero);
    await c
        .read(otpFlowControllerProvider.notifier)
        .passwordLogin(normalizedPhone: '+201000000009', password: 'abcd-2345');
    expect(
        c.read(sessionControllerProvider).status, SessionStatus.authenticated);
    expect(c.read(sessionControllerProvider).mustChangePassword, isTrue);

    c.read(sessionControllerProvider.notifier).passwordChanged();
    expect(c.read(sessionControllerProvider).mustChangePassword, isFalse);
  });

  test('the server lock only applies to a signed-in session', () async {
    final c = ProviderContainer(
        overrides: authOverrides(FakeAuthApi(), FakeAuthTokenStorage()));
    addTearDown(c.dispose);
    await Future<void>.delayed(Duration.zero);
    c.read(sessionControllerProvider.notifier).requirePasswordChange();
    expect(c.read(sessionControllerProvider).mustChangePassword, isFalse);
    c.read(sessionControllerProvider.notifier).markAuthenticated();
    c.read(sessionControllerProvider.notifier).requirePasswordChange();
    expect(c.read(sessionControllerProvider).mustChangePassword, isTrue);
  });
}
