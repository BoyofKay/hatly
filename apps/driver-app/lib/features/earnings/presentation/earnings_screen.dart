import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
import '../../../shared_widgets/driver_ui.dart';
import '../../deliveries/data/driver_providers.dart';
import '../domain/earnings.dart';

/// What the platform has recorded for the driver. The open period is the server's preview of the period that has not been closed yet; closed
/// periods are shown as stored together with the payments recorded against them. Nothing here is computed on the phone.
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
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.refresh(earningsProvider.future),
          child: ListView(
            key: const Key('earnings-list'),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            children: [
              SectionTitle(context.t('Current period (not closed yet)', 'الفترة الحالية (لم تُغلق بعد)')),
              DriverCard(
                key: const Key('earnings-open'),
                child: Column(children: [
                  Row(children: [
                    KpiTile(label: context.t('Net so far', 'الصافي حتى الآن'), value: money(data.open.netMinor), emphasis: true),
                    const SizedBox(width: 10),
                    KpiTile(label: context.t('Deliveries', 'التوصيلات'), value: '${data.open.deliveries}'),
                  ]),
                  const SizedBox(height: 12),
                  _Line(context.t('Delivery earnings', 'أرباح التوصيل'), money(data.open.earningsMinor)),
                  _Line(context.t('Platform commission', 'عمولة المنصة'), '- ${money(data.open.commissionMinor)}'),
                  _Line(context.t('Reimbursements', 'المبالغ المستردة'), money(data.open.reimbursementsMinor)),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  context.t('This is a preview of the open period. It becomes final when Hatly closes the period and records the payment.', 'هذه معاينة للفترة المفتوحة. تصبح نهائية عندما تغلق هاتلي الفترة وتسجّل الدفع.'),
                  style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B)),
                ),
              ),
              SectionTitle(context.t('Closed periods', 'الفترات المغلقة')),
              if (data.closedPeriods.isEmpty)
                Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Center(child: Text(context.t('No closed periods yet.', 'لا توجد فترات مغلقة بعد.'), style: const TextStyle(color: Color(0xFF6B6B6B)))))
              else
                for (final p in data.closedPeriods) _ClosedPeriodCard(period: p),
            ],
          ),
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [Expanded(child: Text(label)), Text(value, textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w700))]),
      );
}

class _ClosedPeriodCard extends StatelessWidget {
  const _ClosedPeriodCard({required this.period});
  final ClosedPeriod period;

  String _date(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final ar = context.isArabic;
    String money(int v) => formatMinor(v, arabic: ar);
    return DriverCard(
      key: Key('closed-period-${period.id}'),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${_date(period.periodStart)}  →  ${_date(period.periodEnd)}', textDirection: TextDirection.ltr, style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        _Line(context.t('Delivery earnings', 'أرباح التوصيل'), money(period.earningsMinor)),
        _Line(context.t('Platform commission', 'عمولة المنصة'), '- ${money(period.commissionMinor)}'),
        _Line(context.t('Reimbursements', 'المبالغ المستردة'), money(period.reimbursementsMinor)),
        const Divider(),
        _Line(context.t('Net', 'الصافي'), money(period.netMinor)),
        const SizedBox(height: 6),
        if (period.payments.isEmpty)
          Text(context.t('No payment recorded yet.', 'لم يُسجَّل أي دفع بعد.'), style: const TextStyle(fontSize: 12, color: Color(0xFF6B6B6B)))
        else
          for (final pay in period.payments)
            Text(
              '${pay.direction == 'HATLY_TO_DRIVER' ? context.t('Paid to you', 'دُفع لك') : context.t('Paid by you', 'دفعتَه أنت')}: ${money(pay.amountMinor)}${pay.paidOn == null ? '' : ' · ${_date(pay.paidOn!)}'}',
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
      ]),
    );
  }
}
