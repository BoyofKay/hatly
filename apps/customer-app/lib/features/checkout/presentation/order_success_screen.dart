import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_key_value_row.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../orders/data/orders_providers.dart';
import '../../orders/domain/order_details.dart';
import '../../orders/presentation/order_widgets.dart';
import 'payment_labels.dart';

/// Shown right after an order is placed: reference, status, total, how it is paid, the ETA and the vendors. A manual-transfer
/// order says plainly that the payment is still awaiting review — "order created" is never presented as "paid".
/// Everything comes from the created order itself (server data), read back through the same details endpoint.
class OrderSuccessScreen extends ConsumerWidget {
  const OrderSuccessScreen({super.key, required this.orderId});

  final String orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final detailsAsync = ref.watch(orderDetailsProvider(orderId));

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) context.go('/');
      },
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: Text(l10n.checkoutSuccessAppBar),
        ),
        body: detailsAsync.when(
          loading: () => const HatlyLoadingView(),
          // The order exists even if reading it back failed — never suggest it was not placed.
          error: (error, _) => HatlyStateView(
            icon: Icons.check_circle_outline,
            title: l10n.checkoutOrderPlacedButLoadFailed,
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(orderDetailsProvider(orderId)),
          ),
          data: (order) => _Content(order: order),
        ),
      ),
    );
  }
}

class _Content extends StatelessWidget {
  const _Content({required this.order});

  final OrderDetails order;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final awaiting = order.payment?.awaitingApproval ?? false;
    // Nothing sent yet: the customer still has to transfer and send the proof.
    final needsProof = awaiting && order.payment?.status == 'PENDING';
    final vendors = order.segments
        .map((s) => s.vendorBranchName)
        .whereType<String>()
        .toList();

    return ListView(
      padding: const EdgeInsets.all(HatlySpacing.md),
      children: [
        const SizedBox(height: HatlySpacing.md),
        ExcludeSemantics(
          child: Icon(
              awaiting ? Icons.hourglass_empty_rounded : Icons.check_circle,
              size: 72,
              color: awaiting ? p.warning : p.success),
        ),
        const SizedBox(height: HatlySpacing.md),
        Semantics(
          header: true,
          liveRegion: true,
          child: Text(
            awaiting
                ? l10n.checkoutSuccessAwaitingTitle
                : l10n.checkoutSuccessTitle,
            key: const Key('success-title'),
            textAlign: TextAlign.center,
            style: context.type.h1,
          ),
        ),
        const SizedBox(height: HatlySpacing.lg),
        OrderStatusEtaCard(
          status: order.status,
          eta: order.eta,
          isPickup: order.isPickup,
          awaitingPaymentApproval: awaiting,
        ),
        const SizedBox(height: HatlySpacing.md),
        HatlySurface(
          child: Column(
            children: [
              OrderInfoRow(
                  label: l10n.orderNumberLabel,
                  value: '#${order.orderNumber}',
                  ltrValue: true),
              OrderInfoRow(
                  label: l10n.orderPaymentTitle,
                  value: paymentSummaryLabel(context, order.paymentMethod,
                      electronicMethod: order.electronicPaymentMethod)),
              if (order.walletAmountMinor > 0)
                OrderInfoRow(
                    label: l10n.checkoutWalletApplied,
                    value: formatMinorUnits(order.walletAmountMinor, context),
                    ltrValue: true),
              if (order.totalMinor != null)
                OrderInfoRow(
                    label: l10n.orderTotalLabel,
                    value: formatMinorUnits(order.totalMinor!, context),
                    ltrValue: true,
                    bold: true),
              if (order.walletAmountMinor > 0 && order.amountDueMinor != null)
                OrderInfoRow(
                    label: l10n.checkoutAmountDue,
                    value: formatMinorUnits(order.amountDueMinor!, context),
                    ltrValue: true),
              if (vendors.isNotEmpty)
                OrderInfoRow(
                    label: l10n.orderVendorsLabel, value: vendors.join('، ')),
            ],
          ),
        ),
        const SizedBox(height: HatlySpacing.lg),
        if (needsProof) ...[
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              key: const Key('success-complete-payment'),
              style: hatlyAccentButtonStyle(context),
              onPressed: () => context.push(
                '/checkout/transfer/${order.id}${order.electronicPaymentMethod != null ? '?m=${order.electronicPaymentMethod}' : ''}',
                extra: (
                  // What must be TRANSFERRED is the amount due after the wallet — never the full total.
                  totalMinor: order.amountDueMinor ?? order.totalMinor,
                  orderNumber: order.orderNumber,
                  paymentMethodLabel: order.electronicPaymentMethod == null
                      ? ''
                      : electronicMethodLabel(
                          context, order.electronicPaymentMethod!),
                ),
              ),
              child: Text(l10n.checkoutSuccessSendProof),
            ),
          ),
          const SizedBox(height: HatlySpacing.sm),
        ],
        SizedBox(
          width: double.infinity,
          child: needsProof
              ? OutlinedButton(
                  key: const Key('success-track'),
                  onPressed: () => context.push('/orders/${order.id}/tracking'),
                  child: Text(l10n.orderTrackAction),
                )
              : ElevatedButton(
                  key: const Key('success-track'),
                  style: hatlyAccentButtonStyle(context),
                  onPressed: () => context.push('/orders/${order.id}/tracking'),
                  child: Text(l10n.orderTrackAction),
                ),
        ),
        const SizedBox(height: HatlySpacing.sm),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            key: const Key('success-details'),
            onPressed: () => context.push('/orders/${order.id}'),
            child: Text(l10n.orderDetailsAction),
          ),
        ),
        const SizedBox(height: HatlySpacing.sm),
        TextButton(
          key: const Key('success-home'),
          onPressed: () => context.go('/'),
          child: Text(l10n.checkoutSuccessBackHome),
        ),
      ],
    );
  }
}
