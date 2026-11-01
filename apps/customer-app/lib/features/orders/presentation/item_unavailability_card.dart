import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/l10n/app_localizations.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/hatly_theme.dart';
import '../../../core/utils/money_formatter.dart';
import '../../../shared_widgets/hatly_surface.dart';
import '../data/orders_providers.dart';
import '../domain/item_unavailability.dart';

/// "Some items are unavailable" (PD-016). The customer has exactly two answers — continue without the items, or cancel the whole order.
/// There is no replacement to pick and no price to approve. Nothing changes until the customer answers; silence is never treated as consent.
/// Cancelling is only a REQUEST here: Hatly staff carry it out through the existing cancellation path.
class ItemUnavailabilityCard extends ConsumerStatefulWidget {
  const ItemUnavailabilityCard({super.key, required this.orderId});

  final String orderId;

  @override
  ConsumerState<ItemUnavailabilityCard> createState() => _ItemUnavailabilityCardState();
}

class _ItemUnavailabilityCardState extends ConsumerState<ItemUnavailabilityCard> {
  bool _busy = false;
  String? _error;
  String? _doneMessageKey;

  Future<void> _answer(ItemUnavailability q, String decision) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(ordersApiProvider).respondToItemUnavailability(widget.orderId, q.id, decision);
      _doneMessageKey = decision == 'CANCEL_ORDER' ? 'cancel' : 'continue';
      ref.invalidate(itemUnavailabilityProvider(widget.orderId));
      ref.invalidate(orderDetailsProvider(widget.orderId));
    } on ApiException {
      if (mounted) setState(() => _error = AppLocalizations.of(context).itemUnavailableError);
    } catch (_) {
      if (mounted) setState(() => _error = AppLocalizations.of(context).itemUnavailableError);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmCancel(ItemUnavailability q) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l10n.itemUnavailableCancelConfirmTitle),
        content: Text(l10n.itemUnavailableCancelConfirmBody),
        actions: [
          TextButton(key: const Key('item-unavailable-keep'), onPressed: () => Navigator.of(ctx).pop(false), child: Text(l10n.itemUnavailableKeepOrder)),
          TextButton(key: const Key('item-unavailable-confirm-cancel'), onPressed: () => Navigator.of(ctx).pop(true), child: Text(l10n.itemUnavailableCancelConfirmAction)),
        ],
      ),
    );
    if (ok == true) await _answer(q, 'CANCEL_ORDER');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final q = ref.watch(itemUnavailabilityProvider(widget.orderId)).valueOrNull;
    if (q == null) return const SizedBox.shrink();

    String? status;
    if (q.cancellationRequested || _doneMessageKey == 'cancel') {
      status = l10n.itemUnavailableCancelRequested;
    } else if (q.operationsHandling) {
      status = l10n.itemUnavailableTeamContact;
    } else if (q.isClosed && q.customerDecision == 'CONTINUE_WITHOUT') {
      status = l10n.itemUnavailableDone;
    }
    if (!q.needsAnswer && status == null) return const SizedBox.shrink();

    final p = context.palette;
    return Padding(
      padding: const EdgeInsets.only(top: HatlySpacing.md),
      child: HatlySurface(
        borderColor: q.needsAnswer ? p.urgent : null,
        child: Column(
          key: const Key('item-unavailability-card'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Icon(Icons.remove_shopping_cart_outlined, color: q.needsAnswer ? p.urgent : p.link),
              const SizedBox(width: HatlySpacing.ms),
              Expanded(child: Text(l10n.itemUnavailableTitle, style: context.type.title)),
            ]),
            const SizedBox(height: HatlySpacing.sm),
            for (final i in q.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(children: [
                  Expanded(child: Text('${i.productName ?? '—'} × ${i.quantity}', style: context.type.body)),
                  if (i.amountMinor != null) Text(formatMinorUnits(i.amountMinor!, context), style: context.type.small),
                ]),
              ),
            const SizedBox(height: HatlySpacing.sm),
            if (q.needsAnswer && _doneMessageKey == null) ...[
              Text(l10n.itemUnavailableBody, style: context.type.small),
              const SizedBox(height: HatlySpacing.md),
              ElevatedButton(key: const Key('item-unavailable-continue'), onPressed: _busy ? null : () => _answer(q, 'CONTINUE_WITHOUT'), child: Text(l10n.itemUnavailableContinue)),
              const SizedBox(height: HatlySpacing.sm),
              OutlinedButton(key: const Key('item-unavailable-cancel'), onPressed: _busy ? null : () => _confirmCancel(q), child: Text(l10n.itemUnavailableCancel)),
            ] else if (status != null)
              Text(status, key: const Key('item-unavailability-status'), style: context.type.body),
            if (_error != null) ...[
              const SizedBox(height: HatlySpacing.sm),
              Text(_error!, key: const Key('item-unavailability-error'), style: context.type.small.copyWith(color: p.urgent)),
            ],
          ],
        ),
      ),
    );
  }
}

/// Items that were taken off the order (read-only, for the record). Hidden when there are none.
class RemovedItemsSection extends StatelessWidget {
  const RemovedItemsSection({super.key, required this.items});

  final List<RemovedOrderItem> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    return Padding(
      key: const Key('removed-items-section'),
      padding: const EdgeInsets.only(top: HatlySpacing.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(l10n.orderRemovedItemsTitle, style: context.type.caption),
        for (final i in items)
          Text('${i.productName ?? '—'} × ${i.quantity}', style: context.type.small.copyWith(decoration: TextDecoration.lineThrough, color: context.palette.textMuted)),
      ]),
    );
  }
}
