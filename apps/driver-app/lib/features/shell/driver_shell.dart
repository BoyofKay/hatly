import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/localization/bilingual.dart';

/// The four places a driver goes: today's orders, past deliveries, money, and their own profile. The bar keeps its place while a delivery
/// detail is open on top of it.
class DriverShell extends StatelessWidget {
  const DriverShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        key: const Key('driver-nav'),
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          NavigationDestination(icon: const Icon(Icons.local_shipping_outlined), selectedIcon: const Icon(Icons.local_shipping), label: context.t('Orders', 'الطلبات')),
          NavigationDestination(icon: const Icon(Icons.history), selectedIcon: const Icon(Icons.history), label: context.t('History', 'السجل')),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), selectedIcon: const Icon(Icons.account_balance_wallet), label: context.t('Earnings', 'الأرباح')),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: context.t('Profile', 'حسابي')),
        ],
      ),
    );
  }
}
