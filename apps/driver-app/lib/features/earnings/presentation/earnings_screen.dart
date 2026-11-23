import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
import '../../../shared_widgets/driver_ui.dart';
import '../../deliveries/data/driver_providers.dart';
import '../domain/earnings.dart';
import 'money_breakdown_view.dart';

/// The driver's money, exactly as Hatly's backend computed it — the same figures Operations see when they close the shift. The open period
/// is the preview of the next closing; closed periods show what was settled and what remains. Nothing is computed on the phone.
class EarningsScreen extends ConsumerWidget {
  const EarningsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final earnings = ref.watch(earningsProvider);
    final ar = context.isArabic;
    String money(int v) => formatMinor(v, arabic: ar);
    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      appBar: AppBar(title: Text(context.t('Earnings', 'الأرباح')), backgroundColor: Colors.white, surfaceTintColor: Colors.transparent),
      body: earnings.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, s) => MessageView(icon: Icons.cloud_off_outlined, message: context.t('Could not load your earnings.', 'تعذّر تحميل أرباحك.'), onRetry: () => ref.invalidate(earningsProvider)),
        data: (data) {
          final open = data.open;
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(earningsProvider.future),
            child: ListView(
              key: const Key('earnings-list'),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                SectionTitle(context.t('Current shift (not closed yet)', 'الوردية الحالية (لم تُقفل بعد)')),
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
                  child: Text('${context.t('Shift duration', 'مدة الوردية')}: ${shiftDurationLabel(open.periodStart, arabic: ar)}', key: const Key('earnings-shift-duration')),
                ),
                DriverCard(
                  key: const Key('earnings-open'),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      KpiTile(
                        label: open.netMinor >= 0 ? context.t('Owed to you', 'مستحق للمندوب') : context.t('You owe Hatly', 'مستحق على المندوب'),
                        value: money(open.netMinor.abs()),
                        emphasis: true,
                      ),
                      const SizedBox(width: 10),
                      KpiTile(label: context.t('Delivered orders', 'طلبات مُسلّمة'), value: '${open.deliveries}'),
                    ]),
                    const SizedBox(height: 12),
                    if (open.breakdown != null)
                      MoneyBreakdownView(b: open.breakdown!, showNet: false)
                    else ...[
                      // older backend: only the four recorded figures exist
                      MoneyLine(context.t('Delivery fee', 'رسوم التوصيل'), money(open.earningsMinor)),
                      MoneyLine(context.t('Hatly commission', 'عمولة Hatly'), '- ${money(open.commissionMinor)}'),
                      MoneyLine(context.t('Reimbursements', 'المبالغ المستردة'), money(open.reimbursementsMinor)),
                    ],
                    if (open.inProgress > 0)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(context.t('${open.inProgress} order(s) still in progress — counted after delivery.', '${open.inProgress} طلب ما زال قيد التوصيل — يُحتسب بعد التسليم.'),
                            style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
                      ),
                  ]),
                ),
                if (open.excluded.isNotEmpty) ...[
                  SectionTitle(context.t('Orders held for the next closing', 'طلبات مؤجلة للتقفيلة التالية')),
                  DriverCard(
                    key: const Key('earnings-excluded'),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      for (final x in open.excluded)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(x.orderNumber, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700)),
                            const SizedBox(width: 8),
                            Expanded(child: Text(excludedReasonText(context, x.reason), style: const TextStyle(fontSize: 12, color: Color(0xFF8A5A00)))),
                          ]),
                        ),
                    ]),
                  ),
                ],
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Text(
                    context.t(
                      'Preview of your open shift. It becomes final when Hatly Operations close it at the office and record the payment.',
                      'هذه معاينة لورديتك المفتوحة. تصبح نهائية عندما تقفلها عمليات هاتلي في المكتب وتسجّل الدفع.',
                    ),
                    style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B)),
                  ),
                ),
                SectionTitle(context.t('Closed shifts', 'الورديات المُقفلة')),
                if (data.closedPeriods.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Center(child: Text(context.t('No closed shifts yet.', 'لا توجد ورديات مُقفلة بعد.'), style: const TextStyle(color: Color(0xFF6B6B6B)))))
                else
                  for (final p in data.closedPeriods) _ClosedPeriodCard(period: p),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _ClosedPeriodCard extends StatelessWidget {
  const _ClosedPeriodCard({required this.period});
  final ClosedPeriod period;

  String _date(DateTime d) {
    final l = d.toLocal();
    return '${l.year}-${l.month.toString().padLeft(2, '0')}-${l.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final ar = context.isArabic;
    String money(int v) => formatMinor(v, arabic: ar);
    return DriverCard(
      key: Key('closed-period-${period.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${_date(period.periodStart)}  →  ${_date(period.periodEnd)}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800))),
          if (period.reference != null) Text(period.reference!, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
        ]),
        const SizedBox(height: 8),
        Text('${context.t('Shift duration', 'مدة الوردية')}: ${shiftDurationLabel(period.periodStart, arabic: ar, end: period.periodEnd)}'),
        if (period.breakdown != null)
          MoneyBreakdownView(b: period.breakdown!)
        else ...[
          // closed before 2026-11-13: shown exactly as stored (never recomputed)
          Text(context.t('Earlier settlement — shown as recorded', 'تسوية سابقة — معروضة كما سُجّلت'), key: const Key('closed-legacy'), style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B))),
          MoneyLine(context.t('Delivery fee', 'رسوم التوصيل'), money(period.earningsMinor)),
          MoneyLine(context.t('Hatly commission', 'عمولة Hatly'), '- ${money(period.commissionMinor)}'),
          MoneyLine(context.t('Reimbursements', 'المبالغ المستردة'), money(period.reimbursementsMinor)),
          const Divider(),
          NetLine(netMinor: period.netMinor),
        ],
        if (period.settledMinor != null) MoneyLine(context.t('Settled', 'تم تسويته'), money(period.settledMinor!), key: const Key('closed-settled')),
        if (period.remainingMinor != null) MoneyLine(context.t('Remaining to settle', 'المتبقي للتسوية'), money(period.remainingMinor!), bold: true, key: const Key('closed-remaining')),
        const SizedBox(height: 6),
        if (period.payments.isEmpty)
          Text(context.t('No payment recorded yet.', 'لم يُسجَّل أي دفع بعد.'), style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B)))
        else
          for (final pay in period.payments.where((p) => p.status != 'VOIDED'))
            Text(
              '${pay.direction == 'PAYOUT' ? context.t('Paid to you', 'دُفع لك') : context.t('Paid by you', 'دفعتَه أنت')}: ${money(pay.amountMinor)}${pay.paidOn == null ? '' : ' · ${_date(pay.paidOn!)}'}',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
      ]),
    );
  }
}
