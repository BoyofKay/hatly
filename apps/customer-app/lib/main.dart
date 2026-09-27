import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/localization/l10n/app_localizations.dart';
import 'core/network/providers.dart';
import 'core/routing/app_router.dart';
import 'core/theme/hatly_theme.dart';
import 'core/theme/theme_mode_provider.dart';

void main() {
  runApp(const ProviderScope(child: HatlyCustomerApp()));
}

class HatlyCustomerApp extends ConsumerWidget {
  const HatlyCustomerApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    // Customer Push Notifications (Chunk B) — the tap-to-navigate
    // wiring needs the router, which only exists here at the app
    // root (not inside SessionController, which triggers Firebase
    // initialization/token registration separately — see that
    // class's own comment). Mirrors the Driver app's own main.dart
    // wiring exactly (apps/driver-app/lib/main.dart). Reads
    // `type`/`orderId` from the payload (Chunk A's approved
    // contract); navigates to the EXISTING `/orders/:id` route — no
    // new screen created. That route already sits behind this app's
    // own global unauthenticated-redirect (see app_router.dart's own
    // comment), so a tap arriving before/after a session ends is
    // already safely handled without any extra guard needed here.
    ref.read(fcmServiceProvider).onNotificationTapped = (data) {
      const approvedTypes = {
        'ORDER_CONFIRMED',
        'ORDER_CANCELLED',
        'ORDER_ON_THE_WAY',
        'ORDER_DELIVERED',
        'ORDER_FAILED_DELIVERY',
      };
      if (approvedTypes.contains(data['type'])) {
        final orderId = data['orderId'];
        if (orderId != null) {
          router.go('/orders/$orderId');
        }
      }
    };

    return MaterialApp.router(
      title: 'Hatly',
      debugShowCheckedModeBanner: false,
      theme: HatlyTheme.light(),
      darkTheme: HatlyTheme.dark(),
      themeMode: ref.watch(themeModeProvider),
      routerConfig: router,

      // Arabic is primary (spec section 4/19) — listed first so it's
      // the default locale; Flutter derives RTL/LTR automatically from
      // the active locale via Directionality, so no manual RTL flag is
      // needed as long as every widget uses logical (start/end)
      // properties instead of hard-coded left/right.
      locale: const Locale('ar'),
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
