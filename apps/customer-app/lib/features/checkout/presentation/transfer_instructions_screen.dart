import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../core/utils/whatsapp_helper.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../data/checkout_providers.dart';

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
  });

  final String orderId;
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
  bool _isClaiming = false;

  Future<void> _claim() async {
    setState(() => _isClaiming = true);
    try {
      await ref.read(manualTransferApiProvider).claimTransfer(widget.orderId);
      if (mounted) setState(() => _claimed = true);
    } finally {
      if (mounted) setState(() => _isClaiming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final configAsync = ref.watch(manualTransferConfigProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.transferInstructionsTitle)),
      body: configAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        // CONFIRMED: fails closed if BusinessConfig isn't set up yet —
        // never a fabricated destination (see ManualTransferApi's own
        // comment). Surfaced plainly, not silently retried forever.
        error: (error, stackTrace) => HatlyStateView(
          icon: Icons.error_outline,
          title: l10n.transferNotAvailable,
        ),
        data: (config) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l10n.transferDestinationLabel,
                          style: const TextStyle(color: HatlyColors.textMuted)),
                      const SizedBox(height: 4),
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
                      const Divider(height: 24),
                      Text(l10n.transferAmountLabel,
                          style: const TextStyle(color: HatlyColors.textMuted)),
                      const SizedBox(height: 4),
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
              const SizedBox(height: 20),
              FilledButton.icon(
                icon: const Icon(Icons.chat_bubble_outline),
                label: Text(l10n.transferSendProofButton),
                onPressed: () async {
                  final message = buildTransferProofMessage(
                    orderId: widget.orderId,
                    paymentMethodLabel: widget.paymentMethodLabel,
                    formattedAmount: widget.totalMinor != null
                        ? formatMinorUnits(widget.totalMinor!, context)
                        : '—',
                  );
                  await openWhatsAppWithMessage(
                      phoneNumber: config.whatsappNumber, message: message);
                  if (!_claimed) await _claim();
                },
              ),
              const SizedBox(height: 12),
              if (_isClaiming) const Center(child: CircularProgressIndicator()),
              if (_claimed) ...[
                const SizedBox(height: 8),
                Text(l10n.transferAwaitingVerification,
                    style: const TextStyle(color: HatlyColors.textMuted)),
              ],
              const Spacer(),
              OutlinedButton(
                onPressed: () => context.go('/orders/${widget.orderId}'),
                child: Text(l10n.checkoutOrderPlacedTitle),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
