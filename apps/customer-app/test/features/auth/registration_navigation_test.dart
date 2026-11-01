import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/network/api_client.dart';
import 'package:hatly_customer/core/network/providers.dart';
import 'package:hatly_customer/core/routing/app_router.dart';
import 'package:hatly_customer/core/storage/token_storage.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/auth/presentation/screens/otp_verify_screen.dart';
import 'package:hatly_customer/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';

import '../../support/auth_fakes.dart';

/// Guest browsing, driven through the REAL router, session controller and API client (only the network edge is faked, by a
/// Dio adapter that records every request). A visitor with no session can browse the public marketplace; nothing is created
/// for them (no account, no token, no authenticated or auth request); account-only routes and actions send them to sign-in
/// and back.

// ---- the network edge ----------------------------------------------------------------------------------------------------

class _Recorded {
  _Recorded(this.method, this.path, this.authorization);
  final String method;
  final String path;
  final String? authorization;
  @override
  String toString() => '$method $path';
}

/// Answers every request with an empty-but-valid envelope and remembers it.
class _RecordingAdapter implements HttpClientAdapter {
  final requests = <_Recorded>[];

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    requests.add(_Recorded(options.method, options.path,
        options.headers['Authorization'] as String?));
    return ResponseBody.fromString(
        jsonEncode({'data': <dynamic>[], 'meta': {}}), 200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType]
        });
  }

  @override
  void close({bool force = false}) {}
}

/// A token store whose restore can be held back, to reproduce a deep link arriving while the session is still `checking`.
class _GatedStorage extends FakeAuthTokenStorage {}

/// The real Home / splash keep animating (carousels, progress indicators), so `pumpAndSettle` would never return; a few
/// bounded frames are enough for navigation and the (instant) fake network to settle.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  late FakeAuthApi authApi;
  late _GatedStorage storage;
  late _RecordingAdapter http;
  late ProviderContainer container;
  late GoRouter router;

  /// The page on top of the stack (follows pushed pages, unlike the router's base uri).
  String where() =>
      router.routerDelegate.currentConfiguration.last.matchedLocation;

  /// Every page currently in the navigation stack, bottom first.
  List<String> stack() => router.routerDelegate.currentConfiguration.matches
      .map((m) => m.matchedLocation)
      .toList();

  Future<void> openApp(WidgetTester tester, {bool otpOn = true}) async {
    HatlyTypography.useGoogleFonts = false;
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    authApi = FakeAuthApi()..otpEnabled = otpOn;
    storage = _GatedStorage();
    http = _RecordingAdapter();
    final client = ApiClient(
        baseUrl: 'http://api.test/api/v1',
        tokenStorage: storage as TokenStorage);
    client.dio.httpClientAdapter = http;
    container = ProviderContainer(overrides: [
      ...authOverrides(authApi, storage),
      apiClientProvider.overrideWithValue(client),
    ]);
    addTearDown(container.dispose);
    router = container.read(appRouterProvider);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        routerConfig: router,
        theme: HatlyTheme.light(),
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar'), Locale('en')],
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
      ),
    ));
    await settle(tester);
  }

  SessionStatus session() => container.read(sessionControllerProvider).status;

  Future<void> fillRegistration(WidgetTester tester,
      {String phone = '01012345678'}) async {
    await tester.tap(find.text('جديد هنا؟ أنشئ حسابًا بدلاً من ذلك'));
    await settle(tester);
    final f = find.byType(TextField);
    await tester.enterText(f.at(0), 'أحمد محمد');
    await tester.enterText(f.at(1), phone);
    await tester.enterText(f.at(2), 'secret-pass');
    await tester.enterText(f.at(3), 'secret-pass');
    await tester.tap(find.byType(ElevatedButton));
    await settle(tester);
  }

  void expectNoAuthScreensLeft(WidgetTester tester) {
    expect(find.byType(PhoneEntryScreen), findsNothing,
        reason: 'no sign-up screen left on screen');
    expect(find.byType(OtpVerifyScreen), findsNothing,
        reason: 'no code screen left on screen');
    expect(stack().where((l) => l == '/phone' || l == '/otp'), isEmpty,
        reason: 'no auth page left in the back stack: ${stack()}');
  }

  testWidgets(
      'A. started from a product page (guest taps add-to-cart), OTP ON: code → back on that product, stack is Home → product',
      (tester) async {
    await openApp(tester);
    router.push('/products/p1');
    await settle(tester);
    router.push(
        '/phone?from=%2Fproducts%2Fp1'); // exactly what requireSignIn does
    await settle(tester);
    expect(stack(), ['/', '/products/p1', '/phone']);

    await fillRegistration(tester);
    expect(find.byType(OtpVerifyScreen), findsOneWidget);
    expect(session(), SessionStatus.unauthenticated,
        reason: 'not signed in until the code is right');
    expect(authApi.registeredAccounts, isEmpty);

    await tester.enterText(find.byType(TextField), '123456');
    await settle(tester);
    expect(session(), SessionStatus.authenticated);
    expect(where(), '/products/p1');
    expectNoAuthScreensLeft(tester);
    expect(stack(), ['/', '/products/p1'],
        reason:
            'Back from the product must reach Home, not a stale registration page');
  });

  testWidgets(
      'B. started from the Orders tab prompt (no return path), OTP ON: ends on Home with an empty auth stack',
      (tester) async {
    await openApp(tester);
    await tester.tap(find.byKey(const Key('nav-orders')));
    await settle(tester);
    await tester.tap(find.byKey(const Key('guest-sign-in')).last);
    await settle(tester);
    expect(stack().last, '/phone');
    await fillRegistration(tester);
    await tester.enterText(find.byType(TextField), '123456');
    await settle(tester);
    expect(session(), SessionStatus.authenticated);
    expect(where(), '/');
    expectNoAuthScreensLeft(tester);
    expect(stack(), ['/']);
  });

  testWidgets(
      'C. OTP OFF (no verification step): registers at once and returns to where it started',
      (tester) async {
    await openApp(tester, otpOn: false);
    router.push('/products/p1');
    await settle(tester);
    router.push('/phone?from=%2Fproducts%2Fp1');
    await settle(tester);
    await fillRegistration(tester);
    expect(find.byType(OtpVerifyScreen), findsNothing);
    expect(session(), SessionStatus.authenticated);
    expect(authApi.registeredAccounts, hasLength(1));
    expect(where(), '/products/p1');
    expectNoAuthScreensLeft(tester);
    expect(stack(), ['/', '/products/p1']);
  });

  testWidgets(
      'D. leaving the code screen with Back cancels the registration (nothing created) and returns to the form; Back again returns to the product',
      (tester) async {
    await openApp(tester);
    router.push('/products/p1');
    await settle(tester);
    router.push('/phone?from=%2Fproducts%2Fp1');
    await settle(tester);
    await fillRegistration(tester);
    expect(find.byType(OtpVerifyScreen), findsOneWidget);

    router.pop(); // system/AppBar back from the code screen
    await settle(tester);
    expect(find.byType(OtpVerifyScreen), findsNothing);
    expect(find.byType(PhoneEntryScreen), findsOneWidget);
    expect(authApi.registeredAccounts, isEmpty);
    expect(session(), SessionStatus.unauthenticated);

    router.pop(); // back from the sign-in form
    await settle(tester);
    expect(where(), '/products/p1');
    expect(session(), SessionStatus.unauthenticated);
  });

  testWidgets(
      'E. a wrong code keeps the customer on the code screen (no navigation, nothing created); the right code then completes it',
      (tester) async {
    await openApp(tester);
    router.push('/phone?from=%2Fcart');
    await settle(tester);
    await fillRegistration(tester);
    await tester.enterText(find.byType(TextField), '000000');
    await settle(tester);
    expect(find.byType(OtpVerifyScreen), findsOneWidget);
    expect(session(), SessionStatus.unauthenticated);
    expect(authApi.registeredAccounts, isEmpty);

    await tester.enterText(find.byType(TextField), '123456');
    await settle(tester);
    expect(session(), SessionStatus.authenticated);
    expect(where(), '/cart');
    expectNoAuthScreensLeft(tester);
  });

  testWidgets(
      'F. a refused registration (existing phone) stays on the form — no success navigation, no OTP screen, retry works',
      (tester) async {
    await openApp(tester, otpOn: false);
    router.push('/phone?from=%2Fcart');
    await settle(tester);
    authApi.registerError = apiError('CONFLICT', status: 409);
    await fillRegistration(tester);
    expect(find.byType(PhoneEntryScreen), findsOneWidget);
    expect(session(), SessionStatus.unauthenticated);
    expect(authApi.registeredAccounts, isEmpty);

    authApi.registerError = null;
    await tester.tap(find.byType(ElevatedButton));
    await settle(tester);
    expect(session(), SessionStatus.authenticated);
    expect(where(), '/cart');
    expectNoAuthScreensLeft(tester);
  });

  testWidgets(
      'G. entered by a redirect (a deep link to a protected page): registering lands on that page and no auth page remains',
      (tester) async {
    await openApp(tester, otpOn: false);
    router.go(
        '/cart'); // the router sends the guest to /phone?from=%2Fcart as the only page
    await settle(tester);
    expect(stack(), ['/phone']);
    await fillRegistration(tester);
    expect(session(), SessionStatus.authenticated);
    expect(where(), '/cart');
    expectNoAuthScreensLeft(tester);
  });

  testWidgets(
      'H. signing in (not registering) from a pushed sign-in page also leaves the page and returns to the origin',
      (tester) async {
    await openApp(tester);
    router.push('/products/p1');
    await settle(tester);
    router.push('/phone?from=%2Fproducts%2Fp1');
    await settle(tester);
    await tester.enterText(find.byType(TextField).at(0), '01012345678');
    await tester.enterText(find.byType(TextField).at(1), 'secret-pass');
    await tester.tap(find.byType(ElevatedButton));
    await settle(tester);
    expect(authApi.calls, contains('passwordLogin'));
    expect(where(), '/products/p1');
    expect(stack(), ['/', '/products/p1']);
    expectNoAuthScreensLeft(tester);
  });

  testWidgets(
      'I. "change phone number" on the code screen cancels (nothing created) and the typed password is gone; a fresh attempt then succeeds',
      (tester) async {
    await openApp(tester);
    router.push('/phone');
    await settle(tester);
    await fillRegistration(tester);
    expect(find.byType(OtpVerifyScreen), findsOneWidget);
    await tester.tap(find.text('تغيير رقم الهاتف'));
    await settle(tester);
    expect(find.byType(OtpVerifyScreen), findsNothing);
    expect(authApi.registeredAccounts, isEmpty);
    expect(session(), SessionStatus.unauthenticated);
    // a second attempt, this time completed
    await tester.tap(find.byType(ElevatedButton));
    await settle(tester);
    expect(find.byType(OtpVerifyScreen), findsOneWidget);
    await tester.enterText(find.byType(TextField), '123456');
    await settle(tester);
    expect(session(), SessionStatus.authenticated);
    expect(authApi.registeredAccounts, hasLength(1));
    expectNoAuthScreensLeft(tester);
  });
}
