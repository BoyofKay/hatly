import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../overview/overview_api.dart';
import 'package:go_router/go_router.dart';
import '../../core/localization/bilingual.dart';

/// The four places a driver goes: today's orders, past deliveries, money, and their own profile. The bar keeps its place while a delivery
/// detail is open on top of it.
class DriverShell extends ConsumerStatefulWidget {
  const DriverShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  ConsumerState<DriverShell> createState() => _DriverShellState();
}

class _DriverShellState extends ConsumerState<DriverShell> {
  DateTime? _lastBack;
  int? _lastTab;

  @override
  Widget build(BuildContext context) {
    final shell = widget.shell;
    if (_lastTab != shell.currentIndex) {
      _lastBack = null;
      _lastTab = shell.currentIndex;
    }
    return PopScope<Object?>(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        final now = DateTime.now();
        if (_lastBack != null && now.difference(_lastBack!) < const Duration(seconds: 3)) {
          _lastBack = null;
          SystemNavigator.pop();
          return;
        }
        _lastBack = now;
        ScaffoldMessenger.of(context)..hideCurrentSnackBar()..showSnackBar(SnackBar(
          content: Text(context.t('Press back again to exit', 'اضغط رجوع مرة أخرى للخروج')),
          duration: const Duration(seconds: 3),
        ));
      },
      child: Scaffold(
      body: shell,
      bottomNavigationBar: NavigationBar(
        key: const Key('driver-nav'),
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) {
          _lastBack = null;
          if (i == 3) ref.invalidate(driverFinancialPositionProvider);
          shell.goBranch(i, initialLocation: i == shell.currentIndex);
        },
        destinations: [
          NavigationDestination(icon: const Icon(Icons.local_shipping_outlined), selectedIcon: const Icon(Icons.local_shipping), label: context.t('Orders', 'الطلبات')),
          NavigationDestination(icon: const Icon(Icons.history), selectedIcon: const Icon(Icons.history), label: context.t('History', 'السجل')),
          NavigationDestination(icon: const Icon(Icons.account_balance_wallet_outlined), selectedIcon: const Icon(Icons.account_balance_wallet), label: context.t('Earnings', 'الأرباح')),
          NavigationDestination(icon: const Icon(Icons.person_outline), selectedIcon: const Icon(Icons.person), label: context.t('Profile', 'حسابي')),
        ],
      ),
    ));
  }
}
