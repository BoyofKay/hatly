import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hatly_customer/features/profile/presentation/widgets/password_change_section.dart';

import '../../support/auth_fakes.dart';
import '../../support/test_app.dart';

/// Profile > password: a session alone cannot change an existing password — the current one travels with the request, the
/// backend's refusals get their own messages, and an account with no password yet (a legacy account) can still set its first.
void main() {
  late FakeAuthApi api;

  Future<void> pump(WidgetTester tester) async {
    api = FakeAuthApi();
    await tester.pumpWidget(hatlyTestApp(
        const SingleChildScrollView(child: PasswordChangeSection()),
        overrides: authOverrides(api, FakeAuthTokenStorage())));
    await tester.pumpAndSettle();
  }

  Finder field(String key) => find.byKey(Key(key));
  Future<void> fill(WidgetTester tester,
      {String current = '', String next = ''}) async {
    await tester.enterText(
        find.descendant(
            of: field('current-password-field'),
            matching: find.byType(TextField)),
        current);
    await tester.enterText(
        find.descendant(
            of: field('new-password-field'), matching: find.byType(TextField)),
        next);
  }

  Future<void> save(WidgetTester tester) async {
    await tester.tap(find.text('حفظ كلمة المرور'));
    await tester.pumpAndSettle();
  }

  testWidgets('offers a current-password field and a new-password field',
      (tester) async {
    await pump(tester);
    expect(find.text('كلمة المرور الحالية'), findsOneWidget);
    expect(
        tester
            .widget<TextField>(find.descendant(
                of: field('current-password-field'),
                matching: find.byType(TextField)))
            .obscureText,
        isTrue);
    expect(
        tester
            .widget<TextField>(find.descendant(
                of: field('new-password-field'),
                matching: find.byType(TextField)))
            .obscureText,
        isTrue);
  });

  testWidgets('sends BOTH passwords, then confirms and clears the fields',
      (tester) async {
    await pump(tester);
    await fill(tester, current: 'old-password', next: 'brand-new-pass');
    await save(tester);

    expect(api.setPasswordCalls, [
      {'password': 'brand-new-pass', 'currentPassword': 'old-password'}
    ]);
    expect(find.text('تم حفظ كلمة المرور.'), findsOneWidget);
    expect(
        tester
            .widget<TextField>(find.descendant(
                of: field('new-password-field'),
                matching: find.byType(TextField)))
            .controller!
            .text,
        isEmpty);
  });

  testWidgets(
      'the current password is REQUIRED: an empty one is refused locally and nothing is sent',
      (tester) async {
    await pump(tester);
    await fill(tester, next: 'brand-new-pass');
    await save(tester);
    expect(find.text('أدخل كلمة المرور الحالية لتغييرها'), findsOneWidget);
    expect(api.setPasswordCalls, isEmpty);
    expect(find.text('تم حفظ كلمة المرور.'), findsNothing);
  });

  testWidgets(
      'a new password shorter than 8 characters is refused locally — nothing is sent',
      (tester) async {
    await pump(tester);
    await fill(tester, current: 'old-password', next: 'short');
    await save(tester);
    expect(find.text('كلمة المرور يجب ألا تقل عن 8 أحرف'), findsOneWidget);
    expect(api.setPasswordCalls, isEmpty);
  });

  for (final c in [
    ('CURRENT_PASSWORD_REQUIRED', 400, 'أدخل كلمة المرور الحالية لتغييرها'),
    ('CURRENT_PASSWORD_INVALID', 403, 'كلمة المرور الحالية غير صحيحة'),
  ]) {
    testWidgets('${c.$1}: its own message, nothing marked as saved',
        (tester) async {
      await pump(tester);
      api.setPasswordError = apiError(c.$2 == 403 ? 'FORBIDDEN' : 'BAD_REQUEST',
          businessCode: c.$1, status: c.$2);
      await fill(tester, current: 'whatever', next: 'brand-new-pass');
      await save(tester);
      expect(find.text(c.$3), findsOneWidget);
      expect(find.text('تم حفظ كلمة المرور.'), findsNothing);
    });
  }

  testWidgets(
      'the per-account lockout and offline errors are specific, not the generic fallback',
      (tester) async {
    await pump(tester);
    api.setPasswordError = apiError('TOO_MANY_REQUESTS',
        businessCode: 'TOO_MANY_FAILED_LOGINS', status: 429);
    await fill(tester, current: 'whatever', next: 'brand-new-pass');
    await save(tester);
    expect(find.text('محاولات تسجيل دخول فاشلة كثيرة. حاول مرة أخرى بعد قليل'),
        findsOneWidget);

    api.setPasswordError = apiError('NETWORK_ERROR');
    await save(tester);
    expect(find.textContaining('لا يوجد اتصال'), findsOneWidget);
    expect(find.text('حدث خطأ ما'), findsNothing);
  });
}
