'use client';

import { useState } from 'react';
import { Async, BarChart, Card, DataTable, DateRange, FilterBar, LabeledSelect, PageHeader, cairoDate } from '../../../../components/ui';
import { useApi } from '../../../../lib/ui/api';
import { useLang } from '../../../../lib/ui/lang';
import { usePermissions } from '../../../../lib/ui/permissions';
import { ExportButton } from '../../../../components/reports/ExportButton';

export default function RevenuePage() {
  const { t, money } = useLang();
  const { can } = usePermissions();
  const [from, setFrom] = useState(cairoDate(-29));
  const [to, setTo] = useState(cairoDate(0));
  const [g, setG] = useState('day');
  const rev = useApi<any>('/admin/finance/revenue', { from, to, granularity: g });
  const d = rev.data;
  return (
    <div>
      <PageHeader title={t('Revenue & commissions', 'الإيرادات والعمولات')} subtitle={d?.definition} actions={can('FINANCE_EXPORT') ? <ExportButton report="S10" params={{ from, to, granularity: g }} /> : undefined} />
      <FilterBar>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
        <div className="w-40"><LabeledSelect label={t('Group by', 'تجميع حسب')} value={g} onChange={(e) => setG(e.target.value)}><option value="day">{t('Day', 'يوم')}</option><option value="week">{t('Week', 'أسبوع')}</option><option value="month">{t('Month', 'شهر')}</option></LabeledSelect></div>
      </FilterBar>
      <Async state={rev} empty={d && d.buckets.length === 0} emptyTitle={t('No financial events in this range', 'لا توجد أحداث مالية في هذه الفترة')}>
        {d && (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[['Vendor commission', 'عمولة الموردين', d.totals.vendorCommissionMinor], ['Driver commission', 'عمولة السائقين', d.totals.driverCommissionMinor], ['Service charge', 'رسوم الخدمة', d.totals.serviceChargeMinor], ['Hatly-funded discount (net)', 'صافي الخصم الممول', d.totals.discountNetMinor], ['Hatly revenue', 'إيراد حاتلي', d.totals.hatlyRevenueMinor]].map(([en, ar, v]) => (
                <div key={en as string} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-xs text-gray-500">{t(en as string, ar as string)}</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(v as number)}</p></div>
              ))}
            </div>
            <Card title={t('Hatly revenue per period', 'إيراد حاتلي لكل فترة')} className="mb-4"><BarChart label={t('Hatly revenue', 'إيراد حاتلي')} points={d.buckets.map((b: any) => ({ label: b.bucket, value: Math.max(0, b.hatlyRevenueMinor) }))} format={(n) => money(n)} /></Card>
            <Card pad={false}>
              <DataTable rows={d.buckets} rowKey={(b: any) => b.bucket} columns={[
                { key: 'b', header: t('Period', 'الفترة'), cell: (b: any) => b.bucket },
                { key: 'v', header: t('Vendor commission', 'عمولة الموردين'), align: 'end', cell: (b: any) => money(b.vendorCommissionMinor) },
                { key: 'd', header: t('Driver commission', 'عمولة السائقين'), align: 'end', cell: (b: any) => money(b.driverCommissionMinor) },
                { key: 's', header: t('Service charge', 'رسوم الخدمة'), align: 'end', cell: (b: any) => money(b.serviceChargeMinor) },
                { key: 'n', header: t('Discount (net)', 'الخصم (صافي)'), align: 'end', cell: (b: any) => money(b.discountNetMinor) },
                { key: 'r', header: t('Revenue', 'الإيراد'), align: 'end', cell: (b: any) => <strong>{money(b.hatlyRevenueMinor)}</strong> },
              ]} />
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}
