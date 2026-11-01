import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../auth/presentation/auth_gate.dart';
import '../../data/notifications_providers.dart';

/// The bell: opens the notifications list and shows the server's unread count — a badge ONLY when that count is above zero
/// (never a placeholder). A guest has no notifications, so no bell is drawn for them.
class NotificationBell extends ConsumerStatefulWidget {
  const NotificationBell({super.key});

  @override
  ConsumerState<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends ConsumerState<NotificationBell>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Back from the background: events may have happened meanwhile.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.invalidate(unreadNotificationsCountProvider);
    }
  }

  Future<void> _open() async {
    await context.push('/notifications');
    if (mounted) ref.invalidate(unreadNotificationsCountProvider);
  }

  @override
  Widget build(BuildContext context) {
    if (!ref.watch(isSignedInProvider)) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final count = ref.watch(unreadNotificationsCountProvider).valueOrNull ?? 0;
    final label = count > 0
        ? l10n.notificationsBellLabelUnread(count)
        : l10n.notificationsBellLabel;

    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      onTap: _open,
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.center,
        children: [
          IconButton(
            key: const Key('notification-bell'),
            tooltip: l10n.notificationsBellLabel,
            onPressed: _open,
            constraints: const BoxConstraints(
                minWidth: HatlyTouch.minTarget,
                minHeight: HatlyTouch.minTarget),
            icon: Icon(Icons.notifications_none_rounded,
                color: p.textPrimary, size: 24),
          ),
          if (count > 0)
            PositionedDirectional(
              top: 6,
              end: 4,
              child: IgnorePointer(
                child: Container(
                  key: const Key('notification-badge'),
                  constraints:
                      const BoxConstraints(minWidth: 18, minHeight: 18),
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                      color: p.accent,
                      borderRadius:
                          BorderRadius.circular(HatlyRadius.circular)),
                  child: Text(count > 99 ? '99+' : '$count',
                      style: context.type.caption.copyWith(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          height: 1.1)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
