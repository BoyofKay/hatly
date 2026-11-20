import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../domain/order_details.dart';
import 'order_eta_text.dart';
import 'order_status_label.dart';

/// Wraps [text] in Unicode left-to-right isolates so a Latin code (an order reference, a coupon) keeps its own order — and its
/// `#` — inside Arabic (right-to-left) text.
String isolateLtr(String text) => '\u2066$text\u2069';

/// `#HT-100234`, safe to embed in any sentence. The server-generated, customer-facing order number — never the internal
/// UUID (see `OrderDetails.orderNumber`/`OrderSummary.orderNumber`/`OrderTracking.orderNumber`).
String orderNumberTag(String orderNumber) => isolateLtr('#$orderNumber');

/// Headline of an order: its status and — for an ongoing order — the operational ETA (a window, or the honest reason there
/// is none). Never shows money; the ETA never affects any amount.
class OrderStatusEtaCard extends StatelessWidget {
  const OrderStatusEtaCard({
    super.key,
    required this.status,
    required this.eta,
    required this.isPickup,
    this.awaitingPaymentApproval = false,
  });

  final String status;
  final OrderEta eta;
  final bool isPickup;
  final bool awaitingPaymentApproval;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final window = orderEtaWindow(context, eta, isPickup: isPickup);
    final unavailable = orderEtaUnavailableText(context, eta);

    final stage = orderProgressStage(status, isPickup: isPickup);
    final failed = status == 'CANCELLED' || status == 'FAILED_DELIVERY';
    final tint = failed
        ? p.urgent
        : (stage == orderProgressStageCount ? p.success : p.accent);

    return HatlySurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                    color: tint.withValues(alpha: 0.12),
                    shape: BoxShape.circle),
                child: Icon(_statusIcon(status, isPickup: isPickup),
                    color: tint, size: 26),
              ),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(orderStatusLabel(context, status),
                      key: const Key('order-status-title'),
                      style: context.type.h2),
                ),
              ),
            ],
          ),
          // Where the CURRENT status sits on the way to the door — derived from the status alone (no invented events or times).
          if (stage != null) ...[
            const SizedBox(height: HatlySpacing.md),
            ExcludeSemantics(
              child: Row(
                key: const Key('order-progress'),
                children: [
                  for (var i = 1; i <= orderProgressStageCount; i++) ...[
                    if (i > 1) const SizedBox(width: HatlySpacing.xs),
                    Expanded(
                      child: Container(
                        height: 6,
                        decoration: BoxDecoration(
                          color: i <= stage ? tint : p.surfaceSoft,
                          borderRadius:
                              BorderRadius.circular(HatlyRadius.circular),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          if (window != null) ...[
            const SizedBox(height: HatlySpacing.sm),
            Row(
              children: [
                Icon(Icons.schedule, size: 20, color: p.textMuted),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                    child: Text(window,
                        key: const Key('order-eta'), style: context.type.body)),
              ],
            ),
            if (eta.delayed)
              Padding(
                padding: const EdgeInsets.only(top: HatlySpacing.xs),
                child: Text(l10n.etaDelayed,
                    key: const Key('order-eta-delayed'),
                    style: context.type.small.copyWith(color: p.warning)),
              ),
          ] else if (unavailable != null) ...[
            const SizedBox(height: HatlySpacing.sm),
            Row(
              children: [
                Icon(Icons.schedule, size: 20, color: p.textMuted),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                    child: Text(unavailable,
                        key: const Key('order-eta-unavailable'),
                        style: context.type.small)),
              ],
            ),
          ],
          if (awaitingPaymentApproval) ...[
            const SizedBox(height: HatlySpacing.sm),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.hourglass_empty_rounded, size: 20, color: p.warning),
                const SizedBox(width: HatlySpacing.sm),
                Expanded(
                    child: Text(l10n.orderPaymentAwaitingReview,
                        key: const Key('order-payment-awaiting'),
                        style:
                            context.type.small.copyWith(color: p.textPrimary))),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Number of segments in the status card's progress bar.
const int orderProgressStageCount = 4;

/// 1 placed · 2 preparing · 3 on its way (or ready at the branch, for pickup) · 4 done. Null for a cancelled/failed or
/// unknown status (no bar is drawn).
int? orderProgressStage(String status, {required bool isPickup}) {
  switch (status) {
    case 'PENDING':
    case 'CONFIRMED':
      return 1;
    case 'PREPARING':
      return 2;
    case 'READY_FOR_PICKUP':
      return isPickup ? 3 : 2;
    case 'ASSIGNED_TO_DRIVER':
    case 'PICKED_UP':
    case 'ON_THE_WAY':
      return 3;
    case 'DELIVERED':
    case 'COLLECTED':
      return 4;
    default:
      return null;
  }
}

IconData _statusIcon(String status, {required bool isPickup}) {
  switch (status) {
    case 'CANCELLED':
    case 'FAILED_DELIVERY':
      return Icons.cancel_outlined;
    case 'DELIVERED':
    case 'COLLECTED':
      return Icons.check_circle_outline_rounded;
    case 'PREPARING':
      return Icons.soup_kitchen_outlined;
    case 'READY_FOR_PICKUP':
      return isPickup ? Icons.storefront_outlined : Icons.inventory_2_outlined;
    case 'ASSIGNED_TO_DRIVER':
    case 'PICKED_UP':
    case 'ON_THE_WAY':
      return Icons.delivery_dining_outlined;
    default:
      return Icons.receipt_long_outlined;
  }
}

/// The order's status history as a vertical timeline, oldest first, the latest step highlighted. Only steps that really
/// happened are shown (from the server's status history) — no invented upcoming steps.
class OrderTimelineView extends StatelessWidget {
  const OrderTimelineView({super.key, required this.entries});

  final List<OrderTimelineEntry> entries;

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) return const SizedBox.shrink();
    final p = context.palette;
    final locale = Localizations.localeOf(context).languageCode;
    final format = DateFormat.MMMd(locale).add_jm();

    return Column(
      key: const Key('order-timeline'),
      children: [
        for (var i = 0; i < entries.length; i++)
          _TimelineRow(
            label: orderStatusLabel(context, entries[i].status),
            time: format.format(entries[i].at.toLocal()),
            isLatest: i == entries.length - 1,
            isFirst: i == 0,
            isLast: i == entries.length - 1,
            failure: entries[i].status == 'CANCELLED' ||
                entries[i].status == 'FAILED_DELIVERY',
            palette: p,
          ),
      ],
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.label,
    required this.time,
    required this.isLatest,
    required this.isFirst,
    required this.isLast,
    required this.failure,
    required this.palette,
  });

  final String label;
  final String time;
  final bool isLatest;
  final bool isFirst;
  final bool isLast;
  final bool failure;
  final HatlyPalette palette;

  @override
  Widget build(BuildContext context) {
    // Reference board ("تتبع الطلب"): a done step is a green check circle joined to the next by a green line; the current
    // step is an orange circle on a soft orange row; a cancelled / failed step is a red cross.
    final color = failure
        ? palette.urgent
        : isLatest
            ? palette.accent
            : palette.success;
    final node = Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: isLatest && !failure ? palette.accentSoft : color,
        shape: BoxShape.circle,
        border: isLatest && !failure
            ? Border.all(color: palette.accent, width: 2)
            : null,
      ),
      child: Icon(
        failure
            ? Icons.close_rounded
            : isLatest
                ? Icons.delivery_dining_rounded
                : Icons.check_rounded,
        size: 16,
        color: isLatest && !failure ? palette.accent : palette.surface,
      ),
    );
    return Semantics(
      container: true,
      label: '$label, $time',
      excludeSemantics: true,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 28,
              child: Column(
                children: [
                  Expanded(
                    flex: 1,
                    child: Container(
                        width: 2,
                        color: isFirst ? Colors.transparent : palette.success),
                  ),
                  node,
                  Expanded(
                    flex: 1,
                    child: Container(
                        width: 2,
                        color: isLast ? Colors.transparent : palette.success),
                  ),
                ],
              ),
            ),
            const SizedBox(width: HatlySpacing.ms),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: HatlySpacing.xs),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: HatlySpacing.ms, vertical: HatlySpacing.sm),
                  decoration: BoxDecoration(
                    color: isLatest
                        ? color.withValues(alpha: 0.10)
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(HatlyRadius.button),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label,
                          style: context.type.body.copyWith(
                              color: isLatest ? color : palette.textPrimary,
                              fontWeight: isLatest
                                  ? FontWeight.w800
                                  : FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text(time, style: context.type.caption),
                    ],
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

/// A `label ..... value` line with the value forced left-to-right (amounts, ids).
class OrderInfoRow extends StatelessWidget {
  const OrderInfoRow({
    super.key,
    required this.label,
    required this.value,
    this.ltrValue = false,
    this.bold = false,
    this.color,
  });

  final String label;
  final String value;
  final bool ltrValue;
  final bool bold;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return HatlyKeyValueRow(
      label: label,
      value: value,
      ltr: ltrValue,
      style: (bold ? context.type.title : context.type.body)
          .copyWith(color: color),
    );
  }
}
