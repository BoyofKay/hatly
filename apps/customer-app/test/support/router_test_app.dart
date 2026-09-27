import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';

/// Widget-test harness with a real [GoRouter] (so navigation is observable), the real Hatly theme
/// (light/dark), real localisations (Arabic by default) and Riverpod overrides. google_fonts is off.
Widget hatlyRouterApp({
  required List<RouteBase> routes,
  String initialLocation = '/',
  List<Override> overrides = const [],
  Locale locale = const Locale('ar'),
  bool dark = false,
  double textScale = 1.0,
}) {
  HatlyTypography.useGoogleFonts = false;
  final router = GoRouter(initialLocation: initialLocation, routes: routes);
  return ProviderScope(
    overrides: overrides,
    child: MaterialApp.router(
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: HatlyTheme.light(),
      darkTheme: HatlyTheme.dark(),
      themeMode: dark ? ThemeMode.dark : ThemeMode.light,
      locale: locale,
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
  );
}

/// A route that just shows where it is — for asserting navigation.
GoRoute probeRoute(String path, {List<String>? visited}) => GoRoute(
      path: path,
      builder: (context, state) {
        visited?.add(state.uri.toString());
        return Scaffold(
            appBar: AppBar(), body: Center(child: Text('page ${state.uri}')));
      },
    );
