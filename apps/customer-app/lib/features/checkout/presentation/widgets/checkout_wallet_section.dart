import 'package:flutter/material.dart';
import '../../../../core/localization/l10n/app_localizations.dart';
import '../../../../core/theme/hatly_theme.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../shared_widgets/hatly_key_value_row.dart';
import '../../../../shared_widgets/hatly_surface.dart';
import '../../data/checkout_controller.dart';
import '../../domain/checkout_quote.dart';

/// Pay with the Hatly wallet — fully, or partly with the rest paid by the chosen method. The balance, the amount applied and
/// the amount still due are the server's numbers; the optional "amount" field only ever LOWERS how much of the balance is
/// used (the server caps it and can never be talked into more).
class CheckoutWalletSection extends StatefulWidget {
  const CheckoutWalletSection({
    super.key,
    required this.quote,
    required this.selection,
    required this.onToggle,
    required this.onAmount,
  });

  final CheckoutQuote quote;
  final CheckoutSelection selection;
  final ValueChanged<bool> onToggle;
  final ValueChanged<int?> onAmount;

  @override
  State<CheckoutWalletSection> createState() => _CheckoutWalletSectionState();
}

class _CheckoutWalletSectionState extends State<CheckoutWalletSection> {
  final _amount = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  void _submitAmount(String text) {
    final normalized = text.trim().replaceAll(',', '.');
    if (normalized.isEmpty) return widget.onAmount(null);
    final value = double.tryParse(normalized);
    if (value == null || value <= 0) return widget.onAmount(null);
    widget.onAmount((value * 100).round());
  }

  @override
  Widget build(BuildContext context) {
    final wallet = widget.quote.payment?.wallet;
    if (wallet == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final selection = widget.selection;
    final summary = widget.quote.summary;

    // Independent of the payment method: the wallet can pay part of the order and the chosen method (COD, Pay at Delivery or
    // Manual Transfer) pays the rest.
    final transfer = selection.paymentMethod == 'MANUAL_TRANSFER';
    final canUse = wallet.available && wallet.balanceMinor > 0;
    String? note;
    if (!wallet.available) {
      note = l10n.checkoutWalletUnavailableForOrder;
    } else if (wallet.balanceMinor <= 0) {
      note = l10n.checkoutWalletEmpty;
    }

    return HatlySection(
      title: l10n.checkoutWalletTitle,
      icon: Icons.account_balance_wallet_outlined,
      child: HatlySurface(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              container: true,
              toggled: selection.useWallet,
              label:
                  '${l10n.checkoutWalletUse}. ${l10n.checkoutWalletBalance(formatMinorUnits(wallet.balanceMinor, context))}',
              child: MergeSemantics(
                child: Row(
                  children: [
                    Icon(Icons.account_balance_wallet_outlined,
                        color: p.textMuted),
                    const SizedBox(width: HatlySpacing.ms),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.checkoutWalletUse,
                              style: context.type.body
                                  .copyWith(fontWeight: FontWeight.w600)),
                          Text(
                              l10n.checkoutWalletBalance(formatMinorUnits(
                                  wallet.balanceMinor, context)),
                              style: context.type.caption),
                        ],
                      ),
                    ),
                    Switch(
                      key: const Key('checkout-wallet-switch'),
                      value: selection.useWallet && canUse,
                      onChanged: canUse ? widget.onToggle : null,
                    ),
                  ],
                ),
              ),
            ),
            if (note != null)
              Padding(
                padding: const EdgeInsets.only(top: HatlySpacing.xs),
                child: Text(note,
                    key: const Key('checkout-wallet-note'),
                    style: context.type.caption),
              ),
            if (selection.useWallet && canUse && summary != null) ...[
              const Divider(height: HatlySpacing.lg),
              // Only once the server has answered for the wallet (not while the quote is being re-asked).
              if (wallet.appliedMinor > 0) ...[
                _line(context, l10n.checkoutWalletApplied,
                    '-${formatMinorUnits(wallet.appliedMinor, context)}',
                    color: p.success),
                if (summary.amountDueMinor != null)
                  _line(
                      context,
                      transfer
                          ? l10n.checkoutAmountDueByTransfer
                          : l10n.checkoutAmountDue,
                      formatMinorUnits(summary.amountDueMinor!, context),
                      bold: true),
                const SizedBox(height: HatlySpacing.sm),
              ],
              TextField(
                key: const Key('checkout-wallet-amount'),
                controller: _amount,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                textInputAction: TextInputAction.done,
                onSubmitted: _submitAmount,
                onTapOutside: (_) => _submitAmount(_amount.text),
                decoration: InputDecoration(
                  labelText: l10n.checkoutWalletAmountLabel,
                  helperText: l10n.checkoutWalletAmountHelp,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _line(BuildContext context, String label, String value,
      {Color? color, bool bold = false}) {
    return HatlyKeyValueRow(
      label: label,
      value: value,
      padding: const EdgeInsets.symmetric(vertical: 2),
      style: context.type.body.copyWith(
          color: color, fontWeight: bold ? FontWeight.w700 : FontWeight.w400),
    );
  }
}
