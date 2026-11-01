import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hatly_customer/core/localization/l10n/app_localizations.dart';
import 'package:hatly_customer/core/theme/hatly_theme.dart';
import 'package:hatly_customer/features/auth/presentation/auth_gate.dart';

/// Widget-test harness: real Hatly theme (light or dark), real localisations,
/// Arabic (RTL) by default. google_fonts is switched off so nothing tries to
/// download a font in a test.
Widget hatlyTestApp(
  Widget child, {
  Locale locale = const Locale('ar'),
  bool dark = false,
  List<Override> overrides = const [],
  double textScale = 1.0,
}) {
  HatlyTypography.useGoogleFonts = false;
  return ProviderScope(
    // Widget tests exercise the signed-in customer unless a test says otherwise (pass its own `isSignedInProvider` override
    // — it comes later in the list and wins).
    overrides: [isSignedInProvider.overrideWithValue(true), ...overrides],
    child: MaterialApp(
      debugShowCheckedModeBanner: false,
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
      home: Scaffold(body: child),
    ),
  );
}
