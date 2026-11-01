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
import 'package:hatly_customer/features/addresses/data/addresses_providers.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';
import 'package:hatly_customer/features/auth/presentation/screens/otp_verify_screen.dart';
import 'package:hatly_customer/features/auth/presentation/screens/phone_entry_screen.dart';
import 'package:hatly_customer/features/auth/presentation/session_controller.dart';
import 'package:hatly_customer/features/cart/data/cart_api.dart';
import 'package:hatly_customer/features/cart/data/cart_providers.dart';
import 'package:hatly_customer/features/cart/domain/cart.dart';
import 'package:hatly_customer/features/favorites/data/favorites_api.dart';
import 'package:hatly_customer/features/favorites/domain/favorite_vendor.dart';
import 'package:hatly_customer/features/favorites/data/favorites_providers.dart';

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

/// GET endpoints a guest's browsing may touch: the backend's public catalog (sectors, vendors, vendor branches, products,
/// marketplace products, search) and the Home promotional banners (`/home-banners` and the Home product-section aggregation `/home/product-sections`, public like `/sectors` — reviewed on the backend side
/// in the route-authorization inventory). Anything else — cart, favourites, addresses, orders, wallet, support, auth — is account-only.
final _publicRequest = RegExp(
    r'^GET /(sectors(/[^/]+/subcategories)?|home-banners|home/product-sections|vendors|vendor-branches/[^/]+(/categories|/products)?|products(/[^/]+)?|catalog-products(/[^/]+)?|search)$');

/// A token store whose restore can be held back, to reproduce a deep link arriving while the session is still `checking`.
class _GatedStorage extends FakeAuthTokenStorage {
  _GatedStorage({this.gate});
  final Completer<void>? gate;
  @override
  Future<String?> get accessToken async {
    if (gate != null) await gate!.future;
    return super.accessToken;
  }
}

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

  /// The location currently on top of the navigation stack (pushed sign-in pages included).
  String where() => router.routerDelegate.currentConfiguration.uri.toString();

  Future<void> openApp(WidgetTester tester,
      {String? access, Completer<void>? restoreGate}) async {
    HatlyTypography.useGoogleFonts = false;
    tester.view.physicalSize =
        const Size(800, 1600); // tall enough for the whole sign-in form
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    authApi = FakeAuthApi();
    storage = _GatedStorage(gate: restoreGate)
      ..access = access
      ..refresh = access == null ? null : 'r-$access';
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

  /// Where the sign-in screen on top of the stack will send the customer afterwards. (`where()` does not follow PUSHED pages,
  /// so pushed sign-in screens are checked through the screen itself.)
  String? returnTo(WidgetTester tester) =>
      tester.widget<PhoneEntryScreen>(find.byType(PhoneEntryScreen)).returnTo;

  SessionStatus session() => container.read(sessionControllerProvider).status;

  /// The invariant of guest browsing, checked after every scenario.
  void expectNothingCreatedAndNothingPrivateRequested() {
    expect(authApi.calls, isEmpty,
        reason: 'no login / register / code / verification call');
    expect(authApi.registeredAccounts, isEmpty);
    expect(storage.access, isNull);
    expect(storage.refresh, isNull);
    expect(session(), SessionStatus.unauthenticated);
    for (final r in http.requests) {
      expect(r.authorization, isNull, reason: '$r carried a token');
      expect(r.toString(), matches(_publicRequest),
          reason: 'a guest requested an account-only endpoint: $r');
    }
  }

  group('a guest opens the app', () {
    testWidgets(
        'lands on the public Home shell — not the sign-in form — and the only requests are public catalog reads',
        (tester) async {
      await openApp(tester);
      expect(where(), '/');
      expect(find.byType(PhoneEntryScreen), findsNothing);
      expect(find.byKey(const Key('nav-home')), findsOneWidget);
      expectNothingCreatedAndNothingPrivateRequested();
      expect(http.requests, isNotEmpty,
          reason: 'Home really loaded public data');
    });

    testWidgets('Explore (search) is public too', (tester) async {
      await openApp(tester);
      await tester.tap(find.byKey(const Key('nav-explore')));
      await settle(tester);
      expect(where(), '/');
      expect(find.byType(PhoneEntryScreen), findsNothing);
      expectNothingCreatedAndNothingPrivateRequested();
    });

    testWidgets(
        'the account tabs (Orders, Profile) show a sign-in prompt instead of the real screens — no request is made for them',
        (tester) async {
      await openApp(tester);
      for (final tab in ['nav-orders', 'nav-profile']) {
        await tester.tap(find.byKey(Key(tab)));
        await settle(tester);
        expect({
          tab,
          find.byType(SignInRequiredView).hitTestable().evaluate().length
        }, {
          tab,
          1
        });
      }
      expectNothingCreatedAndNothingPrivateRequested();

      await tester.tap(find.byKey(const Key('guest-sign-in')).last);
      await settle(tester);
      expect(find.byType(PhoneEntryScreen), findsOneWidget);
      expect(returnTo(tester), isNull);
      expectNothingCreatedAndNothingPrivateRequested();
    });

    testWidgets(
        'the sign-in screen offers "browse without an account", which returns to Home',
        (tester) async {
      await openApp(tester);
      router.go('/phone');
      await settle(tester);
      await tester.tap(find.byKey(const Key('browse-as-guest')));
      await settle(tester);
      expect(where(), '/');
      expect(find.byType(PhoneEntryScreen), findsNothing);
      expectNothingCreatedAndNothingPrivateRequested();
    });
  });

  group('public deep links open for a guest', () {
    for (final path in [
      '/search',
      '/vendors',
      '/vendors/v1',
      '/products/p1',
      '/catalog-products/c1',
    ]) {
      testWidgets(path, (tester) async {
        await openApp(tester);
        router.go(path);
        await settle(tester);
        expect(where(), path);
        expect(find.byType(PhoneEntryScreen), findsNothing);
        expectNothingCreatedAndNothingPrivateRequested();
        expect(tester.takeException(), isNull);
      });
    }
  });

  group('account-only routes send the guest to sign-in and carry the way back',
      () {
    for (final path in [
      '/cart',
      '/checkout',
      '/checkout/address',
      '/orders/o1',
      '/orders/o1/tracking',
      '/profile/wallet',
      '/profile/loyalty',
      '/profile/addresses',
      '/addresses/add',
      '/hatly-service',
    ]) {
      testWidgets(path, (tester) async {
        await openApp(tester);
        router.go(path);
        await settle(tester); // settles: no redirect loop
        expect(find.byType(PhoneEntryScreen), findsOneWidget);
        expect(where(), '/phone?from=${Uri.encodeQueryComponent(path)}');
        expectNothingCreatedAndNothingPrivateRequested();
      });
    }

    testWidgets(
        'the Cart button in the nav bar and a pushed /cart both end at sign-in (return path /cart)',
        (tester) async {
      await openApp(tester);
      await tester.tap(find.byKey(const Key('nav-cart')));
      await settle(tester);
      expect(find.byType(PhoneEntryScreen), findsOneWidget);
      expect(returnTo(tester), '/cart');
      expectNothingCreatedAndNothingPrivateRequested();
    });

    testWidgets(
        'signing in from there returns to the cart (no loop); a customer opening /phone while signed in is sent on',
        (tester) async {
      await openApp(tester);
      router.go('/cart');
      await settle(tester);
      expect(where(), '/phone?from=%2Fcart');

      await tester.enterText(find.byType(TextField).at(0), '01012345678');
      await tester.enterText(find.byType(TextField).at(1), 'secret-pass');
      await tester.tap(find.byType(ElevatedButton));
      await settle(tester);
      expect(authApi.calls, ['passwordLogin']);
      expect(session(), SessionStatus.authenticated);
      expect(where(), '/cart');

      router.go('/phone');
      await settle(tester);
      expect(where(), '/');
    });

    testWidgets(
        'registering (OTP on) keeps the return path through the code screen, and the account only exists after the code',
        (tester) async {
      await openApp(tester);
      router.go('/orders/o1');
      await settle(tester);
      await tester.tap(find.text('جديد هنا؟ أنشئ حسابًا بدلاً من ذلك'));
      await settle(tester);
      final f = find.byType(TextField);
      await tester.enterText(f.at(0), 'أحمد محمد');
      await tester.enterText(f.at(1), '01012345678');
      await tester.enterText(f.at(2), 'secret-pass');
      await tester.enterText(f.at(3), 'secret-pass');
      await tester.tap(find.byType(ElevatedButton));
      await settle(tester);

      expect(find.byType(OtpVerifyScreen), findsOneWidget);
      expect(authApi.registeredAccounts, isEmpty);

      await tester.enterText(find.byType(TextField), '123456');
      await settle(tester);
      expect(authApi.registeredAccounts, hasLength(1));
      expect(session(), SessionStatus.authenticated);
      expect(where(), '/orders/o1');
    });

    testWidgets(
        'an unsafe return path is ignored: sign-in goes Home, never off-app or back to an auth screen',
        (tester) async {
      await openApp(tester);
      for (final from in [
        'https://evil.example/x',
        '//evil.example',
        '/phone',
        '/otp',
        ''
      ]) {
        router.go('/phone?from=${Uri.encodeQueryComponent(from)}');
        await settle(tester);
        expect(
            {from, find.byType(PhoneEntryScreen).evaluate().length}, {from, 1});
      }
      router.go('/phone?from=${Uri.encodeQueryComponent('//evil.example')}');
      await settle(tester);
      await tester.enterText(find.byType(TextField).at(0), '01012345678');
      await tester.enterText(find.byType(TextField).at(1), 'secret-pass');
      await tester.tap(find.byType(ElevatedButton));
      await settle(tester);
      expect(where(), '/');
    });
  });

  group('session state transitions', () {
    testWidgets(
        'while the session is still being restored, a public deep link is kept: splash → the same page, as a guest',
        (tester) async {
      final gate = Completer<void>();
      await openApp(tester, restoreGate: gate);
      expect(session(), SessionStatus.checking);
      router.go('/products/p1');
      await tester.pump();
      expect(where(), '/splash?from=%2Fproducts%2Fp1');

      gate.complete();
      await settle(tester);
      expect(session(), SessionStatus.unauthenticated);
      expect(where(), '/products/p1');
    });

    testWidgets(
        'a protected deep link during restore: a guest ends at sign-in with the way back',
        (tester) async {
      final gate = Completer<void>();
      await openApp(tester, restoreGate: gate);
      router.go('/orders/o1');
      await settle(tester);
      gate.complete();
      await settle(tester);
      expect(session(), SessionStatus.unauthenticated);
      expect(where(), '/phone?from=%2Forders%2Fo1');
    });

    testWidgets(
        'a protected deep link during restore: a returning customer lands on it',
        (tester) async {
      final gate = Completer<void>();
      await openApp(tester, access: 'tok', restoreGate: gate);
      router.go('/orders/o1');
      await settle(tester);
      gate.complete();
      await settle(tester);
      expect(session(), SessionStatus.authenticated);
      expect(where(), '/orders/o1');
    });

    testWidgets(
        'a signed-in customer whose session expires on a protected page is sent to sign-in (and back afterwards); on a public page they simply become a guest',
        (tester) async {
      await openApp(tester, access: 'tok');
      expect(session(), SessionStatus.authenticated);
      router.go('/orders/o1');
      await settle(tester);
      await container.read(sessionControllerProvider.notifier).forceLogout();
      await settle(tester);
      expect(where(), '/phone?from=%2Forders%2Fo1');

      router.go('/products/p1');
      await settle(tester);
      expect(where(), '/products/p1');
    });

    testWidgets(
        'signing out lands the customer on Home as a guest, not on a signed-out account tab',
        (tester) async {
      await openApp(tester, access: 'tok');
      await tester.tap(find.byKey(const Key('nav-profile')));
      await settle(tester);
      await container.read(sessionControllerProvider.notifier).logout();
      await settle(tester);
      expect(where(), '/');
      expect(find.byType(SignInRequiredView).hitTestable(), findsNothing);
      expect(find.byKey(const Key('nav-home')), findsOneWidget);
    });
  });

  group('guest-aware providers make no account request', () {
    test(
        'cart, favourites and saved addresses are empty for a guest, and signed in they fetch',
        () async {
      final cartApi = _CountingCartApi();
      final c = ProviderContainer(overrides: [
        isSignedInProvider.overrideWithValue(false),
        cartApiProvider.overrideWithValue(cartApi),
      ]);
      addTearDown(c.dispose);
      final cart = c.read(cartControllerProvider);
      expect(cart.valueOrNull?.isEmpty, isTrue);
      expect(cart.valueOrNull?.itemCount, 0);
      expect(await c.read(savedAddressesProvider.future), isEmpty);
      expect(c.read(favoritesControllerProvider).valueOrNull, isEmpty);
      expect(cartApi.getCalls, 0);

      final signed = ProviderContainer(overrides: [
        isSignedInProvider.overrideWithValue(true),
        cartApiProvider.overrideWithValue(cartApi),
        favoritesApiProvider.overrideWithValue(_FakeFavoritesApi()),
      ]);
      addTearDown(signed.dispose);
      signed.read(cartControllerProvider);
      await Future<void>.delayed(Duration.zero);
      expect(cartApi.getCalls, 1);
    });
  });

  group('requireSignIn (account-only actions on public screens)', () {
    Future<void> pumpButton(WidgetTester tester,
        {required bool signedIn}) async {
      HatlyTypography.useGoogleFonts = false;
      var taps = 0;
      final r = GoRouter(routes: [
        GoRoute(
          path: '/',
          builder: (c, s) => Scaffold(
            body: Consumer(
              builder: (context, ref, _) => TextButton(
                onPressed: () {
                  if (requireSignIn(context, ref)) taps++;
                },
                child: Text('act $taps'),
              ),
            ),
          ),
        ),
        GoRoute(
            path: '/products/:id',
            builder: (c, s) => Consumer(
                  builder: (context, ref, _) => Scaffold(
                      body: TextButton(
                          onPressed: () => requireSignIn(context, ref),
                          child: const Text('on product'))),
                )),
        GoRoute(
            path: '/phone',
            builder: (c, s) =>
                Text('sign-in ${s.uri.queryParameters['from']}')),
      ], initialLocation: '/products/p1');
      router = r;
      await tester.pumpWidget(ProviderScope(
        overrides: [isSignedInProvider.overrideWithValue(signedIn)],
        child: MaterialApp.router(routerConfig: r),
      ));
      await settle(tester);
    }

    testWidgets(
        'a guest is sent to /phone?from=<this page> and the action does not proceed',
        (tester) async {
      await pumpButton(tester, signedIn: false);
      await tester.tap(find.text('on product'));
      await settle(tester);
      expect(find.text('sign-in /products/p1'), findsOneWidget);
    });

    testWidgets('a signed-in customer proceeds with no navigation',
        (tester) async {
      await pumpButton(tester, signedIn: true);
      await tester.tap(find.text('on product'));
      await settle(tester);
      expect(find.text('on product'), findsOneWidget);
    });
  });

  group('route helpers', () {
    test('isPublicGuestPath: only the public catalog routes', () {
      for (final ok in [
        '/',
        '/search',
        '/vendors',
        '/vendors/v1',
        '/products/p1',
        '/catalog-products/c1',
        '/home/products/most-ordered',
        '/home/products/new',
        '/home/products/offers'
      ]) {
        expect({ok, isPublicGuestPath(ok)}, {ok, true});
      }
      for (final no in [
        '/cart',
        '/checkout',
        '/checkout/address',
        '/checkout/success/o1',
        '/orders/o1',
        '/profile/wallet',
        '/profile/addresses',
        '/addresses/add',
        '/hatly-service',
        '/vendors/v1/x',
        '/home/products/other',
        '/notifications',
        '/home/products',
        '/products',
        '/phone',
        '/otp',
        '/splash',
        '/search/x'
      ]) {
        expect({no, isPublicGuestPath(no)}, {no, false});
      }
    });

    test('safeReturnPath keeps in-app paths and drops everything else', () {
      expect(safeReturnPath('/cart'), '/cart');
      expect(safeReturnPath('/orders/o1?tab=2'), '/orders/o1?tab=2');
      for (final bad in [
        null,
        '',
        'cart',
        'https://evil.example',
        '//evil.example',
        '/phone',
        '/phone?from=/cart',
        '/otp',
        '/splash'
      ]) {
        expect({bad, safeReturnPath(bad)}, {bad, null});
      }
    });

    test('signInLocation encodes the return path', () {
      expect(signInLocation(), '/phone');
      expect(
          signInLocation(returnTo: '/orders/o1'), '/phone?from=%2Forders%2Fo1');
      expect(signInLocation(returnTo: 'https://evil.example'), '/phone');
    });
  });
}

class _CountingCartApi implements CartApi {
  int getCalls = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<Cart> getCart() async {
    getCalls++;
    return Cart.empty;
  }
}

class _FakeFavoritesApi implements FavoritesApi {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<FavoriteVendor>> getFavorites() async => const [];
}
