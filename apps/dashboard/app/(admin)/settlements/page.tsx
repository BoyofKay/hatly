'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, DataTable, DateRange, FilterBar, LabeledSelect, PageHeader, Pagination, StatusPill, Tabs, usePaging } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { ExportButton } from '../../../components/reports/ExportButton';

export default function SettlementPeriodsPage() {
  const { t, money, date } = useLang();
  const { can } = usePermissions();
  const canVendor = can('VIEW_VENDOR_FINANCIAL_REPORTS');
  const canDriver = can('VIEW_DRIVER_SETTLEMENTS');
  const [tab, setTab] = useState<'vendor' | 'driver'>(canVendor ? 'vendor' : 'driver');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { page, setPage, limit } = usePaging(JSON.stringify([tab, status, from, to]));
  const list = useApi<any[]>(`/admin/settlements/${tab}-periods`, { paymentStatus: status || undefined, from: from || undefined, to: to || undefined, page, limit });
  const summary = useApi<any>('/admin/settlements/summary');
  const tabs = [...(canVendor ? [{ id: 'vendor', label: t('Vendors (commission receivable)', 'الموردون (عمولات مستحقة)') }] : []), ...(canDriver ? [{ id: 'driver', label: t('Drivers', 'السائقون') }] : [])];
  return (
    <div>
      <PageHeader
        title={t('Settlement periods', 'فترات التسوية')}
        subtitle={t('Closed is not paid. A closed period is frozen; money movement is recorded against it as payments. Vendors owe Hatly their commission (collection); a driver period is paid out or collected according to its net.', 'المغلقة ليست مدفوعة. الفترة المغلقة مجمّدة وتُسجَّل الحركات المالية عليها كمدفوعات. الموردون يدينون لحاتلي بعمولتهم (تحصيل)، وتُدفع فترة السائق أو تُحصَّل حسب صافيها.')}
        actions={<>{canVendor && can('FINANCE_EXPORT') && <ExportButton report="S15" params={{ from, to }} label={t('Export vendor periods', 'تصدير فترات الموردين')} />}{canDriver && can('FINANCE_EXPORT') && <ExportButton report="S11" params={{ from, to }} label={t('Export driver periods', 'تصدير فترات السائقين')} />}<Link href="/settlement" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Close a period →', 'إغلاق فترة ←')}</Link></>}
      />
      {summary.data && <div className="mb-4 grid gap-3 sm:grid-cols-3">{[['Vendor commission receivable', 'عمولات الموردين المستحقة', summary.data.vendorCommissionReceivableMinor], ['Driver payable', 'مستحقات السائقين', summary.data.driverPayableMinor], ['Driver receivable', 'مستحقات على السائقين', summary.data.driverReceivableMinor]].map(([en, ar, v]) => <div key={en as string} className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{t(en as string, ar as string)}</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(v as number)}</p></div>)}</div>}
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(x) => setTab(x as 'vendor' | 'driver')} />}
      <FilterBar onClear={() => { setStatus(''); setFrom(''); setTo(''); }}>
        <div className="w-48"><LabeledSelect label={t('Payment status', 'حالة السداد')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('All', 'الكل')}</option>{['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', 'NOTHING_DUE'].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</LabeledSelect></div>
        <DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No closed periods yet', 'لا توجد فترات مغلقة بعد')} columns={[
          { key: 'p', header: tab === 'vendor' ? t('Vendor / branch', 'المورد / الفرع') : t('Driver', 'السائق'), cell: (r) => <Link className="font-medium text-hatly-orangeDark hover:underline" href={`/settlements/${tab}/${r.id}`}><bdi>{tab === 'vendor' ? `${r.vendorName} — ${r.partyName}` : r.partyName}</bdi></Link> },
          { key: 'per', header: t('Period', 'الفترة'), cell: (r) => `${date(r.periodStart)} → ${date(r.periodEnd)}` },
          { key: 'dir', header: t('Direction', 'الاتجاه'), cell: (r) => <StatusPill status={r.direction === 'COLLECTION' ? 'PENDING' : 'APPROVED'} label={r.direction === 'COLLECTION' ? t('Collect', 'تحصيل') : t('Pay out', 'دفع')} /> },
          { key: 'due', header: t('Due', 'المستحق'), align: 'end', cell: (r) => money(r.dueMinor) },
          { key: 'set', header: t('Settled', 'المسدد'), align: 'end', cell: (r) => money(r.settledMinor) },
          { key: 'rem', header: t('Remaining', 'المتبقي'), align: 'end', cell: (r) => money(r.remainingMinor) },
          { key: 'st', header: t('Status', 'الحالة'), cell: (r) => <StatusPill status={r.paymentStatus} /> },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
    </div>
  );
}
