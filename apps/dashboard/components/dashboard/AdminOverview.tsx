'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, Card, KpiCard, PageHeader, StatusPill, Tabs, cairoDate } from '../ui';
import { AreaChart, DonutChart, fillDays } from '../ui/charts';
import { ICONS, IconName } from '../ui/icons';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { getCurrentUser } from '../../lib/auth/session';
import { ago } from '../../lib/ui/time';
import { ORDER_STATUS, label } from '../../lib/admin/labels';
import { ActionCenter } from './ActionCenter';
import { PushSetupPrompt } from '../alerts/PushSetupPrompt';

/**
 * The Admin Home, laid out as the approved reference (`docs/transformation/reference/admin-vendor-reference.jpg`): a welcome line, four KPI cards
 * with the change against the previous period, orders per day, the period's orders by status and the newest orders. Every number is the
 * platform's own — period figures and the status counts from `admin/executive/kpis`, the daily series from `admin/executive/timeseries`, the
 * orders from `admin/orders`. Sections the admin's role cannot read (the executive figures need "View reports") are left out, never shown empty.
 */
const PRESETS = [
  { id: 'today', en: 'Today', ar: 'اليوم', days: 0 },
  { id: '7', en: 'Last 7 days', ar: 'آخر 7 أيام', days: 6 },
  { id: '30', en: 'Last 30 days', ar: 'آخر 30 يومًا', days: 29 },
];
// Reference order: total orders, active stores, total sales, customers. Sales need "View financials"; without it the next figure takes the place.
const KPI_ORDER: Array<{ key: string; en: string; ar: string; icon: IconName }> = [
  { key: 'ordersPlaced', en: 'Total orders', ar: 'إجمالي الطلبات', icon: 'cart' },
  { key: 'activeVendors', en: 'Active stores', ar: 'المتاجر النشطة', icon: 'store' },
  { key: 'gmvMinor', en: 'Total sales', ar: 'إجمالي المبيعات', icon: 'receipt' },
  { key: 'newCustomers', en: 'New customers', ar: 'العملاء الجدد', icon: 'users' },
  { key: 'ordersDelivered', en: 'Orders delivered', ar: 'الطلبات المسلّمة', icon: 'check' },
];
// The reference's four order states, each a fixed set of real statuses (nothing is estimated): completed, being prepared, out for delivery, cancelled or failed.
const GROUPS: Array<{ en: string; ar: string; statuses: string[]; color: string }> = [
  { en: 'Completed', ar: 'مكتمل', statuses: ['DELIVERED', 'COLLECTED'], color: '#22A06B' },
  { en: 'Being prepared', ar: 'قيد التجهيز', statuses: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP'], color: '#FF7A1A' },
  { en: 'Out for delivery', ar: 'قيد التوصيل', statuses: ['ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY'], color: '#3B82F6' },
  { en: 'Cancelled or failed', ar: 'ملغي أو فاشل', statuses: ['CANCELLED', 'FAILED_DELIVERY'], color: '#EF4444' },
];

export function AdminOverview() {
  const { t, money, num, locale } = useLang();
  const { can } = usePermissions();
  const user = typeof window !== 'undefined' ? getCurrentUser() : null;
  const [preset, setPreset] = useState('7');
  const p = PRESETS.find((x) => x.id === preset)!;
  const from = cairoDate(-p.days);
  const to = cairoDate(0);
  // The chart follows the selected period; "Today" still shows the last 7 days so there is a trend to read.
  const chartDays = Math.max(p.days, 6);
  const seriesFrom = cairoDate(-chartDays);
  const reports = can('VIEW_REPORTS');

  const kpis = useApi<any>(reports ? '/admin/executive/kpis' : null, { from, to });
  const series = useApi<any>(reports ? '/admin/executive/timeseries' : null, { metric: 'orders', granularity: 'day', from: seriesFrom, to });
  const recent = useApi<any[]>(can('VIEW_ORDERS') ? '/admin/orders' : null, { limit: 6 });

  const fmt = (k: any) => (k.value === null ? t('No data', 'لا توجد بيانات') : k.unit === 'minor' ? money(k.value) : k.unit === 'percent' ? `${k.value}%` : num(k.value));
  const byKey: Record<string, any> = Object.fromEntries((kpis.data?.kpis ?? []).map((k: any) => [k.key, k]));
  const shown = KPI_ORDER.filter((c) => byKey[c.key]).slice(0, 4);
  const byStatus: Record<string, number> = kpis.data?.ordersByStatus ?? {};
  const segments = GROUPS.map((g) => ({ label: t(g.en, g.ar), color: g.color, value: g.statuses.reduce((n, s) => n + (byStatus[s] ?? 0), 0) }));
  const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', timeZone: 'Africa/Cairo' });
  const periodWords = preset === 'today' ? t('today', 'اليوم') : preset === '7' ? t('in the last 7 days', 'خلال آخر 7 أيام') : t('in the last 30 days', 'خلال آخر 30 يومًا');

  return (
    <div className="space-y-5" data-testid="admin-overview">
      <PageHeader
        title={t('Welcome to your dashboard', 'مرحباً بك في لوحة التحكم')}
        subtitle={user?.fullName ? t(`Here is a quick look at the platform, ${user.fullName}.`, `إليك نظرة سريعة على أداء المنصة يا ${user.fullName}.`) : t('Here is a quick look at the platform.', 'إليك نظرة سريعة على أداء المنصة.')}
        actions={reports ? <div className="-mb-4"><Tabs tabs={PRESETS.map((x) => ({ id: x.id, label: t(x.en, x.ar) }))} value={preset} onChange={setPreset} /></div> : undefined}
      />

      <PushSetupPrompt />
      <ActionCenter />

      {reports && (
        <Async state={kpis} rows={2}>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="overview-kpis">
            {shown.map((c) => {
              const k = byKey[c.key];
              return <KpiCard key={c.key} label={t(c.en, c.ar)} value={fmt(k)} delta={k.deltaPct} tone={k.deltaPct === null ? 'neutral' : k.deltaPct >= 0 ? 'good' : 'bad'} icon={ICONS[c.icon]} testId={`overview-kpi-${c.key}`} />;
            })}
          </div>
        </Async>
      )}

      {reports && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card title={t(`Orders ${chartDays === 6 ? 'in the last 7 days' : 'in the last 30 days'}`, `الطلبات ${chartDays === 6 ? 'خلال آخر 7 أيام' : 'خلال آخر 30 يومًا'}`)} className="min-w-0 xl:col-span-2" testId="overview-chart">
            <Async state={series} empty={series.data && series.data.points.length === 0} emptyTitle={t('No orders in this period', 'لا توجد طلبات في هذه الفترة')} rows={3}>
              {series.data && <AreaChart label={t('Orders per day', 'الطلبات يوميًا')} xLabel={chartDays === 6 ? dayName : undefined} points={fillDays(series.data.points.map((x: any) => ({ label: x.bucketStart, value: x.value })), seriesFrom, to)} />}
            </Async>
          </Card>
          <Card title={t(`Order status ${periodWords}`, `حالة الطلبات ${periodWords}`)} className="min-w-0">
            <Async state={kpis} rows={3}>
              {kpis.data && <DonutChart label={t('Orders by status', 'الطلبات حسب الحالة')} centerLabel={t('orders', 'طلب')} segments={segments} testId="overview-donut" />}
            </Async>
          </Card>
        </div>
      )}

      {can('VIEW_ORDERS') && (
        <Card title={t('Recent orders', 'آخر الطلبات')} pad={false} actions={<Link href="/order-management" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('View all', 'عرض الكل')}</Link>}>
          <Async state={recent} empty={recent.data && recent.data.length === 0} emptyTitle={t('No orders yet', 'لا توجد طلبات بعد')} rows={4}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="overview-recent">
                <thead className="hidden bg-gray-50/60 text-xs text-gray-500 md:table-header-group">
                  <tr>
                    {[t('Order #', 'رقم الطلب'), t('Customer', 'العميل'), t('Store', 'المتجر'), t('Value', 'القيمة'), t('Status', 'الحالة'), t('Time', 'الوقت')].map((h) => <th key={h} scope="col" className="px-5 py-2.5 text-start font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(recent.data ?? []).map((o: any) => (
                    <tr key={o.id} className="relative block px-5 py-3 hover:bg-orange-50/40 md:table-row md:p-0">
                      <td className="block md:table-cell md:px-5 md:py-3">
                        <Link href={`/order-management?order=${o.id}`} className="font-mono text-xs font-semibold text-gray-900 after:absolute after:inset-0"><bdi>{o.orderNumber}</bdi></Link>
                      </td>
                      <td className="block max-w-[12rem] text-gray-700 md:table-cell md:px-5 md:py-3"><bdi dir="auto" className="block truncate">{o.customer?.fullName ?? '—'}</bdi></td>
                      <td className="block max-w-[12rem] text-gray-500 md:table-cell md:px-5 md:py-3"><bdi dir="auto" className="block truncate">{(o.vendorNames ?? [])[0] ?? '—'}</bdi></td>
                      <td className="block tabular-nums text-gray-900 md:table-cell md:px-5 md:py-3">{o.totalMinor != null ? money(o.totalMinor) : '—'}</td>
                      <td className="block md:table-cell md:px-5 md:py-3"><StatusPill status={o.status} label={label(ORDER_STATUS, o.status, t)} /></td>
                      <td className="block whitespace-nowrap text-xs text-gray-400 md:table-cell md:px-5 md:py-3">{ago(o.createdAt, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Async>
        </Card>
      )}

      {!reports && !can('VIEW_ORDERS') && (
        <Card><p className="text-sm text-gray-600">{t('Choose a section in the menu to start.', 'اختر قسمًا من القائمة للبدء.')}</p></Card>
      )}
    </div>
  );
}
