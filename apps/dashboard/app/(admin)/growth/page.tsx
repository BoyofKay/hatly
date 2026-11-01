'use client';

import { useState } from 'react';
import { Async, Card, DateRange, FilterBar, KpiCard, PageHeader, cairoDate } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';

export default function GrowthPage() {
  const { t, num } = useLang();
  const [from, setFrom] = useState(cairoDate(-29));
  const [to, setTo] = useState(cairoDate(0));
  const g = useApi<any>('/admin/growth/overview', { from, to });
  const r = useApi<any>('/admin/growth/retention', { months: 6 });
  const d = g.data;
  const na = t('No data', 'لا بيانات');
  const pct = (v: number | null) => (v === null ? na : `${v}%`);
  const val = (v: number | null) => (v === null ? na : num(v));
  return (
    <div>
      <PageHeader title={t('Growth', 'النمو')} subtitle={t('Real counts only. A figure with no underlying data shows “No data” instead of zero. No revenue attribution or return on investment is estimated.', 'أعداد حقيقية فقط. الرقم بلا بيانات يظهر «لا بيانات» بدل الصفر. لا يُقدَّر إسناد الإيراد ولا عائد الاستثمار.')} />
      <FilterBar><DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /></FilterBar>
      <Async state={g} rows={3}>
        {d && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={t('New customers', 'عملاء جدد')} value={num(d.newCustomers)} />
            <KpiCard label={t('Orders', 'الطلبات')} value={val(d.orders)} />
            <KpiCard label={t('Ordering customers', 'العملاء الطالبون')} value={val(d.orderingCustomers)} />
            <KpiCard label={t('Repeat rate', 'نسبة التكرار')} value={pct(d.repeatRatePct)} hint={t('Ordering customers who had ordered before the order.', 'العملاء الطالبون الذين سبق لهم الطلب.')} />
            <KpiCard label={t('Orders per customer', 'الطلبات لكل عميل')} value={d.ordersPerCustomer === null ? na : String(d.ordersPerCustomer)} />
            <KpiCard label={t('Orders with a coupon', 'طلبات بقسيمة')} value={val(d.couponOrders)} />
            <KpiCard label={t('Loyalty points issued / redeemed', 'نقاط الولاء الممنوحة / المستبدلة')} value={`${num(d.loyaltyPointsIssued)} / ${num(d.loyaltyPointsRedeemed)}`} />
            <KpiCard label={t('Inbox messages delivered / opened', 'رسائل الوارد المسلّمة / المفتوحة')} value={`${num(d.inboxMessagesDelivered)} / ${num(d.inboxMessagesOpened)}`} hint={t('All time. Push delivery is best-effort.', 'الإجمالي. إرسال الإشعارات بأفضل جهد.')} />
          </div>
        )}
      </Async>
      <Card title={t('Retention by first-order month', 'الاحتفاظ بحسب شهر أول طلب')} className="mt-4">
        <Async state={r} empty={r.data && r.data.cells.length === 0} emptyTitle={t('No orders yet', 'لا توجد طلبات بعد')} rows={3}>
          {r.data && <Cohorts cells={r.data.cells} />}
        </Async>
      </Card>
    </div>
  );
}

function Cohorts({ cells }: { cells: Array<{ cohort: string; monthOffset: number; customers: number }> }) {
  const { t, num } = useLang();
  const cohorts = Array.from(new Set(cells.map((c) => c.cohort)));
  const maxOffset = Math.max(...cells.map((c) => c.monthOffset));
  const at = (cohort: string, off: number) => cells.find((c) => c.cohort === cohort && c.monthOffset === off)?.customers;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{t('Customers from each first-order month who ordered again in later months', 'عملاء كل شهر أول طلب الذين طلبوا مجددًا في الأشهر التالية')}</caption>
        <thead><tr className="text-xs text-gray-500"><th className="px-2 py-1 text-start">{t('Cohort', 'الدفعة')}</th>{Array.from({ length: maxOffset + 1 }, (_, i) => <th key={i} className="px-2 py-1 text-end">{i === 0 ? t('Month 0', 'الشهر 0') : `+${i}`}</th>)}</tr></thead>
        <tbody>
          {cohorts.map((c) => {
            const base = at(c, 0) ?? 0;
            return (
              <tr key={c} className="border-t border-gray-100">
                <td className="px-2 py-1 font-medium" dir="ltr">{c}</td>
                {Array.from({ length: maxOffset + 1 }, (_, i) => { const v = at(c, i); return <td key={i} className="px-2 py-1 text-end tabular-nums">{v === undefined ? <span className="text-gray-300">—</span> : <span title={base ? `${Math.round((v / base) * 100)}%` : ''}>{num(v)}{i > 0 && base ? <span className="text-xs text-gray-500"> ({Math.round((v / base) * 100)}%)</span> : null}</span>}</td>; })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
