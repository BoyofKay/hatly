import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../data/wallet_providers.dart';
import '../domain/wallet_transaction.dart';

/// Customer Wallet (Profile). Balance always comes from
/// [walletBalanceProvider] (a fresh server read); history is the same
/// "flatten loaded pages, load more near the bottom, pull to refresh"
/// shape already established by the Orders list (`orders_screen.dart`)
/// — reused deliberately, not reinvented.
class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final balanceAsync = ref.watch(walletBalanceProvider);
    final transactionsAsync = ref.watch(walletTransactionsControllerProvider);
    final controller = ref.read(walletTransactionsControllerProvider.notifier);

    Future<void> refreshAll() async {
      ref.invalidate(walletBalanceProvider);
      await Future.wait([
        ref.read(walletBalanceProvider.future).catchError((_) => const WalletBalance(balanceMinor: 0)),
        controller.refresh(),
      ]);
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.walletTitle)),
      body: RefreshIndicator(
        onRefresh: refreshAll,
        child: NotificationListener<ScrollNotification>(
          onNotification: (notification) {
            final nearBottom = notification.metrics.pixels >=
                notification.metrics.maxScrollExtent - 200;
            if (nearBottom) controller.loadMore();
            return false;
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(HatlySpacing.md),
            children: [
              _BalanceCard(balanceAsync: balanceAsync),
              const SizedBox(height: HatlySpacing.lg),
              Text(l10n.walletHistoryTitle, style: context.type.title),
              const SizedBox(height: HatlySpacing.sm),
              transactionsAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: HatlySpacing.xl),
                  child: HatlyLoadingView(),
                ),
                error: (error, _) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: HatlySpacing.lg),
                  child: HatlyStateView(
                    icon: Icons.error_outline,
                    title: l10n.somethingWentWrong,
                    retryLabel: l10n.retry,
                    onRetry: controller.refresh,
                  ),
                ),
                data: (transactions) {
                  if (transactions.isEmpty) {
                    return Padding(
                      padding:
                          const EdgeInsets.symmetric(vertical: HatlySpacing.xl),
                      child: HatlyStateView(
                        icon: Icons.receipt_long_outlined,
                        title: l10n.walletEmptyHistory,
                      ),
                    );
                  }
                  return Column(
                    children: [
                      for (var i = 0; i < transactions.length; i++) ...[
                        if (i > 0) const SizedBox(height: HatlySpacing.sm),
                        _TransactionTile(transaction: transactions[i]),
                      ],
                    ],
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balanceAsync});

  final AsyncValue<WalletBalance> balanceAsync;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return HatlySurface(
      key: const Key('wallet-balance-card'),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: p.accentSoft,
            foregroundColor: p.accent,
            child: const Icon(Icons.account_balance_wallet_outlined),
          ),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.walletBalanceLabel, style: context.type.caption),
                const SizedBox(height: 2),
                balanceAsync.when(
                  loading: () => const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2)),
                  error: (error, _) => Text(l10n.somethingWentWrong,
                      key: const Key('wallet-balance-error'),
                      style: context.type.body),
                  data: (balance) => LtrText(
                    formatMinorUnits(balance.balanceMinor, context),
                    key: const Key('wallet-balance-amount'),
                    style: context.type.title
                        .copyWith(fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// One ledger row. Credits (refunds, admin credits, loyalty
/// redemption) show in green with a "+"; debits (order payments,
/// expiration) show in the normal text color with a "−" — spending is
/// not an error state, so it is never shown in the urgent/red color.
class _TransactionTile extends StatelessWidget {
  const _TransactionTile({required this.transaction});

  final CustomerWalletTransaction transaction;

  String _typeLabel(AppLocalizations l10n) {
    switch (transaction.type) {
      case 'ORDER_PAYMENT':
        return l10n.walletTypeOrderPayment;
      case 'ORDER_REFUND':
        return l10n.walletTypeOrderRefund;
      case 'ADMIN_CREDIT':
        return l10n.walletTypeAdminCredit;
      case 'LOYALTY_REDEMPTION':
        return l10n.walletTypeLoyaltyRedemption;
      case 'DRIVER_CASH_REMAINDER':
        return l10n.walletTypeDriverCashRemainder;
      case 'ADJUSTMENT':
        return l10n.walletTypeAdjustment;
      case 'EXPIRATION':
        return l10n.walletTypeExpiration;
      default:
        return transaction.type;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    final p = context.palette;
    final isCredit = transaction.isCredit;
    final amountText =
        '${isCredit ? '+' : '−'}${formatMinorUnits(transaction.amountDeltaMinor.abs(), context)}';

    return HatlySurface(
      key: Key('wallet-transaction-${transaction.id}'),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            isCredit
                ? Icons.arrow_downward_rounded
                : Icons.arrow_upward_rounded,
            color: isCredit ? p.success : p.textMuted,
            size: 20,
          ),
          const SizedBox(width: HatlySpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_typeLabel(l10n), style: context.type.body),
                if (transaction.reason?.isNotEmpty == true)
                  Text(transaction.reason!, style: context.type.caption),
                Text(
                  DateFormat.yMMMd(locale)
                      .add_jm()
                      .format(transaction.createdAt.toLocal()),
                  style: context.type.caption,
                ),
              ],
            ),
          ),
          const SizedBox(width: HatlySpacing.sm),
          LtrText(
            amountText,
            style: context.type.body.copyWith(
              fontWeight: FontWeight.w700,
              color: isCredit ? p.success : p.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}
