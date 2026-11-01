import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/config/api_config.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/core/theme/theme_mode_provider.dart';
import 'package:hatly_customer/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';
import 'package:hatly_customer/main.dart';
import 'package:integration_test/integration_test.dart';

/// On-device reproduction of the reported "register → sign in works → log out → sign in again fails" journey, through the REAL
/// screens, against a running backend with customer OTP OFF (as on Staging). Every step is checked against the backend too.
///
///   flutter drive -d <device> --driver=test_driver/integration_test.dart --target=integration_test/auth_relogin_test.dart \
///     --dart-define=API_BASE_URL=http://localhost:3000/api/v1 --android-project-arg=hatly.allowCleartext=true
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  var converted = false;
  Future<void> shot(WidgetTester tester, String name) async {
    if (Platform.isAndroid && !converted) {
      await binding.convertFlutterSurfaceToImage();
      converted = true;
    }
    await tester.pump();
    final bytes = await binding.takeScreenshot(name);
    File('${Directory.systemTemp.path}/relogin-shots/$name.png')
      ..createSync(recursive: true)
      ..writeAsBytesSync(bytes);
  }

  Future<int> apiLogin(String phone, String password) async {
    final client = HttpClient();
    try {
      final req = await client.postUrl(Uri.parse('$kApiBaseUrl/auth/customer/password/login'));
      req.headers.contentType = ContentType.json;
      req.write(jsonEncode({'phone': phone, 'password': password}));
      final res = await req.close();
      await res.drain<void>();
      return res.statusCode;
    } finally {
      client.close();
    }
  }

  Future<void> pumpUntil(WidgetTester tester, bool Function() done, String what, {int seconds = 30}) async {
    final end = DateTime.now().add(Duration(seconds: seconds));
    while (!done()) {
      if (DateTime.now().isAfter(end)) {
        await shot(tester, 'timeout-${what.replaceAll(' ', '-')}');
        fail('timed out waiting for: $what');
      }
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> tapVisible(WidgetTester tester, Finder f) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.ensureVisible(f.last);
    await tester.pumpAndSettle();
    await tester.tap(f.last);
  }

  SessionStatus status(WidgetTester tester) =>
      ProviderScope.containerOf(tester.element(find.byType(Scaffold).first)).read(sessionControllerProvider).status;

  testWidgets('register → signed in → log out → sign in again (local and spaced +20 formats)', (tester) async {
    await TokenStorage().clear();
    final suffix = DateTime.now().millisecondsSinceEpoch.toString().substring(5); // 8 digits
    final localPhone = '010$suffix'; // what a customer types
    final e164 = '+2010$suffix';
    const password = 'Relogin-Test-1';

    await tester.pumpWidget(ProviderScope(
      overrides: [initialThemeModeProvider.overrideWithValue(ThemeMode.light)],
      child: const HatlyCustomerApp(),
    ));
    await pumpUntil(tester, () => find.byType(Scaffold).evaluate().isNotEmpty, 'app');
    await tester.pump(const Duration(seconds: 1));

    // ---- register through the real form ----
    GoRouter.of(tester.element(find.byType(Scaffold).first)).go('/phone');
    await pumpUntil(tester, () => find.byType(PhoneEntryScreen).evaluate().isNotEmpty, 'phone entry');
    await tapVisible(tester, find.text('جديد هنا؟ أنشئ حسابًا بدلاً من ذلك'));
    await tester.pumpAndSettle();
    final fields = find.descendant(of: find.byType(PhoneEntryScreen), matching: find.byType(TextField));
    expect(fields, findsNWidgets(4)); // name, phone, password, confirm
    await tester.enterText(fields.at(0), 'Relogin Test');
    await tester.enterText(fields.at(1), localPhone);
    await tester.enterText(fields.at(2), password);
    await tester.enterText(fields.at(3), password);
    await tester.testTextInput.receiveAction(TextInputAction.done); // the keyboard's "done" on the confirm field submits
    await tester.pump();
    await pumpUntil(tester, () => status(tester) == SessionStatus.authenticated, 'signed in after registration');
    expect(await TokenStorage().accessToken, isNotNull);
    // the entry screen must leave by itself — if it stays (form still filled), a second tap re-submits the registration
    await pumpUntil(tester, () => find.byType(PhoneEntryScreen).evaluate().isEmpty, 'entry screen closes after registration', seconds: 10);
    expect(await apiLogin(e164, password), 200, reason: 'the backend accepts the registered credentials');

    // ---- log out through Profile ----
    await tester.tap(find.text('حسابي').last);
    await tester.pumpAndSettle(const Duration(milliseconds: 300));
    await tester.scrollUntilVisible(find.text('تسجيل الخروج'), 300, scrollable: find.byType(Scrollable).last);
    await tester.tap(find.text('تسجيل الخروج'));
    await pumpUntil(tester, () => status(tester) == SessionStatus.unauthenticated, 'signed out');
    expect(await TokenStorage().accessToken, isNull);
    await tester.pump(const Duration(seconds: 1));
    await shot(tester, '01-after-logout');

    // ---- sign in again through the real form (as typed: spaced +20 form) ----
    if (find.byType(PhoneEntryScreen).evaluate().isEmpty) {
      GoRouter.of(tester.element(find.byType(Scaffold).first)).go('/phone');
      await pumpUntil(tester, () => find.byType(PhoneEntryScreen).evaluate().isNotEmpty, 'phone entry after logout');
    }
    await tester.pumpAndSettle();
    await shot(tester, '02-entry-after-logout');
    final loginFields = find.descendant(of: find.byType(PhoneEntryScreen), matching: find.byType(TextField));
    final mode = loginFields.evaluate().length == 2 ? 'login form' : 'NOT the login form (${loginFields.evaluate().length} fields)';
    debugPrint('after logout the entry screen shows: $mode');
    if (loginFields.evaluate().length != 2) {
      await tapVisible(tester, find.text('هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك'));
      await tester.pumpAndSettle();
    }
    final lf = find.descendant(of: find.byType(PhoneEntryScreen), matching: find.byType(TextField));
    expect(lf, findsNWidgets(2));
    await tester.enterText(lf.at(0), '+20 10 ${suffix.substring(0, 4)} ${suffix.substring(4)}');
    await tester.enterText(lf.at(1), password);
    await tester.testTextInput.receiveAction(TextInputAction.done); // the keyboard's "done" on the password field submits
    await tester.pump();
    final end = DateTime.now().add(const Duration(seconds: 20));
    while (status(tester) != SessionStatus.authenticated && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    await shot(tester, '03-after-relogin');
    expect(status(tester), SessionStatus.authenticated, reason: 'signing in again with the same phone + password must work');
    expect(mode, 'login form', reason: 'after logout the customer must land on the SIGN-IN form');
    await TokenStorage().clear();
  });
}
