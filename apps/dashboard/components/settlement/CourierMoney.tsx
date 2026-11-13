'use client';

import Link from 'next/link';
import { useLang } from '../../lib/ui/lang';

/**
 * Courier / vendor closing money, displayed exactly as the backend computed it (courier-settlement-math.ts). One label set for the closing
 * preview, the saved closing, the courier statement and the period detail page, so the same figure always reads the same way.
 * COD goods appear only as an informational line, marked as excluded from the courier's net.
 */
export const COURIER_PARTS: Array<{ key: string; en: string; ar: string; sign?: '+' | '-'; info?: boolean }> = [
  { key: 'feeEntitlementMinor', en: 'Delivery fee', ar: 'رسوم التوصيل' },
  { key: 'commissionMinor', en: 'Hatly commission', ar: 'عمولة Hatly', sign: '-' },
  { key: 'courierCompensationMinor', en: 'Courier compensation', ar: 'تعويض المندوب' },
  { key: 'goodsReimbursementMinor', en: 'Goods paid by the courier (electronic orders only)', ar: 'قيمة البضاعة التي دفعها المندوب (للطلبات الإلكترونية فقط)', sign: '+' },
  { key: 'cashCollectedMinor', en: 'Cash collected from customers', ar: 'النقدية المحصلة من العميل', info: true },
  { key: 'goodsPassThroughMinor', en: 'COD goods paid to stores (excluded from the net)', ar: 'بضاعة الطلبات النقدية المدفوعة للمتاجر (مستبعدة من الصافي)', info: true },
  { key: 'cashHeldMinor', en: 'Cash the courier already holds', ar: 'النقدية المتبقية مع المندوب', sign: '-' },
  { key: 'changeKeptMinor', en: 'Change kept (credited to customer wallet)', ar: 'الباقي المحتفظ به (أضيف لمحفظة العميل)', sign: '-' },
  { key: 'collectedByHatlyMinor', en: 'Collected by Hatly (transfer / wallet)', ar: 'محصّل بواسطة Hatly (تحويل / محفظة)', info: true },
];

export const UNRESOLVED_REASON: Record<string, [string, string]> = {
  RATE_UNDEFINED: ['Courier commission rate not set (R43) — not settled, no rate assumed', 'نسبة عمولة المندوب غير محددة (R43) — لا تُسوّى ولا تُفترض نسبة'],
  LEGACY_PAY_AT_DELIVERY: ['Legacy pay-at-delivery order (R20) — needs review', 'طلب دفع عند التسليم قديم (R20) — يحتاج مراجعة'],
  AMOUNT_DUE_MISSING: ['Cash amount due is missing — needs review', 'المبلغ النقدي المستحق غير مسجل — يحتاج مراجعة'],
  CHANGE_PENDING_REVIEW: ['Change-to-wallet claim under review', 'طلب إضافة الباقي للمحفظة قيد المراجعة'],
  IN_PROGRESS: ['Still on the road — counted after delivery', 'ما زال قيد التوصيل — يُحتسب بعد التسليم'],
  FAILED_DELIVERY_NEEDS_RESOLUTION: ['Failed delivery waiting for an Operations decision (R36)', 'توصيل فاشل بانتظار قرار العمليات (R36)'],
  CANCELLED_AFTER_EXPENSE_NEEDS_DECISION: ['Cancelled after the courier paid a store — Operations decide (R45)', 'أُلغي بعد دفع المندوب للمتجر — قرار العمليات (R45)'],
};

/** "مستحق للمندوب 330.00" / "مستحق على المندوب 10.00" — never a bare signed number. */
export function CourierNet({ minor, testId }: { minor: number; testId?: string }) {
  const { t, money } = useLang();
  const toCourier = minor >= 0;
  return (
    <span data-testid={testId} className={`font-semibold ${toCourier ? 'text-green-700' : 'text-red-700'}`}>
      {toCourier ? t('Owed to the courier', 'مستحق للمندوب') : t('Owed by the courier', 'مستحق على المندوب')} {money(Math.abs(minor))}
    </span>
  );
}

/** Totals of a courier preview / closing / statement: one row per part, then the net. */
export function CourierBreakdown({ totals, testId }: { totals: Record<string, number | null | undefined>; testId?: string }) {
  const { t, money } = useLang();
  return (
    <dl className="divide-y divide-gray-100 text-sm" data-testid={testId}>
      {COURIER_PARTS.filter((p) => totals[p.key] != null && (totals[p.key] !== 0 || !p.info)).map((p) => (
        <div key={p.key} className="flex items-baseline justify-between gap-3 py-1.5" data-testid={`part-${p.key}`}>
          <dt className={p.info ? 'text-gray-500' : 'text-gray-700'}>{t(p.en, p.ar)}</dt>
          <dd className={`tabular-nums ${p.info ? 'text-gray-500' : 'font-medium'}`}>{p.sign && totals[p.key] ? `${p.sign} ` : ''}{money(totals[p.key] as number)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 py-2">
        <dt className="font-semibold text-gray-900">{t('Net', 'الصافي')}</dt>
        <dd><CourierNet minor={(totals.netToCourierMinor ?? 0) as number} testId={testId ? `${testId}-net` : undefined} /></dd>
      </div>
    </dl>
  );
}

/** DataTable columns for courier order lines (preview, closing, statement, detail). */
export function useCourierLineColumns() {
  const { t, money, dateTime } = useLang();
  return [
    { key: 'o', header: t('Order', 'الطلب'), cell: (x: any) => <Link className="text-hatly-orangeDark hover:underline" href={`/order-search/${x.orderId}`}><bdi>{x.orderNumber}</bdi></Link> },
    { key: 'at', header: t('Delivered', 'التسليم'), cell: (x: any) => (x.deliveredAt ?? x.at ? dateTime(x.deliveredAt ?? x.at) : '—') },
    { key: 'flow', header: t('Payment', 'الدفع'), cell: (x: any) => (x.paymentFlow === 'COD' ? t('Cash (COD)', 'نقدي') : t('Electronic', 'إلكتروني')) },
    { key: 'fee', header: t('Delivery fee', 'رسوم التوصيل'), align: 'end' as const, cell: (x: any) => money(x.feeEntitlementMinor) },
    { key: 'com', header: t('Hatly commission', 'عمولة Hatly'), align: 'end' as const, cell: (x: any) => money(x.commissionMinor) },
    { key: 'goods', header: t('Goods reimbursed', 'بضاعة مستردة'), align: 'end' as const, cell: (x: any) => money(x.goodsReimbursementMinor) },
    { key: 'pass', header: t('COD goods (excluded)', 'بضاعة نقدية (مستبعدة)'), align: 'end' as const, cell: (x: any) => <span className="text-gray-500">{money(x.goodsPassThroughMinor)}</span> },
    { key: 'cash', header: t('Cash collected', 'النقدية المحصلة'), align: 'end' as const, cell: (x: any) => money(x.cashCollectedMinor) },
    { key: 'held', header: t('Cash held', 'نقدية مع المندوب'), align: 'end' as const, cell: (x: any) => money(x.cashHeldMinor) },
    { key: 'net', header: t('Net', 'الصافي'), align: 'end' as const, cell: (x: any) => <CourierNet minor={x.netToCourierMinor} /> },
  ];
}

export function UnresolvedList({ items }: { items: Array<{ orderId: string; orderNumber: string; reason: string; status?: string }> }) {
  const { t } = useLang();
  if (!items.length) return null;
  return (
    <ul className="divide-y divide-amber-100 text-sm" data-testid="closing-unresolved">
      {items.map((u) => (
        <li key={u.orderId} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
          <Link className="font-medium text-hatly-orangeDark hover:underline" href={`/order-search/${u.orderId}`}><bdi>{u.orderNumber}</bdi></Link>
          <span className="text-amber-900">{t(...(UNRESOLVED_REASON[u.reason] ?? [u.reason, u.reason]))}</span>
        </li>
      ))}
    </ul>
  );
}
