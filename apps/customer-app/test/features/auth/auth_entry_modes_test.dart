import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/auth/presentation/screens/otp_verify_screen.dart';
import 'package:hatly_customer/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';

import '../../support/auth_fakes.dart';

/// The sign-in / registration journey, screen by screen, against a scripted backend — with the REAL flow + session
/// controllers and the app's own auth routing rules (signed out → /phone and /otp only; signed in → home).
const _phoneDigits = '01012345678';
const _loginToggle =
    'جديد هنا؟ أنشئ حسابًا بدلاً من ذلك'; // shown on the sign-in form
const _registerToggle =
    'هل لديك كلمة مرور بالفعل؟ سجّل الدخول بدلاً من ذلك'; // shown on the register form

class _SessionRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

late FakeAuthApi _api;
late FakeAuthTokenStorage _storage;
late ProviderContainer _container;

Future<void> _pump(
  WidgetTester tester, {
  double width = 390,
  double textScale = 1.0,
  bool dark = false,
}) async {
  HatlyTypography.useGoogleFonts = false;
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  _api = FakeAuthApi();
  _storage = FakeAuthTokenStorage();
  _container = ProviderContainer(overrides: authOverrides(_api, _storage));
  addTearDown(() => _disposeSafely(_container));
  _container.read(
      sessionControllerProvider); // starts restoring (no persisted session)
  final refresh = _SessionRefresh();
  _container.listen(sessionControllerProvider, (_, __) => refresh.ping());

  // The same auth rules as `app_router.dart`, with a probe in place of the real home shell.
  final router = GoRouter(
    initialLocation: '/phone',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = _container.read(sessionControllerProvider).status;
      final path = state.matchedLocation;
      if (status == SessionStatus.checking) return null;
      final onAuthFlow = path == '/phone' || path == '/otp';
      if (status == SessionStatus.unauthenticated) {
        return onAuthFlow ? null : '/phone';
      }
      return onAuthFlow ? '/' : null;
    },
    routes: [
      GoRoute(path: '/phone', builder: (c, s) => const PhoneEntryScreen()),
      GoRoute(path: '/otp', builder: (c, s) => const OtpVerifyScreen()),
      GoRoute(
          path: '/',
          builder: (c, s) => const Scaffold(body: Text('home-screen'))),
    ],
  );

  await tester.pumpWidget(UncontrolledProviderScope(
    container: _container,
    child: MaterialApp.router(
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: HatlyTheme.light(),
      darkTheme: HatlyTheme.dark(),
      themeMode: dark ? ThemeMode.dark : ThemeMode.light,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      builder: (context, w) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: w!,
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

/// A test that ends on the code screen leaves the resend-cooldown timer running; the framework checks for pending timers
/// BEFORE tear-downs, so such tests call this (via [_finish]) to dispose the controller — which cancels the timer — first.
void _disposeSafely(ProviderContainer container) {
  try {
    container.dispose();
  } catch (_) {
    // already disposed
  }
}

Future<void> _finish(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox());
  _disposeSafely(_container);
}

Finder get _fields => find.byType(TextField);

Future<void> _fillLogin(WidgetTester tester,
    {String phone = _phoneDigits, String password = 'secret-pass'}) async {
  await tester.enterText(_fields.at(0), phone);
  await tester.enterText(_fields.at(1), password);
}

Future<void> _showRegister(WidgetTester tester) async {
  await tester.tap(find.text(_loginToggle));
  await tester.pumpAndSettle();
}

Future<void> _fillRegister(
  WidgetTester tester, {
  String name = 'أحمد محمد',
  String phone = _phoneDigits,
  String password = 'secret-pass',
  String? confirm,
}) async {
  await tester.enterText(_fields.at(0), name);
  await tester.enterText(_fields.at(1), phone);
  await tester.enterText(_fields.at(2), password);
  await tester.enterText(_fields.at(3), confirm ?? password);
}

Future<void> _submit(WidgetTester tester) async {
  await tester.tap(find.text('متابعة'));
  await tester.pumpAndSettle();
}

void main() {
  group('the two forms', () {
    testWidgets(
        'sign-in is the default: phone + password only, with a way to register',
        (tester) async {
      await _pump(tester);
      expect(_fields, findsNWidgets(2));
      expect(find.text('الاسم الكامل'), findsNothing);
      expect(find.text('تأكيد كلمة المرور'), findsNothing);
      expect(find.text('كلمة المرور'), findsOneWidget);
      expect(find.text(_loginToggle), findsOneWidget);
    });

    testWidgets(
        'registration adds the name and a confirmation field, and can switch back',
        (tester) async {
      await _pump(tester);
      await _showRegister(tester);
      expect(_fields, findsNWidgets(4));
      expect(find.text('الاسم الكامل'), findsOneWidget);
      expect(find.text('تأكيد كلمة المرور'), findsOneWidget);
      expect(find.text(_registerToggle), findsOneWidget);

      await tester.tap(find.text(_registerToggle));
      await tester.pumpAndSettle();
      expect(_fields, findsNWidgets(2));
    });

    testWidgets(
        'switching forms drops typed passwords and stale errors, but keeps the phone',
        (tester) async {
      await _pump(tester);
      await _fillLogin(tester, password: '');
      await _submit(tester); // empty password → local error
      expect(find.text('يرجى إدخال كلمة المرور'), findsOneWidget);

      await _showRegister(tester);
      expect(find.text('يرجى إدخال كلمة المرور'), findsNothing);
      expect(tester.widget<TextField>(_fields.at(2)).controller!.text, isEmpty);
      expect(tester.widget<TextField>(_fields.at(1)).controller!.text,
          _phoneDigits);
    });

    testWidgets(
        'passwords are obscured and the form scrolls instead of overflowing (320px, large text, dark)',
        (tester) async {
      await _pump(tester, width: 320, textScale: 1.6, dark: true);
      await _showRegister(tester);
      expect(tester.widget<TextField>(_fields.at(2)).obscureText, isTrue);
      expect(tester.widget<TextField>(_fields.at(3)).obscureText, isTrue);
      expect(tester.takeException(), isNull);
    });
  });

  group('client-side validation (nothing is sent)', () {
    testWidgets('sign-in: invalid phone, then empty password', (tester) async {
      await _pump(tester);
      await _fillLogin(tester, phone: '12', password: 'secret-pass');
      await _submit(tester);
      expect(find.text('رقم الهاتف غير صحيح'), findsOneWidget);

      await _fillLogin(tester, password: '');
      await _submit(tester);
      expect(find.text('يرجى إدخال كلمة المرور'), findsOneWidget);
      expect(_api.calls, isEmpty);
    });

    testWidgets(
        'a number with ANOTHER country code (e.g. a Saudi +966) is refused with a plain "Egyptian numbers only" message — nothing is sent, nothing is accepted',
        (tester) async {
      await _pump(tester);
      for (final foreign in ['+966501234567', '00966501234567', '+971501234567', '+٩٦٦٥٠١٢٣٤٥٦٧']) {
        await _fillLogin(tester, phone: foreign, password: 'secret-pass');
        await _submit(tester);
        expect(find.text('هاتلي تقبل حاليًا أرقام الموبايل المصرية فقط (+20).'), findsOneWidget, reason: foreign);
        expect(find.text('رقم الهاتف غير صحيح'), findsNothing, reason: foreign);
      }
      await _showRegister(tester);
      await _fillRegister(tester, phone: '+966501234567');
      await _submit(tester);
      expect(find.text('هاتلي تقبل حاليًا أرقام الموبايل المصرية فقط (+20).'), findsOneWidget);
      expect(_api.calls, isEmpty);
    });

    testWidgets('a local number without any country code that is simply wrong keeps the generic message (it is not mistaken for foreign)',
        (tester) async {
      await _pump(tester);
      await _fillLogin(tester, phone: '0501234567', password: 'secret-pass');
      await _submit(tester);
      expect(find.text('رقم الهاتف غير صحيح'), findsOneWidget);
      expect(find.text('هاتلي تقبل حاليًا أرقام الموبايل المصرية فقط (+20).'), findsNothing);
      expect(_api.calls, isEmpty);
    });

    testWidgets(
        'sign-in does NOT impose the 8-character rule (an older, shorter password must still work)',
        (tester) async {
      await _pump(tester);
      await _fillLogin(tester, password: 'short');
      await _submit(tester);
      expect(find.text('home-screen'), findsOneWidget);
      expect(_api.calls, ['passwordLogin']);
    });

    testWidgets(
        'registration: name required, 8-character minimum, passwords must match',
        (tester) async {
      await _pump(tester);
      await _showRegister(tester);

      await _fillRegister(tester, name: ' ');
      await _submit(tester);
      expect(find.text('يرجى إدخال الاسم الكامل'), findsOneWidget);

      await _fillRegister(tester, password: 'short');
      await _submit(tester);
      expect(find.text('كلمة المرور يجب ألا تقل عن 8 أحرف'), findsOneWidget);

      await _fillRegister(tester, confirm: 'different-pass');
      await _submit(tester);
      expect(find.text('كلمتا المرور غير متطابقتين'), findsOneWidget);

      expect(_api.calls, isEmpty);
    });
  });

  group('OTP enabled', () {
    testWidgets(
        'ordinary sign-in goes straight in — no OTP screen, no verification call',
        (tester) async {
      await _pump(tester);
      _api.otpEnabled = true;
      await _fillLogin(tester);
      await _submit(tester);

      expect(find.text('home-screen'), findsOneWidget);
      expect(find.byType(OtpVerifyScreen), findsNothing);
      expect(_api.calls, ['passwordLogin']);
    });

    testWidgets(
        'registration → code screen (NO account yet) → right code → account created, verified, home',
        (tester) async {
      await _pump(tester);
      _api.otpEnabled = true;
      await _showRegister(tester);
      await _fillRegister(tester);
      await _submit(tester);

      expect(find.byType(OtpVerifyScreen), findsOneWidget);
      expect(find.text('أدخل رمز التحقق'), findsOneWidget);
      expect(find.text('home-screen'), findsNothing,
          reason: 'not signed in until the code is right');
      expect(_api.calls, ['requestRegistrationCode']);
      expect(_api.registeredAccounts, isEmpty,
          reason: 'no account exists until the phone is proven');

      await tester.enterText(find.byType(TextField), '123456');
      await tester.pumpAndSettle();
      expect(
          _api.calls, ['requestRegistrationCode', 'passwordRegister:123456']);
      expect(_api.registeredAccounts.single.passwordGiven, isTrue);
      expect(find.text('home-screen'), findsOneWidget);
      expect(_api.phoneVerified, isTrue);
    });

    testWidgets(
        '"Change phone number" on the code screen cancels the registration: back on the form, nothing created, nobody signed in',
        (tester) async {
      await _pump(tester);
      await _showRegister(tester);
      await _fillRegister(tester);
      await _submit(tester);
      expect(find.byType(OtpVerifyScreen), findsOneWidget);

      await tester.tap(find.text('تغيير رقم الهاتف'));
      await tester.pumpAndSettle();
      expect(find.byType(OtpVerifyScreen), findsNothing);
      expect(find.text('home-screen'), findsNothing);
      expect(_api.registeredAccounts, isEmpty);
      expect(_api.calls, ['requestRegistrationCode']);
    });

    testWidgets(
        'a wrong code shows the OTP error and keeps the screen; no account is created and nobody is signed in',
        (tester) async {
      await _pump(tester);
      await _showRegister(tester);
      await _fillRegister(tester);
      await _submit(tester);

      await tester.enterText(find.byType(TextField), '000000');
      await tester.pumpAndSettle();
      expect(find.text('الرمز غير صحيح أو منتهي الصلاحية'), findsOneWidget);
      expect(find.byType(OtpVerifyScreen), findsOneWidget);
      expect(find.text('home-screen'), findsNothing);
      expect(_api.registeredAccounts, isEmpty);
      await _finish(tester);
    });
  });

  group('OTP disabled', () {
    testWidgets(
        'registration with a password goes straight into the app — no code screen, never marked verified',
        (tester) async {
      await _pump(tester);
      _api.otpEnabled = false;
      await _showRegister(tester);
      await _fillRegister(tester);
      await _submit(tester);

      expect(find.text('home-screen'), findsOneWidget);
      expect(find.byType(OtpVerifyScreen), findsNothing);
      expect(find.byIcon(Icons.error_outline_rounded), findsNothing);
      expect(_api.phoneVerified, isFalse);
      expect(_api.registeredAccounts.single.passwordGiven, isTrue);
      expect(_api.calls, ['requestRegistrationCode', 'passwordRegister']);
    });

    testWidgets('sign-in works the same', (tester) async {
      await _pump(tester);
      _api.otpEnabled = false;
      await _fillLogin(tester);
      await _submit(tester);
      expect(find.text('home-screen'), findsOneWidget);
      expect(_api.calls, ['passwordLogin']);
    });
  });

  group(
      'server errors are specific and localized (never the generic fallback, never backend text)',
      () {
    testWidgets('wrong credentials', (tester) async {
      await _pump(tester);
      _api.loginError = apiError('UNAUTHORIZED', status: 401);
      await _fillLogin(tester);
      await _submit(tester);
      expect(find.text('رقم الهاتف أو كلمة المرور غير صحيحة'), findsOneWidget);
      expect(find.text('backend text — never shown'), findsNothing);
      expect(find.text('home-screen'), findsNothing);
    });

    testWidgets('too many failed logins', (tester) async {
      await _pump(tester);
      _api.loginError = apiError('TOO_MANY_REQUESTS',
          businessCode: 'TOO_MANY_FAILED_LOGINS', status: 429);
      await _fillLogin(tester);
      await _submit(tester);
      expect(
          find.text('محاولات تسجيل دخول فاشلة كثيرة. حاول مرة أخرى بعد قليل'),
          findsOneWidget);
    });

    testWidgets('offline', (tester) async {
      await _pump(tester);
      _api.loginError = apiError('NETWORK_ERROR');
      await _fillLogin(tester);
      await _submit(tester);
      expect(find.textContaining('لا يوجد اتصال'), findsOneWidget);

      // The form is usable again: the next attempt clears the error and signs in.
      _api.loginError = null;
      await _submit(tester);
      expect(find.text('home-screen'), findsOneWidget);
    });

    testWidgets(
        'a refused registration says so without revealing why (e.g. the phone already has a password)',
        (tester) async {
      await _pump(tester);
      await _showRegister(tester);
      _api.otpEnabled = false;
      _api.registerError = apiError('UNAUTHORIZED', status: 401);
      await _fillRegister(tester);
      await _submit(tester);
      expect(
          find.text(
              'تعذر إكمال التسجيل. إذا كان لديك حساب بالفعل فسجّل الدخول.'),
          findsOneWidget);
      expect(_api.calls, ['requestRegistrationCode', 'passwordRegister']);
    });

    testWidgets('backend validation rejection', (tester) async {
      await _pump(tester);
      _api.loginError = apiError('BAD_REQUEST', status: 400);
      await _fillLogin(tester);
      await _submit(tester);
      expect(
          find.text('تحقق من البيانات المدخلة وحاول مرة أخرى'), findsOneWidget);
    });
  });

  group('there is no way to create an account without a password', () {
    testWidgets(
        'the sign-in form offers no passwordless or code-based path; registering needs a password and its confirmation before anything is sent',
        (tester) async {
      await _pump(tester);
      expect(find.textContaining('رمز تحقق'), findsNothing);
      expect(
          find.text('لديك حساب بدون كلمة مرور؟ عيّن كلمة مرور'), findsNothing);

      await _showRegister(tester);
      expect(_fields, findsNWidgets(4)); // name, phone, password, confirmation

      await _fillRegister(tester, password: '');
      await _submit(tester);
      expect(_api.calls, isEmpty);

      await _fillRegister(tester, confirm: 'different-pass');
      await _submit(tester);
      expect(find.text('كلمتا المرور غير متطابقتين'), findsOneWidget);
      expect(_api.calls, isEmpty);
    });
  });
}
