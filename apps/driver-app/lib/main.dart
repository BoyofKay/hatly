import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/localization/l10n/app_localizations.dart';
import 'core/network/providers.dart';
import 'core/routing/app_router.dart';
import 'core/theme/hatly_theme.dart';

/// Separate entry point from the customer app, per the client's
/// explicit correction: two independent Flutter applications, not one
/// role-gated app. Shares only the brand theme/colors conceptually
/// (each app keeps its own copy of hatly_theme.dart for now — promote
/// to a shared design-tokens package only once both apps are stable
/// enough that churn there is worth the coupling).
void main() {
  runApp(const ProviderScope(child: HatlyDriverApp()));
}

class HatlyDriverApp extends ConsumerWidget {
  const HatlyDriverApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);

    // Driver Push Notifications — the tap-to-navigate wiring needs
    // the router, which only exists here at the app root (not inside
    // AuthStateNotifier, which triggers Firebase initialization/token
    // registration separately — see that class's own comment). Reads
    // `orderId`/`type`/`deliveryId` from the payload (Section 10/12);
    // navigates to the EXISTING `/deliveries/:id` route (Section 12 —
    // no new Order/Delivery Details screen was created). The screen
    // itself is responsible for fetching live backend state once
    // opened, never trusting notification-payload data as
    // authoritative (unchanged, existing screen behavior).
    ref.read(fcmServiceProvider).onNotificationTapped = (data) {
      if (data['type'] == 'ORDER_ASSIGNED') {
        final deliveryId = data['deliveryId'];
        if (deliveryId != null) {
          router.go('/deliveries/$deliveryId');
        }
      }
    };

    return MaterialApp.router(
      title: 'Hatly Driver',
      debugShowCheckedModeBanner: false,
      theme: HatlyTheme.light(),
      routerConfig: router,
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
