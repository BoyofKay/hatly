import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/localization/bilingual.dart';
import '../../core/utils/money.dart';
import '../../shared_widgets/driver_ui.dart';
import '../earnings/presentation/earnings_screen.dart';
import '../earnings/presentation/money_breakdown_view.dart';
import 'overview_api.dart';
import 'overview_widgets.dart';

/// Driver app round 2 (owner decision 2026-11-22): Earnings in two tabs, every amount the server's (the same figures the office closes with).
///  - Current shift: cash in pocket · revenue (earned after Hatly's commission) · loan · daily allowance · balance · unsettled orders, and
///    one row per delivered order with an arrow for the full breakdown.
///  - Previous: one row per closing (this week by default; dates and paid/unpaid in the filter): revenue · orders · time worked.
/// Falls back to the previous Earnings screen on an older server.
class EarningsTabsScreen extends ConsumerStatefulWidget {
  const EarningsTabsScreen({super.key});
  @override
  ConsumerState<EarningsTabsScreen> createState() => _EarningsTabsScreenState();
}

class _EarningsTabsScreenState extends ConsumerState<EarningsTabsScreen> {
  bool _legacy = false;
  @override
  Widget build(BuildContext context) {
    if (_legacy) return const EarningsScreen();
    void fallback() => setState(() => _legacy = true);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: const Color(0xFFFAFAFA),
        appBar: AppBar(
          toolbarHeight: 0,
          backgroundColor: Colors.white,
          surfaceTintColor: Colors.transparent,
          bottom: TabBar(tabs: [
            Tab(key: const Key('earnings-tab-current'), text: context.t('Current balance', 'الرصيد الحالي')),
            Tab(key: const Key('earnings-tab-previous'), text: context.t('Previous', 'السابق')),
          ]),
        ),
        body: TabBarView(children: [_CurrentTab(onUnavailable: fallback), _PreviousTab(onUnavailable: fallback)]),
      ),
    );
  }
}

class _CurrentTab extends ConsumerStatefulWidget {
  const _CurrentTab({required this.onUnavailable});
  final VoidCallback onUnavailable;
  @override
  ConsumerState<_CurrentTab> createState() => _CurrentTabState();
}

class _CurrentTabState extends ConsumerState<_CurrentTab> with AutomaticKeepAliveClientMixin {
  CurrentEarnings? _data;
  bool _failed = false;
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() => _failed = false);
    try {
      final r = await ref.read(overviewApiProvider).currentEarnings();
      if (mounted) setState(() => _data = r);
    } on OverviewUnavailable {
      if (mounted) widget.onUnavailable();
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final ar = context.isArabic;
    String money(int v) => formatMinor(v, arabic: ar);
    final d = _data;
    if (_failed && d == null) {
      return MessageView(icon: Icons.cloud_off_outlined, message: context.t('Could not load your earnings.', 'تعذّر تحميل أرباحك.'), onRetry: _load);
    }
    if (d == null) return const Center(child: CircularProgressIndicator());
    final owedToYou = d.balanceMinor >= 0;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const Key('earnings-current-list'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          ExpansionTile(
            key: const Key('earnings-kpi-toggle'),
            initiallyExpanded: false,
            tilePadding: const EdgeInsets.symmetric(horizontal: 8),
            title: Text(context.t('Current wallet balance', 'رصيد المحفظة الحالي')),
            subtitle: Text('${money(d.balanceMinor.abs())} · ${owedToYou ? context.t('Hatly pays you', 'هاتلي تدفع لك') : context.t('You hand over', 'تسلّمه أنت')}'),
            children: [
          Wrap(key: const Key('earnings-current-kpis'), spacing: 8, runSpacing: 8, children: [
            MiniKpi(label: context.t('Cash in pocket', 'نقدية معك'), value: money(d.cashInPocketMinor), width: 150),
            MiniKpi(label: context.t('Revenue (after commission)', 'الإيراد (بعد العمولة)'), value: money(d.revenueMinor), color: const Color(0xFF1B7F3B), width: 150),
            MiniKpi(label: context.t('Loan', 'السلفة'), value: money(d.loanMinor), width: 150),
            MiniKpi(label: context.t('Daily allowance', 'العهدة اليومية'), value: money(d.allowanceMinor), color: d.allowanceMinor > 0 ? const Color(0xFF8D6E00) : null, width: 150),
            MiniKpi(
              key: const Key('earnings-balance'),
              label: owedToYou ? context.t('Balance — Hatly pays you', 'الرصيد — هاتلي تدفع لك') : context.t('Balance — you hand over', 'الرصيد — تسلّمه أنت'),
              value: money(d.balanceMinor.abs()),
              color: owedToYou ? const Color(0xFF1B7F3B) : const Color(0xFFB3261E),
              width: 150,
            ),
            MiniKpi(label: context.t('Unsettled orders', 'طلبات غير مسوّاة'), value: '${d.unsettledOrders}', width: 150),
          ]),
          const SizedBox(height: 6),
          Text(
            context.t('Balance = what changes hands at the closing (orders, minus the allowance you return). Loans are repaid separately.',
                'الرصيد = ما يُسلَّم في التقفيل (الطلبات ناقص العهدة التي تردّها). السلف تُسدَّد منفصلة.'),
            style: const TextStyle(fontSize: 11, color: Color(0xFF6B6B6B)),
          ),
            ],
          ),
          const SizedBox(height: 12),
          if (d.items.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Center(child: Text(context.t('No delivered orders in this shift yet.', 'لا توجد طلبات مُسلّمة في هذه الوردية بعد.'), key: const Key('earnings-current-empty'), style: const TextStyle(color: Color(0xFF6B6B6B)))),
            ),
          for (final e in d.items)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFFEDEDED))),
              child: ExpansionTile(
                key: Key('earning-row-${e.orderNumber}'),
                shape: const Border(),
                dense: true,
                title: Text(e.orderNumber, style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: e.deliveredAt == null ? null : Text(shortDateTime(e.deliveredAt!)),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(money(e.earnedMinor), style: const TextStyle(fontWeight: FontWeight.w700)),
                  const Icon(Icons.expand_more),
                ]),
                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                children: [if (e.breakdown != null) MoneyBreakdownView(b: e.breakdown!) else NetLine(netMinor: e.netMinor)],
              ),
            ),
          if (d.held.isNotEmpty)
            Text(
              context.t('Held back until the office resolves them: ${d.held.join(', ')}', 'مؤجلة حتى يحسمها المكتب: ${d.held.join('، ')}'),
              style: const TextStyle(fontSize: 12, color: Color(0xFF8D6E00)),
            ),
        ],
      ),
    );
  }
}

class _PreviousTab extends ConsumerStatefulWidget {
  const _PreviousTab({required this.onUnavailable});
  final VoidCallback onUnavailable;
  @override
  ConsumerState<_PreviousTab> createState() => _PreviousTabState();
}

class _PreviousTabState extends ConsumerState<_PreviousTab> with AutomaticKeepAliveClientMixin {
  PreviousEarnings? _data;
  bool _failed = false;
  DateTimeRange? _range;
  String? _status; // null | paid | unpaid
  String _search = '';
  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    setState(() => _failed = false);
    try {
      final r = await ref.read(overviewApiProvider).previousEarnings(
            from: _range == null ? null : ymd(_range!.start),
            to: _range == null ? null : ymd(_range!.end),
            status: _status,
          );
      if (mounted) setState(() => _data = r);
    } on OverviewUnavailable {
      if (mounted) widget.onUnavailable();
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _openSearch() async {
    String query = _search;
    final value = await showDialog<String>(context: context, builder: (ctx) => AlertDialog(
      title: Text(ctx.t('Search closings', 'البحث عن التقفيلات')),
      content: TextFormField(initialValue: query, autofocus: true,
        decoration: InputDecoration(hintText: ctx.t('Closing reference', 'رقم التقفيلة')),
        onChanged: (v) => query = v, onFieldSubmitted: (v) => Navigator.pop(ctx, v)),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, ''), child: Text(ctx.t('Clear', 'مسح'))),
        TextButton(onPressed: () => Navigator.pop(ctx, query), child: Text(ctx.t('Search', 'بحث'))),
      ],
    ));
    if (value != null && mounted) setState(() => _search = value.trim());
  }

  Future<void> _openFilter() async {
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
            Wrap(spacing: 8, children: [
              for (final e in {null: ctx.t('All', 'الكل'), 'paid': ctx.t('Settled', 'مسوّاة'), 'unpaid': ctx.t('Still due', 'ما زال مستحقًا')}.entries)
                ChoiceChip(label: Text(e.value), selected: status == e.key, onSelected: (_) => setSheet(() => status = e.key)),
            ]),
            const SizedBox(height: 16),
            Text(ctx.t('Dates', 'التاريخ'), style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Wrap(spacing: 8, children: [
              ChoiceChip(label: Text(ctx.t('This week', 'هذا الأسبوع')), selected: range == null, onSelected: (_) => setSheet(() => range = null)),
              ActionChip(
                avatar: const Icon(Icons.date_range, size: 18),
                label: Text(range == null ? ctx.t('Choose dates', 'اختر التاريخ') : '${shortDate(range!.start)} – ${shortDate(range!.end)}'),
                onPressed: () async {
                  final picked = await pickRange(ctx, initial: range);
                  if (picked != null) setSheet(() => range = picked);
                },
              ),
            ]),
            const SizedBox(height: 16),
            SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(ctx.t('Apply', 'تطبيق')))),
          ]),
        ),
      ),
    );
    if (apply == true) {
      setState(() {
        _status = status;
        _range = range;
      });
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final ar = context.isArabic;
    String money(int v) => formatMinor(v, arabic: ar);
    final d = _data;
    if (_failed && d == null) {
      return MessageView(icon: Icons.cloud_off_outlined, message: context.t('Could not load your earnings.', 'تعذّر تحميل أرباحك.'), onRetry: _load);
    }
    if (d == null) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        key: const Key('earnings-previous-list'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(children: [
            Expanded(child: DateRangeBox(from: d.range?.from, to: d.range?.to)),
            IconButton(onPressed: _openSearch, tooltip: context.t('Search', 'بحث'),
              icon: Badge(isLabelVisible: _search.isNotEmpty, child: const Icon(Icons.search))),
            IconButton.filledTonal(
              key: const Key('earnings-filter'),
              tooltip: context.t('Filter', 'تصفية'),
              onPressed: _openFilter,
              icon: Badge(isLabelVisible: _range != null || _status != null, child: const Icon(Icons.tune)),
            ),
          ]),
          const SizedBox(height: 8),
          LayoutBuilder(builder: (context, constraints) => Wrap(key: const Key('earnings-previous-kpis'), spacing: 4, runSpacing: 4, children: [
            MiniKpi(label: context.t('Revenue', 'الإيراد'), value: money(d.revenueMinor), color: const Color(0xFF1B7F3B), width: (constraints.maxWidth - 8) / 3),
            MiniKpi(label: context.t('Orders', 'الطلبات'), value: '${d.orders}', width: (constraints.maxWidth - 8) / 3),
            MiniKpi(label: context.t('Time worked', 'ساعات العمل'), value: hoursMinutes(context, d.minutesWorked), width: (constraints.maxWidth - 8) / 3),
          ])),
          const SizedBox(height: 12),
          if (d.items.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Center(child: Text(context.t('No closings in these dates.', 'لا توجد تقفيلات في هذه الفترة.'), key: const Key('earnings-previous-empty'), style: const TextStyle(color: Color(0xFF6B6B6B)))),
            ),
          for (final c in d.items.where((c) => _search.isEmpty || (c.reference ?? '').toLowerCase().contains(_search.toLowerCase())))
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              elevation: 0,
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: const BorderSide(color: Color(0xFFEDEDED))),
              child: ExpansionTile(
                key: Key('closing-row-${c.id}'),
                shape: const Border(),
                dense: true,
                title: Text(c.reference ?? '—', style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: Text([
                  if (c.closedAt != null) shortDateTime(c.closedAt!),
                  context.t('${c.orders} orders', '${c.orders} طلب'),
                  hoursMinutes(context, c.minutesWorked),
                ].join(' · ')),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(money(c.revenueMinor), style: const TextStyle(fontWeight: FontWeight.w700)),
                  const Icon(Icons.expand_more),
                ]),
                childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                children: [
                  if (c.breakdown != null) MoneyBreakdownView(b: c.breakdown!) else NetLine(netMinor: c.netMinor),
                  if (c.allowanceReturnedMinor > 0) MoneyLine(context.t('Daily allowance returned', 'العهدة اليومية المردودة'), money(c.allowanceReturnedMinor), muted: true),
                  MoneyLine(
                    c.remainingMinor > 0 ? context.t('Still due', 'ما زال مستحقًا') : context.t('Settled', 'تمت التسوية'),
                    c.remainingMinor > 0 ? money(c.remainingMinor) : '✓',
                    bold: true,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
