import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/localization/l10n/app_localizations.dart';
import '../core/theme/hatly_theme.dart';
import '../features/auth/presentation/auth_gate.dart';
import '../features/notifications/data/notifications_providers.dart';
import '../features/shell/presentation/shell_tab_provider.dart';
import 'hatly_logo.dart';

/// Pinned across the entire customer Navigator (not a scrolling Home sliver).
/// All actions reuse the existing notification and Favorites destinations.
class CustomerGlobalHeader extends ConsumerWidget {
  const CustomerGlobalHeader({super.key, required this.router});
  final GoRouter router;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = context.palette;
    final l10n = AppLocalizations.of(context);
    final signedIn = ref.watch(isSignedInProvider);
    final unread = signedIn
        ? (ref.watch(unreadNotificationsCountProvider).valueOrNull ?? 0)
        : 0;
    return Container(
      key: const Key('customer-pinned-header'),
      padding: const EdgeInsetsDirectional.fromSTEB(12, 7, 12, 7),
      decoration: BoxDecoration(
        color: p.surface,
        border: Border(bottom: BorderSide(color: p.border)),
      ),
      child: Row(children: [
        const HatlyLogo(size: 38),
        const SizedBox(width: 8),
        Expanded(
          child: Text('Hatly', style: context.type.title.copyWith(fontWeight: FontWeight.w800),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
        if (signedIn)
          Stack(clipBehavior: Clip.none, children: [
            IconButton(
              key: const Key('notification-bell'),
              tooltip: l10n.notificationsBellLabel,
              onPressed: () async {
                await router.push<void>('/notifications');
                ref.invalidate(unreadNotificationsCountProvider);
              },
              icon: const Icon(Icons.notifications_none_rounded),
            ),
            if (unread > 0)
              PositionedDirectional(top: 1, end: 1, child: IgnorePointer(
                child: Badge(
                  label: Text(unread > 99 ? '99+' : '$unread'),
                  child: const SizedBox(width: 14, height: 14),
                ),
              )),
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
