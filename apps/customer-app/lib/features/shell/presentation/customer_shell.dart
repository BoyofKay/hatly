import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../shared_widgets/hatly_floating_nav_bar.dart';
import '../../cart/data/cart_providers.dart';
import '../../home/presentation/home_screen.dart';
import '../../search/presentation/search_screen.dart';
import '../../orders/presentation/orders_screen.dart';
import '../../favorites/presentation/favorites_screen.dart';
import '../../profile/presentation/profile_screen.dart';
import '../../auth/presentation/auth_gate.dart';
import 'shell_tab_provider.dart';

/// The app shell (public for guests; account tabs need a session): a single route ('/') whose tab state lives in
/// [shellTabIndexProvider] rather than local State, so Home's shortcuts (profile
/// avatar, favorites) can change it without a reference to this widget.
///
/// Navigation architecture is UNCHANGED (same tabs, same indices, same
/// IndexedStack, Cart is still the pushed `/cart` route). Only the bar's
/// look changed to the approved floating design, with these destinations:
/// Home · Explore (the existing Search tab) · Cart (pushes `/cart`) · Orders ·
/// Profile. Favorites keeps its tab slot but is reached from Home's shortcut.
class CustomerShell extends ConsumerWidget {
  const CustomerShell({super.key});

  /// Home and Explore are public. Orders / Favorites / Profile need an account: a GUEST gets a sign-in prompt in their place
  /// (the real screens are not even built, so no authenticated request is made).
  static List<Widget> tabsFor({required bool signedIn}) => [
        const HomeScreen(),
        // Explore tab: a discovery page, so it must not grab the keyboard.
        const SearchScreen(autofocus: false),
        signedIn ? const OrdersScreen() : const SignInRequiredView(),
        signedIn ? const FavoritesScreen() : const SignInRequiredView(),
        signedIn ? const ProfileScreen() : const SignInRequiredView(),
      ];

  /// Bar position → shell tab index (null = not a tab: Cart pushes a route).
  static const List<int?> barToTab = [
    ShellTab.home,
    ShellTab.search,
    null,
    ShellTab.orders,
    ShellTab.profile
  ];

  /// Inverse of [barToTab] for highlighting; a tab without a bar item
  /// (Favorites) highlights nothing.
  static int? barIndexForTab(int tab) {
    final i = barToTab.indexOf(tab);
    return i < 0 ? null : i;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final tab = ref.watch(shellTabIndexProvider);
    final signedIn = ref.watch(isSignedInProvider);
    final cartCount = signedIn
        ? ref.watch(cartControllerProvider).valueOrNull?.itemCount ?? 0
        : 0;

    // After signing out, return to Home instead of leaving the (now signed-out) account tab selected.
    ref.listen<bool>(isSignedInProvider, (was, now) {
      if (was == true && !now) {
        ref.read(shellTabIndexProvider.notifier).state = ShellTab.home;
      }
    });

    return Scaffold(
      body: IndexedStack(index: tab, children: tabsFor(signedIn: signedIn)),
      bottomNavigationBar: HatlyFloatingNavBar(
        selectedIndex: barIndexForTab(tab),
        onTap: (barIndex) {
          final target = barToTab[barIndex];
          if (target == null) {
            context.push('/cart');
          } else {
            ref.read(shellTabIndexProvider.notifier).state = target;
          }
        },
        items: [
          HatlyNavItem(
              key: const Key('nav-home'),
              label: l10n.home,
              icon: Icons.home_outlined,
              activeIcon: Icons.home_rounded),
          HatlyNavItem(
              key: const Key('nav-explore'),
              label: l10n.navExplore,
              icon: Icons.explore_outlined,
              activeIcon: Icons.explore_rounded),
          HatlyNavItem(
            key: const Key('nav-cart'),
            label: l10n.cart,
            icon: Icons.shopping_bag_outlined,
            activeIcon: Icons.shopping_bag_rounded,
            badgeCount: cartCount,
          ),
          HatlyNavItem(
              key: const Key('nav-orders'),
              label: l10n.orders,
              icon: Icons.receipt_long_outlined,
              activeIcon: Icons.receipt_long_rounded),
          HatlyNavItem(
              key: const Key('nav-profile'),
              label: l10n.profile,
              icon: Icons.person_outline_rounded,
              activeIcon: Icons.person_rounded),
        ],
      ),
    );
  }
}
