import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import 'payment_labels.dart';
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
    this.paymentMethodCode,
  });

  /// INSTAPAY / VODAFONE_CASH / … — the app the customer chose, shown first.
  final String? paymentMethodCode;

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
  Future<void> _sendProof(ManualTransferConfig config, {bool claim = true}) async {
    if (_sendingProof) return;
    setState(() => _sendingProof = true);
    try {
      var orderNumber = widget.orderNumber;
      if (orderNumber == null) {
        try {
          orderNumber =
              (await ref.read(orderDetailsProvider(widget.orderId).future))
                  .orderNumber;
        } catch (_) {
          orderNumber =
              widget.orderId; // offline: still identifies the order for staff
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
      if (claim && !_claimed) {
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
        data: (config) => ListView(
          padding: const EdgeInsets.all(HatlySpacing.md),
          children: [
            // Owner UAT 2026-11-27 (MT-01): clear steps — tell Hatly on WhatsApp (so Hatly is at the top of the share list),
            // transfer in your app, then share the receipt from that app to Hatly.
            _Step(
              number: 1,
              title: l10n.transferStep1Title,
              body: l10n.transferStep1Body,
              child: OutlinedButton.icon(
                key: const Key('transfer-step1-whatsapp'),
                icon: const Icon(Icons.chat_outlined),
                label: Text(l10n.transferStep1Button),
                onPressed: _sendingProof ? null : () => _sendProof(config, claim: false),
              ),
            ),
            _Step(
              number: 2,
              title: l10n.transferStep2Title(widget.totalMinor != null ? formatMinorUnits(widget.totalMinor!, context) : '—'),
              body: l10n.transferStep2Body,
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(HatlySpacing.ms),
                    child: Row(children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(config.destination.label, style: const TextStyle(fontWeight: FontWeight.w700)),
                          LtrText(config.destination.phoneOrAccountNumber, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                          if (config.destination.accountName != null) Text(config.destination.accountName!, style: TextStyle(color: p.textMuted)),
                        ]),
                      ),
                      IconButton(
                        key: const Key('transfer-copy-number'),
                        tooltip: l10n.transferCopyNumber,
                        icon: const Icon(Icons.copy),
                        onPressed: () async {
                          await Clipboard.setData(ClipboardData(text: config.destination.phoneOrAccountNumber));
                          if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l10n.transferNumberCopied)));
                        },
                      ),
                    ]),
                  ),
                ),
                const SizedBox(height: HatlySpacing.sm),
                Wrap(spacing: HatlySpacing.sm, runSpacing: HatlySpacing.sm, children: [
                  for (final app in _orderedApps(widget.paymentMethodCode))
                    _AppTile(app: app, selected: app.code == widget.paymentMethodCode, label: electronicMethodLabel(context, app.code)),
                ]),
              ]),
            ),
            _Step(
              number: 3,
              title: l10n.transferStep3Title,
              body: l10n.transferStep3Body,
              child: FilledButton.icon(
                key: const Key('transfer-step3-sent'),
                icon: const Icon(Icons.check_circle_outline),
                label: Text(l10n.transferSendProofButton),
                onPressed: _sendingProof ? null : () => _sendProof(config),
              ),
            ),
            if (_sendingProof) const HatlyLoadingView(inline: true),
            if (_claimed) ...[
              const SizedBox(height: HatlySpacing.sm),
              Text(l10n.transferAwaitingVerification, key: const Key('transfer-awaiting'), style: TextStyle(color: p.textMuted)),
            ],
            const SizedBox(height: HatlySpacing.lg),
            OutlinedButton(
              onPressed: () => GoRouter.of(context).replaceFlowWith('/orders/${widget.orderId}'),
              child: Text(l10n.checkoutOrderPlacedTitle),
            ),
          ],
        ),
      ),
    );
  }
}


/// The transfer apps (PD-006). Tapping one opens its store page, where the app opens if installed (exact app links can be set later).
class _TransferApp {
  const _TransferApp(this.code, this.storeQuery, this.color, {this.androidId});
  final String code;
  final String storeQuery;
  final Color color;
  final String? androidId;

  Uri get storeUri {
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      return Uri.parse('https://apps.apple.com/eg/search?term=${Uri.encodeComponent(storeQuery)}');
    }
    return androidId != null
        ? Uri.parse('https://play.google.com/store/apps/details?id=$androidId')
        : Uri.parse('https://play.google.com/store/search?q=${Uri.encodeComponent(storeQuery)}&c=apps');
  }
}

const _transferApps = [
  _TransferApp('INSTAPAY', 'InstaPay Egypt', Color(0xFF4B2C82), androidId: 'com.egyptianbanks.instapay'),
  _TransferApp('VODAFONE_CASH', 'Ana Vodafone', Color(0xFFE60000), androidId: 'com.emeint.android.myservices'),
  _TransferApp('ORANGE_CASH', 'Orange Cash', Color(0xFFFF7900), androidId: 'com.orange.mobinilandme'),
  _TransferApp('WE_PAY', 'WE Pay', Color(0xFF5C2D91), androidId: 'com.TE.WEWallet'),
  _TransferApp('ETISALAT_CASH', 'e& money', Color(0xFF00A651), androidId: 'com.etisalat.flous'),
];

List<_TransferApp> _orderedApps(String? chosen) => [
      ..._transferApps.where((a) => a.code == chosen),
      ..._transferApps.where((a) => a.code != chosen),
    ];

class _AppTile extends StatelessWidget {
  const _AppTile({required this.app, required this.selected, required this.label});
  final _TransferApp app;
  final bool selected;
  final String label;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return InkWell(
      key: Key('transfer-app-${app.code}'),
      borderRadius: BorderRadius.circular(HatlyRadius.card),
      onTap: () => launchUrl(app.storeUri, mode: LaunchMode.externalApplication),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: HatlySpacing.ms, vertical: HatlySpacing.sm),
        decoration: BoxDecoration(
          border: Border.all(color: selected ? app.color : p.border, width: selected ? 2 : 1),
          borderRadius: BorderRadius.circular(HatlyRadius.card),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          CircleAvatar(radius: 12, backgroundColor: app.color, child: Icon(electronicMethodIcon(app.code), size: 14, color: Colors.white)),
          const SizedBox(width: HatlySpacing.sm),
          Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(width: 4),
          Icon(Icons.open_in_new, size: 14, color: p.textMuted),
        ]),
      ),
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.number, required this.title, required this.body, required this.child});
  final int number;
  final String title;
  final String body;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final p = context.palette;
    return Padding(
      padding: const EdgeInsets.only(bottom: HatlySpacing.lg),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        CircleAvatar(radius: 14, backgroundColor: p.accent, child: Text('$number', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))),
        const SizedBox(width: HatlySpacing.ms),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: context.type.body.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(body, style: context.type.small.copyWith(color: p.textMuted)),
            const SizedBox(height: HatlySpacing.sm),
            child,
          ]),
        ),
      ]),
    );
  }
}
