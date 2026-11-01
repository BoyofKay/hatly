'use client';

import { useState } from 'react';
import { Async, BarChart, Card, KpiCard, LabeledSelect, PageHeader, Tabs, cairoDate } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import type { VendorInsights, VendorOverview } from '../../../lib/api/vendor-business';
import { SEGMENT_STATUS, pick } from '../../../lib/vendor/labels';

/** Sales and operations insight for the vendor's own branches: volume, goods value, busy hours, best sellers, and how fast the branch accepts and prepares. */
export default function VendorInsightsPage() {
  const { t, num, money, locale } = useLang();
  const [days, setDays] = useState('30');
  const [branchId, setBranchId] = useState('');
  const overview = useApi<VendorOverview>('/vendor/overview');
  const state = useApi<VendorInsights>('/vendor/insights', { from: cairoDate(-(Number(days) - 1)), to: cairoDate(0), branchId: branchId || undefined });
  const d = state.data;
  return (
    <div className="space-y-4">
      <PageHeader title={t('Insights', 'التحليلات')} subtitle={t('How your branches are doing. Figures count the orders placed in the period; cancelled parts are not counted in goods value.', 'أداء فروعك. تُحسب الأرقام على الطلبات المُنشأة في الفترة؛ ولا تدخل الأجزاء الملغاة في قيمة البضاعة.')} />
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={days} onChange={setDays} tabs={[{ id: '7', label: t('7 days', '٧ أيام') }, { id: '30', label: t('30 days', '٣٠ يومًا') }, { id: '90', label: t('90 days', '٩٠ يومًا') }]} />
        {(overview.data?.branches.length ?? 0) > 1 && <div className="mb-4 w-48"><LabeledSelect label={t('Branch', 'الفرع')} value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">{t('All branches', 'كل الفروع')}</option>{overview.data!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</LabeledSelect></div>}
      </div>
      <Async state={state} rows={4}>
        {d && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6" data-testid="vendor-insight-kpis">
              <KpiCard label={t('Orders', 'الطلبات')} value={num(d.totals.received)} />
              <KpiCard label={t('Cancelled', 'الملغاة')} value={num(d.totals.cancelled)} hint={d.totals.received ? `${Math.round((d.totals.cancelled / d.totals.received) * 100)}%` : undefined} tone={d.totals.cancelled ? 'bad' : 'neutral'} />
              <KpiCard label={t('Goods value', 'قيمة البضاعة')} value={money(d.totals.goodsMinor)} />
              <KpiCard label={t('Average order', 'متوسط الطلب')} value={d.totals.averageMinor == null ? t('No data', 'لا بيانات') : money(d.totals.averageMinor)} />
              <KpiCard label={t('Time to accept', 'زمن القبول')} value={d.medianAcceptMinutes == null ? t('No data', 'لا بيانات') : t(`${d.medianAcceptMinutes} min`, `${d.medianAcceptMinutes} د`)} hint={t('Median, from the order arriving to your acceptance', 'الوسيط من وصول الطلب إلى قبولك')} />
              <KpiCard label={t('Preparation time', 'زمن التحضير')} value={d.medianPrepMinutes == null ? t('No data', 'لا بيانات') : t(`${d.medianPrepMinutes} min`, `${d.medianPrepMinutes} د`)} hint={t('Median, from accepted to ready', 'الوسيط من القبول حتى الجاهزية')} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title={t('Orders per day', 'الطلبات يوميًا')}>
                {d.daily.length ? <BarChart label={t('Orders per day', 'الطلبات يوميًا')} points={d.daily.map((x) => ({ label: x.day.slice(5), value: x.orders }))} /> : <p className="text-sm text-gray-500">{t('No orders in this period.', 'لا طلبات في هذه الفترة.')}</p>}
              </Card>
              <Card title={t('Goods value per day', 'قيمة البضاعة يوميًا')}>
                {d.daily.length ? <BarChart label={t('Goods value per day', 'قيمة البضاعة يوميًا')} format={(n) => money(n)} points={d.daily.map((x) => ({ label: x.day.slice(5), value: x.goodsMinor }))} /> : <p className="text-sm text-gray-500">{t('No orders in this period.', 'لا طلبات في هذه الفترة.')}</p>}
              </Card>
              <Card title={t('Busy hours (Cairo time)', 'ساعات الذروة (بتوقيت القاهرة)')}>
                {d.byHour.length ? <BarChart label={t('Orders by hour', 'الطلبات حسب الساعة')} points={Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, value: d.byHour.find((x) => x.hour === h)?.orders ?? 0 }))} /> : <p className="text-sm text-gray-500">{t('No orders in this period.', 'لا طلبات في هذه الفترة.')}</p>}
              </Card>
              <Card title={t('Best sellers', 'الأكثر مبيعًا')}>
                {d.topProducts.length ? (
                  <ol className="space-y-2 text-sm">{d.topProducts.map((p, i) => <li key={p.name} className="flex justify-between gap-3"><span><span className="me-2 text-gray-400 tabular-nums">{i + 1}</span><bdi>{locale === 'ar' && p.nameAr ? p.nameAr : p.name}</bdi></span><b className="tabular-nums">{num(p.quantity)}</b></li>)}</ol>
                ) : <p className="text-sm text-gray-500">{t('No sales in this period.', 'لا مبيعات في هذه الفترة.')}</p>}
              </Card>
            </div>
            <Card title={t('Order parts by status', 'أجزاء الطلبات حسب الحالة')}>
              <div className="flex flex-wrap gap-2 text-sm">{Object.entries(d.byStatus).map(([s, n]) => <span key={s} className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1">{pick(SEGMENT_STATUS, s, t)}: <b>{num(n)}</b></span>)}</div>
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}
