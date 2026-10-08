import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_loading_view.dart';
import '../../../shared_widgets/hatly_primary_button.dart';
import '../../../shared_widgets/hatly_state_view.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../../../shared_widgets/ltr_text.dart';
import '../data/loyalty_providers.dart';
import '../domain/loyalty_transaction.dart';

/// Customer Loyalty (Profile) — consolidated customer-commerce
/// milestone, Parts C/D. Balance always comes from
/// [loyaltyBalanceProvider] (a fresh server read); history is the same
/// "flatten loaded pages, load more near the bottom, pull to refresh"
/// shape already established by Wallet (`wallet_screen.dart`) — reused
/// deliberately, not reinvented. Adds one thing Wallet doesn't need:
/// the "Convert to Wallet" action.
class LoyaltyScreen extends ConsumerWidget {
  const LoyaltyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final balanceAsync = ref.watch(loyaltyBalanceProvider);
    final transactionsAsync = ref.watch(loyaltyTransactionsControllerProvider);
    final controller = ref.read(loyaltyTransactionsControllerProvider.notifier);

    Future<void> refreshAll() async {
      ref.invalidate(loyaltyBalanceProvider);
      await Future.wait([
        ref
            .read(loyaltyBalanceProvider.future)
            .catchError((_) => const LoyaltyBalance(pointsBalance: 0)),
        controller.refresh(),
      ]);
    }

    return Scaffold(
      appBar: AppBar(title: Text(l10n.loyaltyTitle)),
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
              Text(l10n.loyaltyHistoryTitle, style: context.type.title),
              const SizedBox(height: HatlySpacing.sm),
              transactionsAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: HatlySpacing.xl),
                  child: HatlyLoadingView(),
                ),
                error: (error, _) => Padding(
                  padding:
                      const EdgeInsets.symmetric(vertical: HatlySpacing.lg),
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
                        icon: Icons.stars_outlined,
                        title: l10n.loyaltyEmptyHistory,
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

class _BalanceCard extends ConsumerWidget {
  const _BalanceCard({required this.balanceAsync});

  final AsyncValue<LoyaltyBalance> balanceAsync;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    return HatlySurface(
      key: const Key('loyalty-balance-card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: p.accentSoft,
                foregroundColor: p.accent,
                child: const Icon(Icons.stars_rounded),
              ),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l10n.loyaltyBalanceLabel, style: context.type.caption),
                    const SizedBox(height: 2),
                    balanceAsync.when(
                      loading: () => const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2)),
                      error: (error, _) => Text(l10n.somethingWentWrong,
                          key: const Key('loyalty-balance-error'),
                          style: context.type.body),
                      data: (balance) => LtrText(
                        '${_formatPoints(balance.pointsBalance)} ${l10n.loyaltyPointsSuffix}',
                        key: const Key('loyalty-balance-amount'),
                        style: context.type.title
                            .copyWith(fontWeight: FontWeight.w800),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: HatlySpacing.ms),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              key: const Key('loyalty-convert-action'),
              onPressed: balanceAsync.valueOrNull == null
                  ? null
                  : () => showModalBottomSheet(
                        context: context,
                        isScrollControlled: true,
                        builder: (_) => _ConvertSheet(
                          availablePoints:
                              balanceAsync.valueOrNull!.pointsBalance,
                        ),
                      ),
              child: Text(l10n.loyaltyConvertAction),
            ),
          ),
        ],
      ),
    );
  }
}

String _formatPoints(int points) {
  return NumberFormat.decimalPattern('en').format(points);
}

/// One ledger row. Credits (EARNING, ADMIN_ADJUSTMENT upward) show in
/// green with a "+"; debits (REDEMPTION, EARNING_REVERSED, EXPIRATION)
/// show in the normal text color with a "−" — same discipline as
/// Wallet's own `_TransactionTile`: spending/reversal is not an error
/// state, so it is never shown in the urgent/red color.
class _TransactionTile extends StatelessWidget {
  const _TransactionTile({required this.transaction});

  final CustomerLoyaltyTransaction transaction;

  String _typeLabel(AppLocalizations l10n) {
    switch (transaction.type) {
      case 'EARNING':
        return l10n.loyaltyTypeEarning;
      case 'EARNING_REVERSED':
        return l10n.loyaltyTypeEarningReversed;
      case 'REDEMPTION':
        return l10n.loyaltyTypeRedemption;
      case 'ADMIN_ADJUSTMENT':
        return l10n.loyaltyTypeAdminAdjustment;
      case 'EXPIRATION':
        return l10n.loyaltyTypeExpiration;
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
        '${isCredit ? '+' : '−'}${_formatPoints(transaction.pointsDelta.abs())} ${l10n.loyaltyPointsSuffix}';

    return HatlySurface(
      key: Key('loyalty-transaction-${transaction.id}'),
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

/// Points -> Hatly Wallet conversion (Part D). APPROVED V1 RULE: 500
/// points = 5 EGP (100 points/EGP), minimum 500, multiples of 100 —
/// mirrored here only as informational copy (`loyaltyConvertSheetRule`)
/// since the backend exposes no rate-lookup endpoint; the actual
/// accept/reject decision always comes from the real
/// `POST /customer/loyalty/convert` response, never computed or
/// pre-validated client-side beyond a basic "is this a positive
/// integer" input check.
class _ConvertSheet extends ConsumerStatefulWidget {
  const _ConvertSheet({required this.availablePoints});

  final int availablePoints;

  @override
  ConsumerState<_ConvertSheet> createState() => _ConvertSheetState();
}

class _ConvertSheetState extends ConsumerState<_ConvertSheet> {
  final _amountController = TextEditingController();
  bool _isSubmitting = false;
  String? _errorMessage;

  /// Generated ONCE per sheet instance (one logical conversion attempt)
  /// and reused across every retry within this sheet's lifetime — see
  /// `LoyaltyApi.convert`'s own comment for why this must never be
  /// regenerated per submit tap. Not a cryptographic UUID (no `uuid`
  /// package dependency exists in this app yet) — timestamp + a random
  /// suffix is unique enough for a single customer's own single retry
  /// sequence, which is all this key needs to disambiguate.
  late final String _idempotencyKey =
      'loyalty-convert-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context);
    final points = int.tryParse(_amountController.text.trim());
    if (points == null || points <= 0 || _isSubmitting) return;

    setState(() {
      _isSubmitting = true;
      _errorMessage = null;
    });

    try {
      final result = await ref.read(loyaltyApiProvider).convert(
            points: points,
            idempotencyKey: _idempotencyKey,
          );
      if (!mounted) return;
      invalidateLoyaltyAndWalletBalances(ref);
      ref.read(loyaltyTransactionsControllerProvider.notifier).refresh();
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(
            '${l10n.loyaltyConvertSuccess} (+${formatMinorUnits(result.walletCreditMinor, context)})'),
      ));
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _errorMessage = _localizedConvertError(l10n, error));
    } catch (_) {
      if (mounted) setState(() => _errorMessage = l10n.somethingWentWrong);
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  String _localizedConvertError(AppLocalizations l10n, ApiException error) {
    switch (error.businessCode) {
      case 'INSUFFICIENT_POINTS':
        return l10n.loyaltyErrorInsufficientPoints;
      case 'BELOW_MINIMUM_CONVERSION':
        return l10n.loyaltyErrorBelowMinimum;
      case 'INVALID_CONVERSION_MULTIPLE':
        return l10n.loyaltyErrorInvalidMultiple;
      default:
        return l10n.somethingWentWrong;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final p = context.palette;
    final points = int.tryParse(_amountController.text.trim());
    final isValid = points != null && points > 0;

    return Padding(
      padding: EdgeInsets.only(
        left: HatlySpacing.md,
        right: HatlySpacing.md,
        top: HatlySpacing.md,
        bottom: MediaQuery.of(context).viewInsets.bottom + HatlySpacing.md,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.loyaltyConvertSheetTitle, style: context.type.title),
          const SizedBox(height: HatlySpacing.xs),
          Text(l10n.loyaltyConvertSheetRule,
              style: context.type.caption.copyWith(color: p.textMuted)),
          const SizedBox(height: HatlySpacing.sm),
          Text(
            '${l10n.loyaltyConvertAvailableLabel}: ${_formatPoints(widget.availablePoints)} ${l10n.loyaltyPointsSuffix}',
            style: context.type.body,
          ),
          const SizedBox(height: HatlySpacing.ms),
          TextField(
            key: const Key('loyalty-convert-amount-field'),
            controller: _amountController,
            keyboardType: TextInputType.number,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: l10n.loyaltyConvertAmountLabel,
              hintText: l10n.loyaltyConvertAmountHint,
              border: const OutlineInputBorder(),
            ),
          ),
          if (_errorMessage != null) ...[
            const SizedBox(height: HatlySpacing.sm),
            Text(_errorMessage!,
                key: const Key('loyalty-convert-error'),
                // Polish pass: a bare `TextStyle(color:...)` falls back to
                // the platform default font, not the app's Inter+Cairo type
                // scale — matches add_address_screen.dart's own error text.
                style: context.type.small.copyWith(color: p.urgent)),
          ],
          const SizedBox(height: HatlySpacing.lg),
          HatlyPrimaryButton(
            label: l10n.loyaltyConvertSubmit,
            isLoading: _isSubmitting,
            onPressed: isValid && !_isSubmitting ? _submit : null,
          ),
        ],
      ),
    );
  }
}
