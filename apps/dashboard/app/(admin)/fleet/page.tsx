'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Async, Badge, Button, Card, DataTable, DateRange, FilterBar, KpiCard, LabeledInput, LabeledSelect, Modal, PageHeader, Pagination, StatusPill, Tabs, cairoDate, useDebounced, usePaging } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { AutoDispatchCard } from '../../../components/ops/AutoDispatchCard';

export default function FleetPage() {
  const { t } = useLang();
  const [tab, setTab] = useState('live');
  return (
    <div>
      <PageHeader title={t('Delivery & fleet', 'التوصيل والأسطول')} subtitle={t('Drivers are assigned by the platform or manually by an admin. Drivers do not accept or reject offers.', 'يُعيَّن السائقون تلقائيًا أو يدويًا بواسطة مسؤول. لا يقبل السائقون العروض ولا يرفضونها.')} />
      <Tabs tabs={[{ id: 'live', label: t('Live', 'مباشر') }, { id: 'drivers', label: t('Drivers', 'السائقون') }, { id: 'perf', label: t('Performance', 'الأداء') }]} value={tab} onChange={setTab} />
      {tab === 'live' && <Live />}
      {tab === 'drivers' && <Drivers />}
      {tab === 'perf' && <Perf />}
    </div>
  );
}

function Live() {
  const { t, num, dateTime } = useLang();
  const live = useApi<any[]>('/admin/fleet/live', undefined, { refreshInterval: 30000 });
  const rows = live.data ?? [];
  const busy = rows.filter((r) => r.activeOrder).length;
  const stale = rows.filter((r) => r.stale).length;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <div className="grid grid-cols-3 gap-3">
          <KpiCard label={t('Online', 'متصل')} value={num(rows.length)} />
          <KpiCard label={t('On a delivery', 'في توصيل')} value={num(busy)} />
          <KpiCard label={t('Stale location', 'موقع قديم')} value={num(stale)} tone={stale ? 'bad' : 'neutral'} hint={t('No location update for over 2 minutes.', 'لا تحديث للموقع منذ أكثر من دقيقتين.')} />
        </div>
        <Card title={t('Online drivers', 'السائقون المتصلون')} pad={false}>
          <DataTable rows={live.data} rowKey={(r: any) => r.id} loading={live.loading} error={live.error} status={live.status} onRetry={live.reload} emptyTitle={t('No drivers online', 'لا يوجد سائقون متصلون')} columns={[
            { key: 'n', header: t('Driver', 'السائق'), cell: (r: any) => <bdi className="font-medium">{r.name}</bdi> },
            { key: 's', header: t('Status', 'الحالة'), cell: (r: any) => (r.activeOrder ? <Badge tone="amber">{t('On delivery', 'في توصيل')}</Badge> : r.available ? <Badge tone="green">{t('Available', 'متاح')}</Badge> : <Badge>{t('Unavailable', 'غير متاح')}</Badge>) },
            { key: 'o', header: t('Active order', 'الطلب الحالي'), cell: (r: any) => (r.activeOrder ? <Link className="text-hatly-orangeDark hover:underline" href={`/order-management?q=${encodeURIComponent(r.activeOrder)}`}>{r.activeOrder}</Link> : '—') },
            { key: 'l', header: t('Last seen', 'آخر ظهور'), cell: (r: any) => (r.lastSeenAt ? <span className={r.stale ? 'text-red-700' : ''}>{dateTime(r.lastSeenAt)}</span> : '—') },
          ]} />
          <p className="px-4 py-2 text-xs text-gray-500">{t('Refreshes every 30 seconds. Driver locations are for operations only and never affect pricing.', 'يتحدث كل 30 ثانية. مواقع السائقين للتشغيل فقط ولا تؤثر في التسعير.')}</p>
        </Card>
      </div>
      <AutoDispatchCard />
    </div>
  );
}

function Drivers() {
  const { t, num, money, dateTime } = useLang();
  const { can } = usePermissions();
  const [q, setQ] = useState('');
  const [verified, setVerified] = useState('');
  const [online, setOnline] = useState('');
  const search = useDebounced(q);
  const { page, setPage, limit } = usePaging(JSON.stringify([search, verified, online]));
  const list = useApi<any[]>('/admin/driver-directory', { q: search || undefined, verified: verified || undefined, online: online || undefined, page, limit });
  const [sel, setSel] = useState<string | null>(null);
  const detail = useApi<any>(sel ? `/admin/driver-directory/${sel}` : null);
  return (
    <>
      <FilterBar onClear={() => { setQ(''); setVerified(''); setOnline(''); }}>
        <div className="w-56"><LabeledInput label={t('Name or phone', 'الاسم أو الهاتف')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="w-40"><LabeledSelect label={t('Verification', 'التحقق')} value={verified} onChange={(e) => setVerified(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="APPROVED">{t('Approved', 'معتمد')}</option><option value="PENDING">{t('Pending', 'معلّق')}</option><option value="REJECTED">{t('Rejected', 'مرفوض')}</option></LabeledSelect></div>
        <div className="w-40"><LabeledSelect label={t('Online', 'متصل')} value={online} onChange={(e) => setOnline(e.target.value)}><option value="">{t('All', 'الكل')}</option><option value="true">{t('Online', 'متصل')}</option><option value="false">{t('Offline', 'غير متصل')}</option></LabeledSelect></div>
      </FilterBar>
      <Card pad={false}>
        <DataTable rows={list.data} rowKey={(r: any) => r.id} loading={list.loading} error={list.error} status={list.status} onRetry={list.reload} emptyTitle={t('No drivers match', 'لا يوجد سائقون مطابقون')} columns={[
          { key: 'n', header: t('Driver', 'السائق'), cell: (r: any) => <span><bdi className="font-medium">{r.name}</bdi><span className="block text-xs text-gray-500" dir="ltr">{r.phone}</span></span> },
          { key: 'v', header: t('Verification', 'التحقق'), cell: (r: any) => <StatusPill status={r.verification} /> },
          { key: 'o', header: t('State', 'الحالة'), cell: (r: any) => (r.online ? <Badge tone="green">{t('Online', 'متصل')}</Badge> : <Badge>{t('Offline', 'غير متصل')}</Badge>) },
          { key: 've', header: t('Vehicle', 'المركبة'), cell: (r: any) => r.vehicle ?? '—' },
          { key: 'd', header: t('Delivered', 'المسلّمة'), align: 'end', cell: (r: any) => num(r.delivered) },
          { key: 'ac', header: t('Active', 'النشطة'), align: 'end', cell: (r: any) => num(r.activeDeliveries) },
          { key: 'rt', header: t('Rating', 'التقييم'), align: 'end', cell: (r: any) => (r.rating === null ? '—' : `${r.rating} ★`) },
          { key: 'a', header: '', align: 'end', cell: (r: any) => <Button size="sm" onClick={() => setSel(r.id)}>{t('Details', 'التفاصيل')}</Button> },
        ]} />
        {list.meta && <Pagination page={page} limit={limit} total={list.meta.total} onPage={setPage} />}
      </Card>
      <p className="mt-2 text-xs text-gray-500">{t('Verification, vehicle and commission are edited on the Drivers page.', 'يُعدَّل التحقق والمركبة والعمولة من صفحة السائقين.')} <Link className="text-hatly-orangeDark hover:underline" href="/drivers">{t('Open Drivers', 'فتح السائقين')}</Link></p>
      <Modal open={Boolean(sel)} wide title={detail.data ? detail.data.name : t('Driver', 'السائق')} onClose={() => setSel(null)}>
        <Async state={detail} rows={3}>
          {detail.data && (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-gray-500">{t('Delivered', 'المسلّمة')}</dt><dd className="text-end tabular-nums">{num(detail.data.delivered)}</dd>
                <dt className="text-gray-500">{t('Median delivery (min)', 'وسيط التوصيل (د)')}</dt><dd className="text-end tabular-nums">{detail.data.medianDeliveryMinutes ?? '—'}</dd>
                <dt className="text-gray-500">{t('Rating', 'التقييم')}</dt><dd className="text-end">{detail.data.rating === null ? '—' : `${detail.data.rating} ★ (${num(detail.data.ratingCount)})`}</dd>
                <dt className="text-gray-500">{t('Commission', 'العمولة')}</dt><dd className="text-end">{detail.data.commissionPercent === null ? t('Default', 'الافتراضي') : `${detail.data.commissionPercent}%`}</dd>
              </dl>
              <div>
                <h4 className="mb-1 font-semibold">{t('Recent deliveries', 'آخر التوصيلات')}</h4>
                <ul>{detail.data.recentDeliveries.map((d: any) => <li key={d.id} className="flex justify-between border-t border-gray-100 py-1 text-xs"><Link className="text-hatly-orangeDark hover:underline" href={`/order-management?q=${encodeURIComponent(d.orderNumber)}`}>{d.orderNumber}</Link><span>{d.deliveredAt ? dateTime(d.deliveredAt) : t('In progress', 'قيد التنفيذ')}{d.reassignments > 0 ? ` · ${t('reassigned', 'أُعيد تعيينه')} ${d.reassignments}` : ''}</span></li>)}</ul>
                {detail.data.recentDeliveries.length === 0 && <p className="text-xs text-gray-500">{t('No deliveries yet.', 'لا توجد توصيلات بعد.')}</p>}
              </div>
              {detail.data.settlementPeriods && (
                <div>
                  <h4 className="mb-1 font-semibold">{t('Closed settlement periods', 'فترات التسوية المغلقة')}</h4>
                  <ul>{detail.data.settlementPeriods.map((p: any) => <li key={p.id} className="flex justify-between border-t border-gray-100 py-1 text-xs"><Link className="text-hatly-orangeDark hover:underline" href={`/settlements/driver/${p.id}`}>{p.periodStart} → {p.periodEnd}</Link><span className="tabular-nums">{money(p.netPayableMinor)}</span></li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Async>
      </Modal>
    </>
  );
}

function Perf() {
  const { t, num } = useLang();
  const [from, setFrom] = useState(cairoDate(-6));
  const [to, setTo] = useState(cairoDate(0));
  const sla = useApi<any>('/admin/delivery-performance', { from, to });
  return (
    <div className="space-y-3">
      <FilterBar><DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /></FilterBar>
      <Async state={sla} rows={2}>
        {sla.data && (sla.data.deliveries === 0 ? <Card><p className="text-sm text-gray-500">{t('No completed deliveries in this period.', 'لا توجد توصيلات مكتملة في هذه الفترة.')}</p></Card> : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={t('Deliveries', 'التوصيلات')} value={num(sla.data.deliveries)} />
            <KpiCard label={t('Assign → pickup, P50 (min)', 'التعيين ← الاستلام P50 (د)')} value={sla.data.assignToPickupMinutes.p50 ?? '—'} hint={`P90: ${sla.data.assignToPickupMinutes.p90 ?? '—'}`} />
            <KpiCard label={t('Pickup → delivered, P50 (min)', 'الاستلام ← التسليم P50 (د)')} value={sla.data.pickupToDeliveredMinutes.p50 ?? '—'} hint={`P90: ${sla.data.pickupToDeliveredMinutes.p90 ?? '—'}`} />
            <KpiCard label={t('Avg. reassignments', 'متوسط إعادة التعيين')} value={sla.data.averageReassignments ?? '—'} />
          </div>
        ))}
      </Async>
    </div>
  );
}
