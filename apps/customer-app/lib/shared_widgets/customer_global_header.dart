import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';
import '../features/notifications/presentation/widgets/notification_bell.dart';
import '../features/shell/presentation/shell_tab_provider.dart';
import '../features/auth/presentation/auth_gate.dart';
import '../features/cart/data/cart_providers.dart';


/// Pinned across the entire customer Navigator (not a scrolling Home sliver).
/// All actions reuse the existing notification and Favorites destinations.
class CustomerGlobalHeader extends ConsumerWidget {
  const CustomerGlobalHeader({super.key, required this.router});
  final GoRouter router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final l10n = AppLocalizations.of(context);
    final count = ref.watch(isSignedInProvider) ? (ref.watch(cartControllerProvider).valueOrNull?.itemCount ?? 0) : 0;

    return Container(
      key: const Key('customer-pinned-header'),
      padding: const EdgeInsetsDirectional.fromSTEB(14, 3, 10, 3),
      decoration: BoxDecoration(color: Theme.of(context).scaffoldBackgroundColor),
      child: Row(children: [
        InkWell(
          onTap: () { ref.read(shellTabIndexProvider.notifier).state = ShellTab.home; router.go('/'); },
          child: Image.asset('assets/images/hatly-app-icon.png', width: 52, height: 52, fit: BoxFit.contain),
        ),
        const Spacer(),
        NotificationBell(router: router),
        Stack(clipBehavior: Clip.none, children: [
          IconButton(key: const Key('customer-header-cart'), tooltip: l10n.cart, onPressed: () => router.push('/cart'), icon: const Icon(Icons.shopping_bag_outlined)),
          if (count > 0) PositionedDirectional(top: 0, end: 0,
            child: CircleAvatar(radius: 9, backgroundColor: p.accent,
              child: Text(count > 99 ? '99+' : '$count', style: const TextStyle(fontSize: 9, color: Colors.white, fontWeight: FontWeight.bold)))),
        ]),
        IconButton(
          key: const Key('customer-header-favorites'),
          tooltip: l10n.homeFavoritesShortcut,
          onPressed: () {
            ref.read(shellTabIndexProvider.notifier).state = ShellTab.favorites;
            router.go('/');
          },
          icon: const Icon(Icons.favorite_border_rounded),
        ),
      ]),
    );
  }
}
