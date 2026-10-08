import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../checkout/presentation/payment_labels.dart';
import '../../support/presentation/support_contact_action.dart';
import '../data/orders_providers.dart';
import '../domain/order_tracking.dart';
import 'order_status_label.dart';
import 'order_widgets.dart';

/// Tracking V1: where the order stands now — status, ETA, a vertical timeline, each vendor's progress and preparation ETA,
/// and a way to reach support. Deliberately NO live map, driver card or location: none of that exists yet, and nothing is
/// faked in its place.
class OrderTrackingScreen extends ConsumerWidget {
  const OrderTrackingScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final trackingAsync = ref.watch(orderTrackingProvider(orderId));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.orderTracking)),
      body: trackingAsync.when(
        loading: () => const HatlyLoadingView(),
        error: (error, _) => HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.somethingWentWrong,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(orderTrackingProvider(orderId)),
        ),
        data: (tracking) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(orderTrackingProvider(orderId));
            await ref.read(orderTrackingProvider(orderId).future);
          },
          child: _Content(tracking: tracking),
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.tracking});

  final OrderTracking tracking;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final locale = Localizations.localeOf(context).languageCode;
    final timeFormat = DateFormat.jm(locale);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(HatlySpacing.md),
      children: [
        OrderStatusEtaCard(
          status: tracking.status,
          eta: tracking.eta,
          isPickup: tracking.isPickup,
          awaitingPaymentApproval: tracking.awaitingPaymentApproval,
        ),
        const SizedBox(height: HatlySpacing.sm),
        Text(orderNumberTag(tracking.orderNumber),
            key: const Key('tracking-order-number'),
            style: context.type.caption),
        if (tracking.status == 'CANCELLED' &&
            tracking.cancellationReason != null) ...[
          const SizedBox(height: HatlySpacing.md),
          HatlySurface(
            child: Row(
              children: [
                Icon(Icons.info_outline, color: p.urgent),
                const SizedBox(width: HatlySpacing.ms),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.orderCancellationReasonLabel,
                          style: context.type.small),
                      Text(tracking.cancellationReason!,
                          style: context.type.body),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: HatlySpacing.lg),
        HatlySection(
          title: l10n.orderTimelineTitle,
          child: HatlySurface(
              child: OrderTimelineView(entries: tracking.timeline)),
        ),
        if (tracking.segments.isNotEmpty) ...[
          const SizedBox(height: HatlySpacing.lg),
          HatlySection(
            title: l10n.orderVendorsLabel,
            child: Column(
              children: [
                for (final segment in tracking.segments)
                  Padding(
                    padding: const EdgeInsets.only(bottom: HatlySpacing.sm),
                    child: HatlySurface(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          HatlyTrailingRow(
                            leading: Text(segment.vendorName ?? '',
                                style: context.type.title),
                            trailing: OrderStatusBadge(status: segment.status),
                          ),
                          if (_showPrep(tracking, segment)) ...[
                            const SizedBox(height: HatlySpacing.xs),
                            Text(
                              segment.expectedReadyAt != null
                                  ? l10n.orderVendorReadyAt(timeFormat.format(
                                      segment.expectedReadyAt!.toLocal()))
                                  : l10n.orderVendorPreparationMinutes(
                                      segment.preparationEstimateMinutes!),
                              style: context.type.small,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
        const SizedBox(height: HatlySpacing.md),
        HatlySurface(
          child: Row(
            children: [
              Icon(Icons.payments_outlined, color: p.textMuted),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Text(
                    paymentSummaryLabel(context, tracking.paymentMethod,
                        electronicMethod: tracking.electronicPaymentMethod),
                    style: context.type.body),
              ),
            ],
          ),
        ),
        const SizedBox(height: HatlySpacing.md),
        SupportContactTile(
          key: const Key('tracking-support-contact'),
          label: l10n.supportContactOrderAction,
          hideWhenUnavailable: true,
          messageBuilder: (l10n) => l10n.supportMessageOrder(tracking.orderId),
        ),
      ],
    );
  }

  /// Preparation ETA is only meaningful while the vendor has not finished (a delivered / cancelled / ready segment has none).
  bool _showPrep(OrderTracking tracking, TrackingSegment segment) {
    const open = {'PENDING', 'CONFIRMED', 'PREPARING'};
    if (!open.contains(segment.status)) return false;
    return segment.expectedReadyAt != null ||
        segment.preparationEstimateMinutes != null;
  }
}
