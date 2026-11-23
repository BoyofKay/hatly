import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/core/network/api_exception.dart';
import 'package:hatly_customer/features/auth/presentation/screens/forgot_password_screen.dart';

import '../../support/auth_fakes.dart';
import '../../support/test_app.dart';

/// Owner decision 2026-11-23: request-based "Forgot password?" — send a request, then type the temporary password Hatly gives with a
/// new one on the same screen (or cancel and use the old password).
void main() {
  late FakeAuthApi api;

  Future<void> pump(WidgetTester tester) async {
    api = FakeAuthApi();
    await tester.pumpWidget(hatlyTestApp(const ForgotPasswordScreen(initialPhone: '01012345678'), overrides: authOverrides(api, FakeAuthTokenStorage())));
    await tester.pumpAndSettle();
  }

  Future<void> type(WidgetTester tester, String key, String text) =>
      tester.enterText(find.descendant(of: find.byKey(Key(key)), matching: find.byType(TextField)), text);
  Future<void> tap(WidgetTester tester, String key) async {
    await tester.ensureVisible(find.byKey(Key(key)));
    await tester.tap(find.byKey(Key(key)));
    await tester.pumpAndSettle();
  }

  testWidgets('send request → enter the temporary password and a new one → done', (tester) async {
    await pump(tester);
    await tap(tester, 'forgot-send');
    expect(api.resetRequests, ['+201012345678']);
    await type(tester, 'forgot-temp', 'abcd-2345x');
    await type(tester, 'forgot-new', 'my-new-pass');
    await type(tester, 'forgot-confirm', 'my-new-pass');
    await tap(tester, 'forgot-complete');
    expect(api.resetCompletions.single, {'phone': '+201012345678', 'temp': 'abcd-2345x', 'new': 'my-new-pass'});
    expect(find.byKey(const Key('forgot-done')), findsOneWidget);
  });

  testWidgets('a wrong temporary password shows the tries left; an expired one sends them back to request again', (tester) async {
    await pump(tester);
    await tap(tester, 'forgot-have-temp');
    api.completeResetError = ApiException(code: 'BAD_REQUEST', message: 'x', details: {'code': 'TEMP_PASSWORD_INVALID', 'attemptsLeft': 3}, statusCode: 400);
    await type(tester, 'forgot-temp', 'wrong');
    await type(tester, 'forgot-new', 'my-new-pass');
    await type(tester, 'forgot-confirm', 'my-new-pass');
    await tap(tester, 'forgot-complete');
    expect(find.textContaining('3'), findsWidgets);
    expect(find.byKey(const Key('forgot-error')), findsOneWidget);

    api.completeResetError = ApiException(code: 'BAD_REQUEST', message: 'x', details: {'code': 'TEMP_PASSWORD_EXPIRED'}, statusCode: 400);
    await tap(tester, 'forgot-complete');
    expect(find.byKey(const Key('forgot-send')), findsOneWidget);
  });
}
