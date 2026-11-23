import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/localization/bilingual.dart';
import '../../core/utils/money.dart';
import '../../shared_widgets/driver_ui.dart';
import '../history/presentation/history_screen.dart';
import 'overview_api.dart';
import 'overview_widgets.dart';

/// Driver app round 2 (owner decision 2026-11-22): the order history in two tabs.
///  - Today: everything of the current, not-yet-closed shift (orders still with you + finished ones not settled yet).
///  - Previous: settled orders — this week by default; date range and status in the filter, search by order number or store.
/// KPIs on both: completed · cancelled · ignored · accepted vs ignored. Falls back to the previous History screen on an older server.
class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});
  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  bool _legacy = false;

  @override
  Widget build(BuildContext context) {
    if (_legacy) return const HistoryScreen();
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: const Color(0xFFFAFAFA),
        appBar: AppBar(
          title: Text(context.t('My orders', 'طلباتي')),
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          bottom: TabBar(tabs: [
            Tab(key: const Key('orders-tab-today'), text: context.t('Today', 'اليوم')),
            Tab(key: const Key('orders-tab-previous'), text: context.t('Previous', 'السابق')),
          ]),
        ),
        body: TabBarView(children: [
          _OrdersTab(tab: 'today', onUnavailable: () => setState(() => _legacy = true)),
          _OrdersTab(tab: 'previous', onUnavailable: () => setState(() => _legacy = true)),
        ]),
      ),
    );
  }
}

class _OrdersTab extends ConsumerStatefulWidget {
  const _OrdersTab({required this.tab, required this.onUnavailable});
  final String tab;
  final VoidCallback onUnavailable;
  @override
  ConsumerState<_OrdersTab> createState() => _OrdersTabState();
}

class _OrdersTabState extends ConsumerState<_OrdersTab> with AutomaticKeepAliveClientMixin {
  final _search = TextEditingController();
  Timer? _debounce;
  String? _status;
  DateTimeRange? _range; // null = this week (server default)
  OrdersOverview? _data;
  final List<OrderRow> _items = [];
  bool _loading = false;
  bool _failed = false;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load(reset: true));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = false}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final page = reset ? 1 : (_data?.page ?? 0) + 1;
      final r = await ref.read(overviewApiProvider).orders(
            tab: widget.tab,
            from: _range == null ? null : ymd(_range!.start),
            to: _range == null ? null : ymd(_range!.end),
            status: _status,
            search: _search.text.trim(),
            page: page,
          );
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        _items.addAll(r.items);
        _data = r;
        _loading = false;
      });
    } on OverviewUnavailable {
      if (mounted) widget.onUnavailable();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _load(reset: true));
  }

  Future<void> _openFilter() async {
    final statuses = <String?, String>{
      null: context.t('All', 'الكل'),
      'completed': context.t('Completed', 'مكتمل'),
      'cancelled': context.t('Cancelled', 'ملغي'),
      'failed': context.t('Failed', 'فشل'),
      if (widget.tab == 'today') 'active': context.t('In progress', 'قيد التنفيذ'),
    };
    String? status = _status;
    DateTimeRange? range = _range;
    final apply = await showModalBottomSheet<bool>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(ctx.t('Status', 'الحالة'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final e in statuses.entries)
                ChoiceChip(key: Key('orders-status-${e.key ?? 'all'}'), label: Text(e.value), selected: status == e.key, onSelected: (_) => setSheet(() => status = e.key)),
            ]),
            if (widget.tab == 'previous') ...[
              const SizedBox(height: 16),
              Text(ctx.t('Dates', 'التاريخ'), style: const TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                ChoiceChip(label: Text(ctx.t('This week', 'هذا الأسبوع')), selected: range == null, onSelected: (_) => setSheet(() => range = null)),
                ActionChip(
                  key: const Key('orders-pick-dates'),
                  avatar: const Icon(Icons.date_range, size: 18),
                  label: Text(range == null ? ctx.t('Choose dates', 'اختر التاريخ') : '${shortDate(range!.start)} – ${shortDate(range!.end)}'),
                  onPressed: () async {
                    final picked = await pickRange(ctx, initial: range);
                    if (picked != null) setSheet(() => range = picked);
                  },
                ),
              ]),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(key: const Key('orders-filter-apply'), onPressed: () => Navigator.of(ctx).pop(true), child: Text(ctx.t('Apply', 'تطبيق'))),
            ),
          ]),
        ),
      ),
    );
    if (apply == true) {
      setState(() {
        _status = status;
        _range = range;
      });
      await _load(reset: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final d = _data;
    final k = d?.kpis;
    final ar = context.isArabic;
    final filtered = _status != null || _range != null;
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView(
        key: Key('orders-list-${widget.tab}'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(children: [
            Expanded(
              child: TextField(
                key: Key('orders-search-${widget.tab}'),
                controller: _search,
                onChanged: _onSearch,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: const Icon(Icons.search),
                  hintText: context.t('Order number or store', 'رقم الطلب أو المتجر'),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filledTonal(
              key: Key('orders-filter-${widget.tab}'),
              tooltip: context.t('Filter', 'تصفية'),
              onPressed: _openFilter,
              icon: Badge(isLabelVisible: filtered, child: const Icon(Icons.tune)),
            ),
          ]),
          if (widget.tab == 'previous' && d?.range != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('${prettyYmd(d!.range!.from)} – ${prettyYmd(d.range!.to)}', style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
            ),
          const SizedBox(height: 12),
          if (k != null)
            Wrap(key: Key('orders-kpis-${widget.tab}'), spacing: 8, runSpacing: 8, children: [
              MiniKpi(label: context.t('Completed', 'مكتمل'), value: '${k.completed}', color: const Color(0xFF1B7F3B)),
              MiniKpi(label: context.t('Cancelled', 'ملغي'), value: '${k.cancelled}'),
              MiniKpi(label: context.t('Ignored', 'متجاهَل'), value: '${k.ignored}', color: k.ignored > 0 ? const Color(0xFFB3261E) : null),
              MiniKpi(
                label: context.t('Accepted / ignored', 'مقبول / متجاهَل'),
                value: '${k.accepted} / ${k.ignored}${k.acceptanceRatePercent == null ? '' : ' · ${k.acceptanceRatePercent}%'}',
                width: 150,
              ),
            ]),
          const SizedBox(height: 12),
          if (_failed && _items.isEmpty)
            MessageView(icon: Icons.cloud_off_outlined, message: context.t('Could not load your orders.', 'تعذّر تحميل طلباتك.'), onRetry: () => _load(reset: true))
          else if (d != null && _items.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 32),
              child: Center(
                child: Text(
                  widget.tab == 'today' ? context.t('No orders in this shift yet.', 'لا توجد طلبات في هذه الوردية بعد.') : context.t('No orders in these dates.', 'لا توجد طلبات في هذه الفترة.'),
                  key: Key('orders-empty-${widget.tab}'),
                  style: const TextStyle(color: Color(0xFF6B6B6B)),
                ),
              ),
            ),
          for (final o in _items)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFFEDEDED))),
              child: ListTile(
                key: Key('order-row-${o.orderNumber}'),
                dense: true,
                onTap: () => context.push('/deliveries/${o.deliveryId}'),
                title: Row(children: [
                  Text(o.orderNumber, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(width: 8),
                  Text(orderStatusLabel(context, o.status), style: TextStyle(fontSize: 12, color: orderStatusColor(o.status), fontWeight: FontWeight.w600)),
                ]),
                subtitle: Text(
                  [if (o.vendors != null) o.vendors!, if (o.at != null) shortDateTime(o.at!), if (o.settlementReference != null) o.settlementReference!].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: o.earnedMinor == null ? null : Text(formatMinor(o.earnedMinor, arabic: ar), style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
            ),
          if (_loading) const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
          if (!_loading && (d?.hasMore ?? false))
            TextButton(key: Key('orders-more-${widget.tab}'), onPressed: _load, child: Text(context.t('Load more', 'تحميل المزيد'))),
        ],
      ),
    );
  }
}
