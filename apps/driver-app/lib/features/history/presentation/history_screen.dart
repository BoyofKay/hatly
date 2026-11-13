import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
import '../../../shared_widgets/driver_ui.dart';
import '../../deliveries/data/driver_providers.dart';
import '../../earnings/domain/earnings.dart';
import '../../earnings/presentation/money_breakdown_view.dart';

/// The driver's delivered orders (from the server — never local history), newest first, a page at a time, each with its money state:
/// settled (closing reference), waiting for the next closing, or held with the reason. Amounts are the server's; nothing is computed here.
class HistoryScreen extends ConsumerStatefulWidget {
  const HistoryScreen({super.key});

  @override
  ConsumerState<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends ConsumerState<HistoryScreen> {
  final List<DriverTransaction> _items = [];
  int _page = 0;
  bool _hasMore = true;
  bool _loading = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _loadMore());
  }

  Future<void> _loadMore({bool reset = false}) async {
    if (_loading) return;
    if (reset) {
      _items.clear();
      _page = 0;
      _hasMore = true;
    }
    if (!_hasMore) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final result = await ref.read(driverApiProvider).getTransactions(page: _page + 1);
      if (!mounted) return;
      setState(() {
        _items.addAll(result.items);
        _page = result.page;
        _hasMore = result.hasMore;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  String _date(DateTime d) {
    final l = d.toLocal();
    return '${l.year}-${l.month.toString().padLeft(2, '0')}-${l.day.toString().padLeft(2, '0')}  ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final ar = context.isArabic;
    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      appBar: AppBar(title: Text(context.t('History', 'السجل')), backgroundColor: Colors.white, surfaceTintColor: Colors.transparent),
      body: Builder(builder: (context) {
        if (_items.isEmpty && _loading) return const Center(child: CircularProgressIndicator());
        if (_items.isEmpty && _failed) {
          return MessageView(icon: Icons.cloud_off_outlined, message: context.t('Could not load your history.', 'تعذّر تحميل السجل.'), onRetry: () => _loadMore());
        }
        if (_items.isEmpty) {
          return MessageView(icon: Icons.history, message: context.t('No delivered orders yet.', 'لا توجد طلبات مُسلّمة بعد.'));
        }
        return RefreshIndicator(
          onRefresh: () => _loadMore(reset: true),
          child: ListView.builder(
            key: const Key('history-list'),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: _items.length + 1,
            itemBuilder: (context, i) {
              if (i == _items.length) {
                if (_failed) return TextButton(onPressed: () => _loadMore(), child: Text(context.t('Retry', 'إعادة المحاولة')));
                if (_loading) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
                if (_hasMore) return TextButton(key: const Key('history-load-more'), onPressed: () => _loadMore(), child: Text(context.t('Load more', 'عرض المزيد')));
                return const SizedBox.shrink();
              }
              final tx = _items[i];
              final state = tx.settlementState;
              final (stateText, stateColor) = switch (state) {
                'SETTLED' => (context.t('Settled · ${tx.settlementReference ?? ''}', 'تمت التسوية · ${tx.settlementReference ?? ''}'), const Color(0xFF1B7F3B)),
                'PENDING' => (context.t('Waiting for the next closing', 'بانتظار التقفيلة التالية'), const Color(0xFF6B6B6B)),
                'EXCLUDED' => (excludedReasonText(context, tx.excludedReason), const Color(0xFF8A5A00)),
                'LEGACY_SETTLED' => (context.t('Settled earlier', 'سُوّي سابقًا'), const Color(0xFF6B6B6B)),
                _ => (null, const Color(0xFF6B6B6B)),
              };
              return DriverCard(
                key: Key('tx-${tx.id}'),
                // opens the delivery (its id); an older backend sends none, and then the row simply does not open
                onTap: tx.deliveryId == null ? null : () => context.push('/deliveries/${tx.deliveryId}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(tx.orderNumber, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800))),
                    if (state != 'EXCLUDED' && state != 'LEGACY_SETTLED')
                      Text(
                        '${tx.netMinor >= 0 ? context.t('Owed to you', 'مستحق للمندوب') : context.t('You owe', 'مستحق عليك')} ${formatMinor(tx.netMinor.abs(), arabic: ar)}',
                        key: Key('tx-net-${tx.id}'),
                        style: TextStyle(fontWeight: FontWeight.w800, color: tx.netMinor >= 0 ? const Color(0xFF1B7F3B) : const Color(0xFFB3261E)),
                      ),
                  ]),
                  const SizedBox(height: 4),
                  Text('${context.t('Delivered', 'سُلّم')} ${_date(tx.at)}', textDirection: ar ? TextDirection.rtl : TextDirection.ltr, style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
                  if (tx.vendors != null) Text(tx.vendors!, style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
                  if (tx.orderTotalMinor != null)
                    Text('${context.t('Order total', 'إجمالي الطلب')} ${formatMinor(tx.orderTotalMinor, arabic: ar)} · ${tx.paymentMethod == 'COD' ? context.t('Cash', 'نقدي') : context.t('Paid electronically', 'مدفوع إلكترونيًا')}',
                        style: const TextStyle(fontSize: 12)),
                  if (tx.breakdown != null) ...[const SizedBox(height: 6), MoneyBreakdownView(b: tx.breakdown!, showNet: false)],
                  if (stateText != null)
                    Padding(padding: const EdgeInsets.only(top: 6), child: Text(stateText, key: Key('tx-state-${tx.id}'), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: stateColor))),
                ]),
              );
            },
          ),
        );
      }),
    );
  }
}
