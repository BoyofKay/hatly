import 'package:flutter/material.dart';
import '../../../core/localization/bilingual.dart';
import '../../../core/utils/money.dart';
import '../domain/earnings.dart';

/// The money parts of an order or a period, exactly as the backend computed them (the same numbers the Admin closing shows). Pure display:
/// no arithmetic on the phone. COD goods appear only as an informational line marked "excluded from your net".
class MoneyBreakdownView extends StatelessWidget {
  const MoneyBreakdownView({super.key, required this.b, this.showNet = true});
  final MoneyBreakdown b;
  final bool showNet;

  @override
  Widget build(BuildContext context) {
    final ar = context.isArabic;
    String money(int v) => formatMinor(v, arabic: ar);
    final rows = <Widget>[
      MoneyLine(context.t('Delivery fee', 'رسوم التوصيل'), money(b.feeEntitlementMinor), key: const Key('mb-fee')),
      MoneyLine(context.t('Hatly commission', 'عمولة Hatly'), '- ${money(b.commissionMinor)}', key: const Key('mb-commission')),
      MoneyLine(context.t('Your compensation', 'تعويض المندوب'), money(b.courierCompensationMinor), bold: true, key: const Key('mb-compensation')),
      if (b.goodsReimbursementMinor != 0)
        MoneyLine(context.t('Goods you paid the store (electronic orders only)', 'قيمة البضاعة التي دفعها المندوب (للطلبات الإلكترونية فقط)'), '+ ${money(b.goodsReimbursementMinor)}', key: const Key('mb-goods-reimbursement')),
      if (b.cashCollectedMinor != 0) MoneyLine(context.t('Cash collected from the customer', 'النقدية المحصلة من العميل'), money(b.cashCollectedMinor), muted: true, key: const Key('mb-cash-collected')),
      if (b.goodsPassThroughMinor != 0)
        MoneyLine(context.t('Cash-order goods paid to the store (not part of your net)', 'بضاعة الطلبات النقدية المدفوعة للمتجر (مستبعدة من الصافي)'), money(b.goodsPassThroughMinor), muted: true, key: const Key('mb-goods-pass-through')),
      if (b.cashHeldMinor != 0)
        MoneyLine(context.t('Cash you already hold (delivery fee)', 'النقدية التي معك بالفعل (رسوم التوصيل)'), '- ${money(b.cashHeldMinor)}', key: const Key('mb-cash-held')),
      if (b.changeKeptMinor != 0) MoneyLine(context.t('Change you kept (added to customer wallet)', 'الباقي الذي احتفظت به (أضيف لمحفظة العميل)'), '- ${money(b.changeKeptMinor)}', key: const Key('mb-change-kept')),
    ];
    return Column(children: [
      ...rows,
      if (showNet) ...[const Divider(), NetLine(netMinor: b.netToCourierMinor)],
    ]);
  }
}

/// "Owed to you" / "You owe Hatly" with the amount (never a bare signed number).
class NetLine extends StatelessWidget {
  const NetLine({super.key, required this.netMinor, this.label});
  final int netMinor;
  final String? label;
  @override
  Widget build(BuildContext context) {
    final ar = context.isArabic;
    final owedToYou = netMinor >= 0;
    final text = label ?? (owedToYou ? context.t('Owed to you', 'مستحق للمندوب') : context.t('You owe Hatly', 'مستحق على المندوب'));
    return MoneyLine(text, formatMinor(netMinor.abs(), arabic: ar), bold: true, color: owedToYou ? const Color(0xFF1B7F3B) : const Color(0xFFB3261E), key: const Key('mb-net'));
  }
}

class MoneyLine extends StatelessWidget {
  const MoneyLine(this.label, this.value, {super.key, this.bold = false, this.muted = false, this.color});
  final String label;
  final String value;
  final bool bold;
  final bool muted;
  final Color? color;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(label, style: TextStyle(fontSize: 13, color: muted ? const Color(0xFF6B6B6B) : null))),
          const SizedBox(width: 8),
          Text(value, textDirection: TextDirection.ltr, style: TextStyle(fontWeight: bold ? FontWeight.w800 : FontWeight.w600, color: color ?? (muted ? const Color(0xFF6B6B6B) : null))),
        ]),
      );
}

/// Why a delivered order is not counted yet.
String excludedReasonText(BuildContext context, String? reason) {
  switch (reason) {
    case 'RATE_UNDEFINED':
      return context.t('Your commission rate is not set yet — Operations will set it', 'نسبة العمولة الخاصة بك غير محددة بعد — ستحددها العمليات');
    case 'CHANGE_PENDING_REVIEW':
      return context.t('Change to wallet is being reviewed', 'الباقي المضاف للمحفظة قيد المراجعة');
    case 'LEGACY_PAY_AT_DELIVERY':
      return context.t('Old payment type — Operations will review', 'طريقة دفع قديمة — ستراجعها العمليات');
    case 'AMOUNT_DUE_MISSING':
      return context.t('Amount due is missing — Operations will review', 'المبلغ المستحق غير مسجل — ستراجعه العمليات');
    case 'FAILED_DELIVERY_NEEDS_RESOLUTION':
      return context.t('Failed delivery — waiting for Operations', 'توصيل فاشل — بانتظار قرار العمليات');
    case 'CANCELLED_AFTER_EXPENSE_NEEDS_DECISION':
      return context.t('Cancelled after you paid the store — Operations will decide', 'أُلغي بعد دفعك للمتجر — ستقرر العمليات');
    default:
      return context.t('Waiting for Operations', 'بانتظار العمليات');
  }
}
