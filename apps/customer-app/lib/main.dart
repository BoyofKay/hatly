import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart' show kReleaseMode;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/localization/locale_provider.dart';
import 'core/storage/locale_preference_storage.dart';
import 'core/config/api_config.dart';
import 'core/error/error_reporting.dart';
import 'core/localization/l10n/app_localizations.dart';
import 'core/network/providers.dart';
import 'core/routing/app_router.dart';
import 'core/storage/theme_preference_storage.dart';
import 'core/theme/hatly_theme.dart';
import 'core/theme/theme_mode_provider.dart';
import 'core/routing/router_stack.dart';
import 'shared_widgets/customer_global_header.dart';
import 'shared_widgets/home_hero_artwork.dart';
import 'features/home/data/home_banners_providers.dart';
import 'features/home/presentation/widgets/home_search_entry.dart';
import 'features/shell/presentation/shell_tab_provider.dart';

/// Customer Push Notifications — background state. Runs in a separate
/// background isolate with NO access to this app's Riverpod
/// container, router, or session state, so — per the explicit
/// requirement — it does the absolute minimum and nothing else: no
/// navigation, no business mutations, no UI. It must be a top-level
/// (or static) function and carry this pragma, or the background
/// isolate cannot find it as its entry point.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // The background isolate has its own separate Firebase state —
  // this is the documented, required call, not a duplicate
  // initialization of the main isolate's own (see FcmService.initialize()).
  await Firebase.initializeApp();
}

Future<void> main() async {
  // Fail fast (release only) if the app was built without a reachable backend URL — see apiBaseUrlProblem. Deliberately OUTSIDE the
  // guarded zone below: a misconfigured release must crash loudly, not be swallowed into a blank screen.
  if (kReleaseMode) {
    final problem = apiBaseUrlProblem(kApiBaseUrl);
    if (problem != null) throw StateError(problem);
  }
  // G-22: every uncaught error (framework, platform, async) ends in ErrorReporting.sink.
  ErrorReporting.runGuarded(_start);
}

Future<void> _start() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    // Must be registered before runApp() per firebase_messaging's own
    // contract. Wrapped defensively — same "never block app startup"
    // discipline as FcmService.initialize()'s own try/catch in
    // SessionController: an unconfigured Firebase project (no
    // google-services.json/GoogleService-Info.plist yet, see
    // FcmService's own comment) must not crash a cold start.
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (_) {}
  // Dark Mode — read the customer's saved theme choice (if any) BEFORE
  // runApp, so the very first frame already renders in the right theme
  // (no flash of Light then a rebuild into Dark). See
  // core/theme/theme_mode_provider.dart for why this is a Provider
  // override rather than an async value read inside the widget tree.
  final initialThemeMode =
      await ThemePreferenceStorage().readThemeMode() ?? ThemeMode.light;
  final initialLocale =
      await LocalePreferenceStorage().readLocale() ?? const Locale('ar');
  runApp(ProviderScope(
    overrides: [
      initialThemeModeProvider.overrideWithValue(initialThemeMode),
      initialLocaleProvider.overrideWithValue(initialLocale),
    ],
    child: const HatlyCustomerApp(),
  ));
}

final _customerBackDispatcherProvider = Provider<RootBackButtonDispatcher>((ref) => CustomerBackButtonDispatcher(ref.watch(appRouterProvider)));

class HatlyCustomerApp extends ConsumerWidget {
  const HatlyCustomerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    final banners = ref.watch(homeBannersProvider).valueOrNull ?? const [];
    final shellTab = ref.watch(shellTabIndexProvider);
    final homeScrolled = ref.watch(homeHeroScrolledProvider);

    // Customer Push Notifications / Deep Links — the tap-to-navigate
    // wiring needs the router, which only exists here at the app
    // root (not inside SessionController, which triggers Firebase
    // initialization/token registration separately — see that
    // class's own comment). Parsing/validation and the auth-readiness
    // race (terminated cold start / logged-out tap / login-after-tap)
    // are centralized in `NotificationNavigationCoordinator` — this is
    // the ONLY place that assigns `navigate` or `onNotificationTapped`
    // and the ONLY place that calls `router.go` for a notification.
    // Navigates to the EXISTING `/orders/:id` route — no new screen
    // created.
    final notificationNavigation = ref.read(notificationNavigationProvider);
    // `openOnTopOfHome`, not `go`: a notification must never leave Order Details as the ONLY route (no Back, and Android's
    // system Back would exit the app) — see core/routing/router_stack.dart.
    notificationNavigation.navigate = router.openOnTopOfHome;
    ref.read(fcmServiceProvider).onNotificationTapped =
        notificationNavigation.handleTappedPayload;

    return MaterialApp.router(
      title: 'Hatly',
      debugShowCheckedModeBanner: false,
      theme: HatlyTheme.light(),
      darkTheme: HatlyTheme.dark(),
      themeMode: ref.watch(themeModeProvider),
      routeInformationProvider: router.routeInformationProvider,
      routeInformationParser: router.routeInformationParser,
      routerDelegate: router.routerDelegate,
      backButtonDispatcher: ref.watch(_customerBackDispatcherProvider),
      builder: (context, child) => AnimatedBuilder(
        animation: router.routerDelegate,
        builder: (context, _) {
          final matches = router.routerDelegate.currentConfiguration.matches;
          final onHome = matches.length == 1 &&
              router.routerDelegate.currentConfiguration.uri.path == '/' &&
              shellTab == ShellTab.home;
          final surface = Theme.of(context).scaffoldBackgroundColor;
          final dark = Theme.of(context).brightness == Brightness.dark;
          final topInset = MediaQuery.viewPaddingOf(context).top;
          final routeContent = MediaQuery.removePadding(
            context: context, removeTop: true,
            child: HomePinnedSearchScope(
              pinned: onHome, hasArtwork: banners.isNotEmpty,
              child: child ?? const SizedBox.shrink(),
            ),
          );
          final header = Column(mainAxisSize: MainAxisSize.min, children: [
            CustomerGlobalHeader(router: router),
            if (onHome) Padding(
              padding: const EdgeInsets.only(top: 6, bottom: 8),
              child: HomeSearchEntry(onTap: () => router.push('/search')),
            ),
          ]);
          return AnnotatedRegion<SystemUiOverlayStyle>(
            value: (dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark).copyWith(statusBarColor: surface),
            child: Column(children: [
              ColoredBox(color: surface, child: SizedBox(width: double.infinity, height: topInset)),
              Expanded(child: Stack(children: [
                Positioned.fill(top: onHome ? 0 : 52, child: routeContent),
                Positioned(top: 0, left: 0, right: 0, child: Material(
                  type: MaterialType.transparency,
                  child: ColoredBox(
                    color: onHome && banners.isNotEmpty && !homeScrolled ? Colors.transparent : surface,
                    child: header,
                  ),
                )),
              ])),
            ]),
          );
        },
      ),

      // Arabic is primary (spec section 4/19) and the default; the customer
      // can switch to English in Settings (localeProvider, persisted).
      // Flutter derives RTL/LTR automatically from the active locale via
      // Directionality, so no manual RTL flag is needed as long as every
      // widget uses logical (start/end) properties instead of hard-coded
      // left/right.
      locale: ref.watch(localeProvider),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
    );
  }
}
