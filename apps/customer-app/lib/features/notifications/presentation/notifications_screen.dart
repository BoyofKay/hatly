import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../data/notifications_providers.dart';
import '../domain/customer_notification.dart';
import 'notification_text.dart';

/// The customer's order notifications, newest first. Unread rows are marked (dot + weight, not colour alone); tapping a row
/// marks it read and opens THAT order. Real data only — an empty list says so.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final state = ref.watch(notificationsControllerProvider);
    final controller = ref.read(notificationsControllerProvider.notifier);
    final hasUnread = state.valueOrNull?.any((n) => !n.isRead) ?? false;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.notificationsTitle)),
      body: state.when(
        loading: () => const HatlyLoadingView(),
        error: (_, __) => HatlyStateView(
          key: const Key('notifications-error'),
          icon: Icons.wifi_off_rounded,
          title: l10n.notificationsLoadError,
          retryLabel: l10n.retry,
          onRetry: controller.refresh,
        ),
        data: (items) {
          if (items.isEmpty) {
            return HatlyStateView(
              key: const Key('notifications-empty'),
              icon: Icons.notifications_none_rounded,
              title: l10n.notificationsEmptyTitle,
              subtitle: l10n.notificationsEmptyBody,
            );
          }
          return Column(
            children: [
              // Under the title (not in the app bar): a long label at large text sizes must never overflow it.
              if (hasUnread)
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: Padding(
                    padding: const EdgeInsetsDirectional.only(
                        end: HatlySpacing.sm, top: HatlySpacing.xs),
                    child: TextButton(
                      key: const Key('notifications-mark-all'),
                      onPressed: controller.markAllRead,
                      child: Text(l10n.notificationsMarkAllRead),
                    ),
                  ),
                ),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: controller.refresh,
                  child: NotificationListener<ScrollNotification>(
                    onNotification: (n) {
                      if (n.metrics.extentAfter < 300) controller.loadMore();
                      return false;
                    },
                    child: ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding:
                          const EdgeInsets.symmetric(vertical: HatlySpacing.sm),
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, i) => _NotificationTile(
                        notification: items[i],
                        onTap: () {
                          controller.markRead(items[i]);
                          context.push('/orders/${items[i].orderId}');
                        },
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.notification, required this.onTap});

  final CustomerNotification notification;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final text = notificationText(l10n, notification);
    final locale = Localizations.localeOf(context).toString();
    final when = DateFormat.yMMMd(locale)
        .add_jm()
        .format(notification.createdAt.toLocal());
    final unread = !notification.isRead;

    return Semantics(
      key: Key('notification-${notification.id}'),
      button: true,
      label:
          '${unread ? '${l10n.notificationsUnread}. ' : ''}${text.title}. ${text.body}. $when',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: HatlyTouch.minTarget),
          color: unread ? p.accentSoft : null,
          padding: const EdgeInsets.symmetric(
              horizontal: HatlySpacing.md, vertical: HatlySpacing.ms),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(text.icon, color: unread ? p.accent : p.textMuted, size: 24),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(text.title,
                        style: context.type.body.copyWith(
                            fontWeight:
                                unread ? FontWeight.w700 : FontWeight.w500)),
                    const SizedBox(height: 2),
                    Text(text.body,
                        style: context.type.small.copyWith(color: p.textMuted)),
                    const SizedBox(height: 4),
                    Text(when,
                        style:
                            context.type.caption.copyWith(color: p.textMuted)),
                  ],
                ),
              ),
              if (unread)
                Padding(
                  padding: const EdgeInsetsDirectional.only(
                      start: HatlySpacing.sm, top: HatlySpacing.xs),
                  child: Container(
                    key: Key('notification-unread-${notification.id}'),
                    width: 10,
                    height: 10,
                    decoration:
                        BoxDecoration(color: p.accent, shape: BoxShape.circle),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
