import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
import '../../../shared_widgets/driver_ui.dart';
import '../../deliveries/data/driver_providers.dart';
import '../../earnings/domain/earnings.dart';

/// Completed deliveries and what each one recorded for the driver, newest first, loaded a page at a time.
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
          return MessageView(icon: Icons.history, message: context.t('No completed deliveries yet.', 'لا توجد توصيلات مكتملة بعد.'));
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
              return DriverCard(
                key: Key('tx-${tx.id}'),
                onTap: () => context.push('/deliveries/${tx.orderId}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(tx.orderNumber, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800))),
                    Text(formatMinor(tx.netMinor, arabic: ar), textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFFE0650A))),
                  ]),
                  const SizedBox(height: 4),
                  Text(_date(tx.at), textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
                  const SizedBox(height: 6),
                  Text(
                    '${context.t('Earned', 'الربح')} ${formatMinor(tx.earningsMinor, arabic: ar)} · ${context.t('Commission', 'العمولة')} ${formatMinor(tx.commissionMinor, arabic: ar)}'
                    '${tx.reimbursementMinor > 0 ? ' · ${context.t('Reimbursed', 'مستردّ')} ${formatMinor(tx.reimbursementMinor, arabic: ar)}' : ''}',
                    style: const TextStyle(fontSize: 12),
                  ),
                  if (tx.cashDueAtDoorMinor != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('${context.t('Cash due at the door', 'نقد مستحق عند التسليم')}: ${formatMinor(tx.cashDueAtDoorMinor, arabic: ar)}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
                    ),
                ]),
              );
            },
          ),
        );
      }),
    );
  }
}
