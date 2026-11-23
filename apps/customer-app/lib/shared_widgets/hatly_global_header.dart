import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/notifications/presentation/widgets/notification_bell.dart';
import '../features/shell/presentation/shell_tab_provider.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';
import '../features/cart/data/cart_providers.dart';
import '../features/auth/presentation/auth_gate.dart';

/// Fixed brand, notifications and Favorites shortcuts. Lives above GoRouter's
/// pages so it stays pinned on Home, Explore, cart, checkout and details.
class HatlyGlobalHeader extends ConsumerWidget {
  const HatlyGlobalHeader({super.key, required this.router});
  final GoRouter router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.palette;
    final l10n = AppLocalizations.of(context);
    final cartCount = ref.watch(isSignedInProvider) ? (ref.watch(cartControllerProvider).valueOrNull?.itemCount ?? 0) : 0;
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      elevation: 0,
      child: Container(
        key: const Key('customer-global-header'),
        height: 64,
        padding: const EdgeInsetsDirectional.only(start: 14, end: 10),
        child: Row(children: [
          Semantics(
            button: true,
            label: 'Hatly',
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () {
                ref.read(shellTabIndexProvider.notifier).state = ShellTab.home;
                router.go('/');
              },
              child: Image.asset('assets/images/hatly-app-icon.png', width: 55, height: 55, fit: BoxFit.contain),
            ),
          ),
          const Spacer(),
          NotificationBell(onOpen: () async { await router.push('/notifications'); }),
          Stack(clipBehavior: Clip.none, children: [
            IconButton(
              key: const Key('customer-global-cart'),
              tooltip: l10n.cart,
              onPressed: () { if (router.routeInformationProvider.value.uri.path != '/cart') router.push('/cart'); },
              icon: Icon(Icons.shopping_bag_outlined, color: palette.textPrimary),
            ),
            if (cartCount > 0)
              PositionedDirectional(end: 0, top: 0, child: CircleAvatar(radius: 9, backgroundColor: palette.accent,
                child: Text(cartCount > 99 ? '99+' : '$cartCount', style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.white)))),
          ]),
          IconButton(
            key: const Key('customer-global-favorites'),
            tooltip: l10n.homeFavoritesShortcut,
            onPressed: () {
              ref.read(shellTabIndexProvider.notifier).state = ShellTab.favorites;
              router.go('/');
            },
            icon: Icon(Icons.favorite_border_rounded, color: palette.textPrimary),
          ),
        ]),
      ),
    );
  }
}
