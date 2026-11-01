'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Async, BarChart, Card, KpiCard, PageHeader, StatusPill, Tabs } from '../../../components/ui';
import { cairoDate } from '../../../components/ui';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { AutoDispatchCard } from '../../../components/ops/AutoDispatchCard';
import { usePermissions } from '../../../lib/ui/permissions';
import { NAV } from '../../../components/shell/nav';

const LABELS: Record<string, [string, string, string]> = {
  ordersPlaced: ['Orders placed', 'الطلبات المسجلة', 'Orders created in the period (any status).'],
  ordersDelivered: ['Orders delivered', 'الطلبات المسلّمة', 'Orders placed in the period that were delivered or collected.'],
  cancellationRate: ['Cancellation rate', 'نسبة الإلغاء', 'Cancelled ÷ placed (same cohort).'],
  gmvMinor: ['GMV (goods value)', 'قيمة البضائع', 'Σ item subtotals of non-cancelled vendor parts. NOT revenue.'],
  averageOrderValueMinor: ['Average order value', 'متوسط قيمة الطلب', 'GMV ÷ non-cancelled orders.'],
  deliveryFeesMinor: ['Delivery fees (delivered)', 'رسوم التوصيل (المسلّمة)', 'Delivery fees of delivered orders.'],
  hatlyRevenueMinor: ['Hatly revenue', 'إيراد حاتلي', 'Vendor + driver commission + service charge, minus net Hatly-funded discounts.'],
  hatlyFundedDiscountNetMinor: ['Hatly-funded discount (net)', 'صافي الخصم الممول من حاتلي', 'Recorded minus restored.'],
  activeVendors: ['Active vendors', 'الموردون النشطون', 'Branches with at least one part in the period.'],
  activeDrivers: ['Active drivers', 'السائقون النشطون', 'Drivers with at least one delivery in the period.'],
  medianDeliveryMinutes: ['Median delivery time (min)', 'وسيط زمن التوصيل (د)', 'From assignment to delivery.'],
  openDispatchAlerts: ['Open dispatch alerts', 'تنبيهات التوزيع المفتوحة', 'Right now.'],
  outstandingRefundsMinor: ['Refunds recorded, not sent', 'مستردات مسجلة لم تُرسل', 'Recorded refunds not yet marked sent (recorded ≠ sent).'],
};

const PRESETS = [
  { id: 'today', en: 'Today', ar: 'اليوم', days: 0 },
  { id: '7', en: 'Last 7 days', ar: 'آخر 7 أيام', days: 6 },
  { id: '30', en: 'Last 30 days', ar: 'آخر 30 يومًا', days: 29 },
];

/** Every admin lands here after sign-in. Without the reports permission there are no KPIs to show, so list the modules the admin can open instead. */
function ModuleLauncher() {
  const { t } = useLang();
  const perms = usePermissions();
  const isSuper = perms.role === 'SUPER_ADMIN';
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.href !== '/executive' && (i.superOnly ? isSuper : perms.can(...(i.perms ?? [])))) })).filter((g) => g.items.length > 0);
  return (
    <div>
      <PageHeader title={t('Executive overview', 'النظرة التنفيذية')} subtitle={t('Your account does not include the executive figures. These are the areas you can open.', 'حسابك لا يتضمن الأرقام التنفيذية. هذه هي الأقسام المتاحة لك.')} />
      {groups.length === 0 ? <p className="text-sm text-gray-500">{t('No modules are enabled for your account yet. Ask a super admin to grant access.', 'لا توجد أقسام مفعّلة لحسابك بعد. اطلب من المشرف الأعلى منح الصلاحيات.')}</p> : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.id} title={t(g.en, g.ar)}>
              <ul className="space-y-1 text-sm">{g.items.map((i) => <li key={i.href}><Link className="text-hatly-orangeDark hover:underline" href={i.href}>{t(i.en, i.ar)}</Link></li>)}</ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutivePage() {
  const perms = usePermissions();
  if (!perms.loaded) return <div aria-busy="true" className="h-24 animate-pulse rounded-xl bg-gray-100" />;
  if (!perms.can('VIEW_REPORTS')) return <ModuleLauncher />;
  return <ExecutiveDashboard />;
}

function ExecutiveDashboard() {
  const { t, money, num } = useLang();
  const [preset, setPreset] = useState('7');
  const days = PRESETS.find((p) => p.id === preset)!.days;
  const from = cairoDate(-days);
  const to = cairoDate(0);
  const kpis = useApi<any>('/admin/executive/kpis', { from, to });
  const series = useApi<any>('/admin/executive/timeseries', { metric: 'orders', granularity: 'day', from: cairoDate(-Math.max(days, 13)), to });
  const alerts = useApi<any[]>('/admin/alerts');
  const sla = useApi<any>('/admin/sla/summary', { from, to });

  const fmt = (k: any) => {
    if (k.value === null) return t('No data', 'لا توجد بيانات');
    if (k.unit === 'minor') return money(k.value);
    if (k.unit === 'percent') return `${k.value}%`;
    return num(k.value);
  };
  const tone = (k: any): 'good' | 'bad' | 'neutral' => {
    if (k.deltaPct === null) return 'neutral';
    const lowerIsBetter = k.key === 'cancellationRate' || k.key === 'medianDeliveryMinutes';
    return (k.deltaPct > 0) === lowerIsBetter ? 'bad' : 'good';
  };

  return (
    <div>
      <PageHeader title={t('Executive overview', 'النظرة التنفيذية')} subtitle={t('Real figures from the ledgers, for the Africa/Cairo calendar period. Every tile has its definition on hover.', 'أرقام حقيقية من السجلات لفترة بتوقيت القاهرة. لكل مؤشر تعريفه عند التمرير.')} />
      <Tabs tabs={PRESETS.map((p) => ({ id: p.id, label: t(p.en, p.ar) }))} value={preset} onChange={setPreset} />
      <Async state={kpis} rows={3}>
        {kpis.data && (
          <>
            <p className="mb-3 text-xs text-gray-500">{t(`Period ${kpis.data.from} → ${kpis.data.to}; compared with ${kpis.data.previousFrom} → ${kpis.data.previousTo}. As of`, `الفترة ${kpis.data.from} ← ${kpis.data.to}؛ مقارنة بـ ${kpis.data.previousFrom} ← ${kpis.data.previousTo}. حتى`)} {new Date(kpis.data.asOf).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo' })}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {kpis.data.kpis.map((k: any) => {
                const [en, ar, hint] = LABELS[k.key] ?? [k.key, k.key, ''];
                return <KpiCard key={k.key} label={t(en, ar)} hint={hint} value={fmt(k)} delta={k.deltaPct} tone={tone(k)} />;
              })}
            </div>
            {!kpis.data.kpis.some((k: any) => k.financial) && <p className="mt-2 text-xs text-gray-500">{t('Money figures need the “View financials” permission.', 'الأرقام المالية تحتاج صلاحية «عرض البيانات المالية».')}</p>}
          </>
        )}
      </Async>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card title={t('Orders per day', 'الطلبات يوميًا')} className="xl:col-span-2">
          <Async state={series} empty={series.data && series.data.points.length === 0} emptyTitle={t('No orders in this period', 'لا توجد طلبات في هذه الفترة')} rows={3}>
            {series.data && <BarChart label={t('Orders per day', 'الطلبات يوميًا')} points={series.data.points.map((p: any) => ({ label: p.bucketStart, value: p.value }))} />}
          </Async>
        </Card>
        <div className="space-y-4">
          <AutoDispatchCard />
          <Card title={t('Delivery service levels', 'مستويات خدمة التوصيل')}>
            <Async state={sla} rows={2}>
              {sla.data && (sla.data.deliveries === 0 ? <p className="text-sm text-gray-500">{t('No completed deliveries in this period.', 'لا توجد توصيلات مكتملة في هذه الفترة.')}</p> : (
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-gray-500">{t('Deliveries', 'التوصيلات')}</dt><dd className="text-end tabular-nums">{num(sla.data.deliveries)}</dd>
                  <dt className="text-gray-500">{t('Assign → pickup (P50 / P90 min)', 'من التعيين للاستلام (د)')}</dt><dd className="text-end tabular-nums">{sla.data.assignToPickupMinutes.p50 ?? '—'} / {sla.data.assignToPickupMinutes.p90 ?? '—'}</dd>
                  <dt className="text-gray-500">{t('Pickup → delivered (P50 / P90 min)', 'من الاستلام للتسليم (د)')}</dt><dd className="text-end tabular-nums">{sla.data.pickupToDeliveredMinutes.p50 ?? '—'} / {sla.data.pickupToDeliveredMinutes.p90 ?? '—'}</dd>
                  <dt className="text-gray-500">{t('Avg. reassignments', 'متوسط إعادة التعيين')}</dt><dd className="text-end tabular-nums">{sla.data.averageReassignments ?? '—'}</dd>
                </dl>
              ))}
            </Async>
          </Card>
        </div>
      </div>

      <Card title={t('Needs attention', 'يحتاج إلى انتباه')} className="mt-4" actions={<Link href="/alerts" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('All alerts', 'كل التنبيهات')}</Link>}>
        <Async state={alerts} empty={alerts.data && alerts.data.length === 0} emptyTitle={t('Nothing needs attention right now', 'لا شيء يحتاج إلى انتباه الآن')} rows={3}>
          <ul className="divide-y divide-gray-100">
            {(alerts.data ?? []).slice(0, 6).map((a: any) => (
              <li key={a.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="flex items-center gap-2"><StatusPill status={a.severity === 'critical' ? 'DOWN' : a.severity === 'warning' ? 'DEGRADED' : 'OK'} label={a.severity} /><span>{a.reason.replace(/_/g, ' ')}</span><span className="text-gray-500"><bdi>{a.detail}</bdi></span></span>
                {a.entityType === 'order' && a.entityId && <Link className="text-xs text-hatly-orangeDark hover:underline" href={`/order-search/${a.entityId}`}>{t('Open', 'فتح')}</Link>}
              </li>
            ))}
          </ul>
        </Async>
      </Card>
    </div>
  );
}
