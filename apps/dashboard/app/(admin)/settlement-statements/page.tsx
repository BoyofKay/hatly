'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, Card, DataTable, DateRange, ErrorState, LabeledSelect, PageHeader, StatusPill, Tabs, cairoDate } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { ExportButton } from '../../../components/reports/ExportButton';
import { CourierBreakdown, CourierNet, useCourierLineColumns } from '../../../components/settlement/CourierMoney';

/**
 * Statements by period — every closing of one courier (or store branch) made in the chosen dates, with its orders, what was settled and
 * what remains, plus what is still open from closings made before the range. No opening ledger balance is shown: no approved opening-
 * balance rule exists (the "before the range" figure is only what earlier closings still have to settle). Exports (S26 / S27) run the same
 * definition as the screen.
 */
export default function SettlementStatementsPage() {
  const { t } = useLang();
  const { can } = usePermissions();
  const canCourier = can('VIEW_DRIVER_SETTLEMENTS');
  const canVendor = can('VIEW_VENDOR_FINANCIAL_REPORTS');
  // permissions arrive after the first render: the default tab follows them until the user picks one
  const [picked, setTab] = useState<'courier' | 'vendor' | null>(null);
  const tab = picked ?? (canCourier ? 'courier' : 'vendor');
  const [from, setFrom] = useState(cairoDate(-30));
  const [to, setTo] = useState(cairoDate(0));
  const tabs = [...(canCourier ? [{ id: 'courier', label: t('Courier statements', 'كشوف المندوبين') }] : []), ...(canVendor ? [{ id: 'vendor', label: t('Store statements', 'كشوف المتاجر') }] : [])];
  return (
    <div className="max-w-6xl">
      <PageHeader title={t('Statements by period', 'الكشوف حسب الفترة')} subtitle={t('Closings made in the chosen dates (Cairo), what was settled and what remains.', 'التقفيلات التي تمت في التواريخ المختارة (القاهرة)، وما سُوّي وما تبقى.')} actions={<Link href="/settlement" className="text-sm font-medium text-hatly-orangeDark hover:underline">{t('Closing →', 'التقفيل ←')}</Link>} />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={(x) => setTab(x as 'courier' | 'vendor')} />}
      <div className="mb-4"><DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /></div>
      {tab === 'courier' ? <CourierStatement from={from} to={to} /> : <VendorStatement from={from} to={to} />}
    </div>
  );
}

function PeriodsTable({ rows, party }: { rows: any[]; party: 'driver' | 'vendor' }) {
  const { t, money, dateTime } = useLang();
  return (
    <DataTable rows={rows} rowKey={(r: any) => r.id} emptyTitle={t('No closings in these dates', 'لا توجد تقفيلات في هذه التواريخ')} emptyHint=" " columns={[
      { key: 'ref', header: t('Reference', 'المرجع'), cell: (r: any) => <Link className="font-mono text-hatly-orangeDark hover:underline" href={`/settlements/${party}/${r.id}`}><bdi>{r.reference}</bdi></Link> },
      { key: 'per', header: t('Period', 'الفترة'), cell: (r: any) => <span className="text-xs">{dateTime(r.periodStart)} → {dateTime(r.periodEnd)}</span> },
      { key: 'by', header: t('Closed by', 'أقفلها'), cell: (r: any) => <bdi>{r.closedBy ?? '—'}</bdi> },
      { key: 'n', header: t('Orders', 'الطلبات'), align: 'end', cell: (r: any) => (r.methodVersion === 2 ? r.orders : <Badge>{t('earlier method', 'طريقة سابقة')}</Badge>) },
      ...(party === 'driver'
        ? [{ key: 'net', header: t('Net', 'الصافي'), align: 'end' as const, cell: (r: any) => <CourierNet minor={r.netToCourierMinor} /> }]
        : [{ key: 'com', header: t('Owed by the store', 'مستحق على المتجر'), align: 'end' as const, cell: (r: any) => money(r.commissionOwedByVendorMinor) }]),
      { key: 'set', header: t('Settled', 'تم تسويته'), align: 'end', cell: (r: any) => money(r.settledMinor) },
      { key: 'rem', header: t('Remaining', 'المتبقي للتسوية'), align: 'end', cell: (r: any) => money(r.remainingMinor) },
      { key: 'st', header: t('Status', 'الحالة'), cell: (r: any) => <StatusPill status={r.paymentStatus} /> },
    ]} />
  );
}

function CourierStatement({ from, to }: { from: string; to: string }) {
  const { t, money } = useLang();
  const { can } = usePermissions();
  const drivers = useApi<any[]>('/admin/control-tower/drivers');
  const [id, setId] = useState('');
  const st = useApi<any>(id ? `/admin/settlement/drivers/${id}/statement` : null, { from: from || undefined, to: to || undefined });
  const columns = useCourierLineColumns();
  const d = st.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72"><LabeledSelect label={t('Courier', 'المندوب')} value={id} onChange={(e) => setId(e.target.value)} data-testid="statement-courier"><option value="">{t('Choose…', 'اختر…')}</option>{(drivers.data ?? []).map((x: any) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</LabeledSelect></div>
        {id && can('FINANCE_EXPORT') && <ExportButton report="S26" params={{ from, to, driverId: id }} label={t('Export (CSV / Excel / PDF)', 'تصدير (CSV / Excel / PDF)')} />}
      </div>
      {st.error && <ErrorState message={st.error} onRetry={st.reload} />}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-4" data-testid="courier-statement-totals">
            <Kpi label={t('Closings', 'التقفيلات')} value={String(d.totals.closings)} />
            <Kpi label={t('Delivered orders', 'الطلبات المُسلّمة')} value={String(d.totals.orders)} />
            <Kpi label={t('Remaining in this range', 'المتبقي للتسوية في المدة')} value={<CourierNet minor={d.totals.signedRemainingMinor} testId="courier-statement-remaining" />} />
            <Kpi label={t('Still open from earlier closings', 'متبقٍ من تقفيلات سابقة')} value={<CourierNet minor={d.totals.signedRemainingBeforeRangeMinor} />} />
          </div>
          {d.totals.legacyClosings > 0 && <p className="text-xs text-gray-500">{t(`${d.totals.legacyClosings} closing(s) were made with the earlier method: shown as recorded; their parts are not itemised.`, `${d.totals.legacyClosings} تقفيل بطريقة سابقة: معروض كما سُجّل دون تفصيل الأجزاء.`)}</p>}
          <Card title={t('Totals of the closings in this range', 'إجمالي تقفيلات المدة')}><CourierBreakdown totals={d.totals} testId="courier-statement-breakdown" /><p className="mt-2 text-sm">{t('Settled', 'تم تسويته')}: <strong>{money(d.totals.settledMinor)}</strong></p></Card>
          <Card title={t('Closings', 'التقفيلات')} pad={false}><PeriodsTable rows={d.periods} party="driver" /></Card>
          <Card title={t('Orders', 'الطلبات')} pad={false}><DataTable rows={d.lines} rowKey={(x: any) => x.orderId} columns={columns} emptyTitle={t('No orders', 'لا توجد طلبات')} emptyHint=" " /></Card>
        </>
      )}
    </div>
  );
}

function VendorStatement({ from, to }: { from: string; to: string }) {
  const { t, money, dateTime } = useLang();
  const { can } = usePermissions();
  const branches = useApi<any[]>('/admin/settlement/vendor-branches/open');
  const [id, setId] = useState('');
  const st = useApi<any>(id ? `/admin/settlement/vendor-branches/${id}/statement` : null, { from: from || undefined, to: to || undefined });
  const d = st.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80"><LabeledSelect label={t('Store branch', 'فرع المتجر')} value={id} onChange={(e) => setId(e.target.value)} data-testid="statement-branch"><option value="">{t('Choose…', 'اختر…')}</option>{(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.vendorName} — {b.branchName}</option>)}</LabeledSelect></div>
        {id && can('FINANCE_EXPORT') && <ExportButton report="S27" params={{ from, to, vendorBranchId: id }} label={t('Export (CSV / Excel / PDF)', 'تصدير (CSV / Excel / PDF)')} />}
      </div>
      {st.error && <ErrorState message={st.error} onRetry={st.reload} />}
      {d && (
        <>
          <div className="grid gap-3 sm:grid-cols-5" data-testid="vendor-statement-totals">
            <Kpi label={t('Closings', 'التقفيلات')} value={String(d.totals.closings)} />
            <Kpi label={t('Gross sales', 'إجمالي المبيعات')} value={money(d.totals.grossSalesMinor)} />
            <Kpi label={t('Owed by the store (commission)', 'مستحق على المتجر (العمولة)')} value={money(d.totals.commissionOwedByVendorMinor)} />
            <Kpi label={t('Remaining', 'المتبقي للتسوية')} value={money(d.totals.remainingMinor)} />
            <Kpi label={t('Owed to the store (collected by Hatly)', 'مستحق للمتجر (حصّلته Hatly)')} value={money(d.totals.collectedByHatlyForVendorMinor)} />
          </div>
          <p className="text-xs text-gray-500">{d.accountingNote} {t('Still open from earlier closings', 'متبقٍ من تقفيلات سابقة')}: {money(d.totals.remainingBeforeRangeMinor)}</p>
          <Card title={t('Closings', 'التقفيلات')} pad={false}><PeriodsTable rows={d.periods} party="vendor" /></Card>
          <Card title={t('Store parts', 'أجزاء المتجر')} pad={false}>
            <DataTable rows={d.lines} rowKey={(x: any) => x.segmentId} emptyTitle={t('No parts', 'لا توجد أجزاء')} emptyHint=" " columns={[
              { key: 'o', header: t('Order', 'الطلب'), cell: (x: any) => <Link className="text-hatly-orangeDark hover:underline" href={`/order-search/${x.orderId}`}><bdi>{x.orderNumber}</bdi></Link> },
              { key: 'at', header: t('Handed over', 'التسليم من المتجر'), cell: (x: any) => dateTime(x.handedOverAt) },
              { key: 's', header: t('Sales', 'المبيعات'), align: 'end', cell: (x: any) => money(x.segmentSubtotalMinor) },
              { key: 'c', header: t('Commission', 'العمولة'), align: 'end', cell: (x: any) => (x.rateUndefined ? <Badge tone="red">{t('Rate not set', 'نسبة غير محددة')}</Badge> : money(x.commissionMinor)) },
            ]} />
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>;
}
