import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../core/utils/whatsapp_helper.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../data/checkout_providers.dart';
import '../data/manual_transfer_api.dart';
import '../../orders/data/orders_providers.dart';
import '../../../core/routing/router_stack.dart';

/// CONFIRMED (Payment Verification chunk, sections 2/6): shown once,
/// right after order creation, for CUSTOMER_TRANSFER orders. Opening
/// WhatsApp from here does NOT suspend or terminate the order — the
/// order already exists server-side (`Payment.status` starts at
/// `PENDING`, moving to `UNDER_REVIEW` once the customer taps "I've
/// sent the payment" below). The customer never needs to return here
/// or take any further action after Admin approves — Order
/// History/Details (built in a prior phase) already surfaces the
/// authoritative current payment state whenever they next open the
/// app, with zero changes needed for that.
class TransferInstructionsScreen extends ConsumerStatefulWidget {
  const TransferInstructionsScreen({
    super.key,
    required this.orderId,
    required this.totalMinor,
    required this.paymentMethodLabel,
    this.orderNumber,
  });

  final String orderId;

  /// The HT-… number the customer and Hatly staff use. When the screen is opened without it, it is read from the order.
  final String? orderNumber;
  final int? totalMinor;

  /// The customer's actually-chosen sub-option (InstaPay / Wallet) —
  /// see CheckoutScreen's own comment for why this is threaded through
  /// explicitly rather than re-derived from the destination config.
  final String paymentMethodLabel;

  @override
  ConsumerState<TransferInstructionsScreen> createState() =>
      _TransferInstructionsScreenState();
}

class _TransferInstructionsScreenState
    extends ConsumerState<TransferInstructionsScreen> {
  bool _claimed = false;
  bool _sendingProof = false;

  // Polish pass fix (corrects an earlier fix in this same pass): the guard
  // must cover the WHOLE button press — opening WhatsApp AND claiming —
  // not just the claim call. `_isClaiming` alone only became true once
  // `_claim()` ran, which is AFTER `openWhatsAppWithMessage` already
  // resolved, leaving the WhatsApp-launch step itself unguarded against a
  // fast double-tap.
  Future<void> _sendProof(ManualTransferConfig config) async {
    if (_sendingProof) return;
    setState(() => _sendingProof = true);
    try {
      var orderNumber = widget.orderNumber;
      if (orderNumber == null) {
        try {
          orderNumber = (await ref.read(orderDetailsProvider(widget.orderId).future)).orderNumber;
        } catch (_) {
          orderNumber = widget.orderId; // offline: still identifies the order for staff
        }
      }
      if (!mounted) return;
      final message = buildTransferProofMessage(
        orderNumber: orderNumber,
        paymentMethodLabel: widget.paymentMethodLabel,
        formattedAmount: widget.totalMinor != null
            ? formatMinorUnits(widget.totalMinor!, context)
            : '—',
      );
      await openWhatsAppWithMessage(
          phoneNumber: config.whatsappNumber, message: message);
      if (!_claimed) {
        await ref.read(manualTransferApiProvider).claimTransfer(widget.orderId);
        if (mounted) setState(() => _claimed = true);
      }
    } finally {
      if (mounted) setState(() => _sendingProof = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final configAsync = ref.watch(manualTransferConfigProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.transferInstructionsTitle)),
      body: configAsync.when(
        // Polish pass: raw `CircularProgressIndicator` -> the shared
        // `HatlyLoadingView`, matching every other loading state in this flow.
        loading: () => const HatlyLoadingView(),
        // CONFIRMED: fails closed if BusinessConfig isn't set up yet —
        // never a fabricated destination (see ManualTransferApi's own
        // comment). Surfaced plainly, not silently retried forever.
        // Polish pass: was missing a retry action — every other error state
        // in this flow (Checkout, Orders, Order Details/Tracking) offers one;
        // a transient failure here left the customer on a dead end.
        error: (error, stackTrace) => HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.transferNotAvailable,
          retryLabel: l10n.retry,
          onRetry: () => ref.invalidate(manualTransferConfigProvider),
        ),
        data: (config) => Padding(
          padding: const EdgeInsets.all(HatlySpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(HatlySpacing.ms),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.transferDestinationLabel,
                          style: TextStyle(color: p.textMuted)),
                      const SizedBox(height: HatlySpacing.xs),
                      Text(config.destination.label,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                      const SizedBox(height: 2),
                      LtrText(
                        config.destination.phoneOrAccountNumber,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                      if (config.destination.accountName != null) ...[
                        const SizedBox(height: 2),
                        Text(config.destination.accountName!),
                      ],
                      const Divider(height: HatlySpacing.lg),
                      Text(l10n.transferAmountLabel,
                          style: TextStyle(color: p.textMuted)),
                      const SizedBox(height: HatlySpacing.xs),
                      LtrText(
                        widget.totalMinor != null
                            ? formatMinorUnits(widget.totalMinor!, context)
                            : '—',
                        style: const TextStyle(
                            fontSize: 20, fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: HatlySpacing.lg),
              FilledButton.icon(
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(l10n.transferSendProofButton),
                // Polish pass: was unconditional — every other async action
                // in this flow (Checkout's confirm button, Order Details'
                // cancel button) disables itself while its own request is in
                // flight; a fast double-tap here could fire two concurrent
                // WhatsApp-launch + claim attempts.
                onPressed: _sendingProof ? null : () => _sendProof(config),
              ),
              const SizedBox(height: HatlySpacing.ms),
              if (_sendingProof) const HatlyLoadingView(inline: true),
              if (_claimed) ...[
                const SizedBox(height: HatlySpacing.sm),
                Text(l10n.transferAwaitingVerification,
                    style: TextStyle(color: p.textMuted)),
              ],
              const Spacer(),
              OutlinedButton(
                onPressed: () => GoRouter.of(context)
                    .replaceFlowWith('/orders/${widget.orderId}'),
                child: Text(l10n.checkoutOrderPlacedTitle),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
