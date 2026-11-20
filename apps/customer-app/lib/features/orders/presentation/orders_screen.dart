import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/media/media_url.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../../checkout/presentation/payment_labels.dart';
import '../data/orders_providers.dart';
import '../domain/order_summary.dart';
import 'order_eta_text.dart';
import 'order_status_label.dart';
import 'order_widgets.dart';

/// The customer's orders in three tabs — ongoing · completed · cancelled — newest first. Which statuses belong to which tab
/// is the server's decision (`GET /orders?tab=`). Each tab pages (page + limit) and refreshes on pull; the lists are
/// invalidated whenever an order is placed or cancelled so a new order shows up without a manual refresh.
class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return DefaultTabController(
      length: OrderListTab.values.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.orders),
          bottom: TabBar(
            key: const Key('orders-tabs'),
            tabs: [
              Tab(text: l10n.ordersTabActive),
              Tab(text: l10n.ordersTabCompleted),
              Tab(text: l10n.ordersTabCancelled),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _OrdersTab(tab: OrderListTab.active),
            _OrdersTab(tab: OrderListTab.completed),
            _OrdersTab(tab: OrderListTab.cancelled),
          ],
        ),
      ),
    );
  }
}

class _OrdersTab extends ConsumerWidget {
  const _OrdersTab({required this.tab});

  final OrderListTab tab;

  String _emptyText(AppLocalizations l10n) {
    switch (tab) {
      case OrderListTab.active:
        return l10n.ordersEmptyActive;
      case OrderListTab.completed:
        return l10n.ordersEmptyCompleted;
      case OrderListTab.cancelled:
        return l10n.ordersEmptyCancelled;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final provider = orderHistoryControllerProvider(tab);
    final ordersAsync = ref.watch(provider);
    final controller = ref.read(provider.notifier);

    return ordersAsync.when(
      loading: () => const HatlyLoadingView(),
      error: (error, _) => HatlyStateView(
        icon: Icons.error_outline,
        title: l10n.somethingWentWrong,
        retryLabel: l10n.retry,
        onRetry: controller.refresh,
      ),
      data: (orders) {
        if (orders.isEmpty) {
          return RefreshIndicator(
            onRefresh: controller.refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(
                  height: MediaQuery.of(context).size.height * 0.5,
                  child: HatlyStateView(
                      icon: Icons.receipt_long_outlined,
                      title: _emptyText(l10n)),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: controller.refresh,
          child: NotificationListener<ScrollNotification>(
            onNotification: (notification) {
              final nearBottom = notification.metrics.pixels >=
                  notification.metrics.maxScrollExtent - 200;
              if (nearBottom) controller.loadMore();
              return false;
            },
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(HatlySpacing.md),
              itemCount: orders.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: HatlySpacing.ms),
              itemBuilder: (context, index) => OrderSummaryCard(
                order: orders[index],
                showEta: tab == OrderListTab.active,
              ),
            ),
          ),
        );
      },
    );
  }
}

/// One order in the list: its product thumbnails (from the order's own snapshots), vendors, status, date, payment and total —
/// and, for an ongoing order, its ETA. A manual transfer not yet approved is flagged: "order created" is not "paid".
class OrderSummaryCard extends StatelessWidget {
  const OrderSummaryCard(
      {super.key, required this.order, this.showEta = false});

  final OrderSummary order;
  final bool showEta;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final locale = Localizations.localeOf(context).languageCode;

    final vendorSummary = order.vendorBranchNames.isEmpty
        ? l10n.orderItemsTitle
        : order.vendorBranchNames.length == 1
            ? order.vendorBranchNames.first
            : l10n.orderVendorSummaryWithOthers(
                order.vendorBranchNames.first,
                order.vendorBranchNames.length - 1,
              );
    final eta = showEta
        ? (orderEtaWindow(context, order.eta,
                isPickup: order.fulfillmentType == 'PICKUP') ??
            orderEtaUnavailableText(context, order.eta))
        : null;

    return HatlySurface(
      key: Key('order-card-${order.id}'),
      onTap: () => context.push('/orders/${order.id}'),
      semanticLabel:
          '$vendorSummary, ${orderStatusLabel(context, order.status)}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _Thumbnails(urls: order.itemImageUrls),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(vendorSummary,
                        style: context.type.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                    const SizedBox(height: 2),
                    Text(
                      '${orderNumberTag(order.orderNumber)} · ${DateFormat.yMMMd(locale).format(order.createdAt.toLocal())}',
                      style: context.type.caption,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: HatlySpacing.sm),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: OrderStatusBadge(status: order.status),
          ),
          const SizedBox(height: HatlySpacing.sm),
          if (eta != null)
            Padding(
              padding: const EdgeInsets.only(bottom: HatlySpacing.xs),
              child: Row(
                children: [
                  Icon(Icons.schedule, size: 16, color: p.textMuted),
                  const SizedBox(width: HatlySpacing.xs),
                  Expanded(child: Text(eta, style: context.type.small)),
                ],
              ),
            ),
          if (order.awaitingPaymentApproval)
            Padding(
              padding: const EdgeInsets.only(bottom: HatlySpacing.xs),
              child: Row(
                children: [
                  Icon(Icons.hourglass_empty_rounded,
                      size: 16, color: p.warning),
                  const SizedBox(width: HatlySpacing.xs),
                  Expanded(
                    child: Text(l10n.orderPaymentAwaitingReviewShort,
                        style: context.type.small.copyWith(color: p.warning)),
                  ),
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: Text(
                  paymentSummaryLabel(context, order.paymentMethod,
                      electronicMethod: order.electronicPaymentMethod),
                  style: context.type.small,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (order.totalMinor != null)
                LtrText(formatMinorUnits(order.totalMinor!, context),
                    style: context.type.title
                        .copyWith(color: p.link, fontWeight: FontWeight.w800)),
            ],
          ),
        ],
      ),
    );
  }
}

class _Thumbnails extends StatelessWidget {
  const _Thumbnails({required List<String> urls}) : _rawUrls = urls;

  final List<String> _rawUrls;

  List<String> get urls =>
      _rawUrls.map(resolveMediaUrl).whereType<String>().toList();

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    const size = 48.0;
    Widget placeholder() => Container(
          width: size,
          height: size,
          color: p.accentSoft,
          child: Icon(Icons.shopping_bag_outlined, color: p.accent),
        );
    if (urls.isEmpty) {
      return ClipRRect(
          borderRadius: BorderRadius.circular(HatlyRadius.chip),
          child: placeholder());
    }
    return ExcludeSemantics(
      child: SizedBox(
        width: size + (urls.length - 1) * 14,
        height: size,
        child: Stack(
          children: [
            for (var i = urls.length - 1; i >= 0; i--)
              PositionedDirectional(
                start: i * 14.0,
                child: Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(HatlyRadius.chip),
                    border: Border.all(color: p.surface, width: 2),
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(HatlyRadius.chip),
                    child: CachedNetworkImage(
                      imageUrl: urls[i],
                      width: size - 4,
                      height: size - 4,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => placeholder(),
                      errorWidget: (_, __, ___) => placeholder(),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
