import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../features/notifications/presentation/widgets/notification_bell.dart';
import '../features/shell/presentation/shell_tab_provider.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';

/// Fixed brand, notifications and Favorites shortcuts. Lives above GoRouter's
/// pages so it stays pinned on Home, Explore, cart, checkout and details.
class HatlyGlobalHeader extends ConsumerWidget {
  const HatlyGlobalHeader({super.key, required this.router});
  final GoRouter router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.palette;
    final l10n = AppLocalizations.of(context);
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      elevation: 1,
      child: Container(
        key: const Key('customer-global-header'),
        height: 60,
        padding: const EdgeInsetsDirectional.only(start: 16, end: 6),
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
              child: Image.asset('assets/images/hatly-logo.jpg', width: 96, height: 44, fit: BoxFit.contain),
            ),
          ),
          const Spacer(),
          NotificationBell(onOpen: () async { await router.push('/notifications'); }),
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
