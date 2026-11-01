'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Async, BarChart, Card, KpiCard, PageHeader, cairoDate } from '../../../components/ui';
import { fillDays } from '../../../components/ui/charts';
import { ICONS } from '../../../components/ui/icons';
import { SegmentBadge } from '../../../components/vendor/SegmentBadge';
import { BranchOpenSwitch } from '../../../components/vendor/BranchOpenSwitch';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import type { VendorInsights, VendorOverview } from '../../../lib/api/vendor-business';
import { useVendorOrdersFeed } from '../../../lib/vendor/orders-feed';
import { ago } from '../../../lib/ui/time';

/**
 * The Vendor Home, laid out as the approved reference (`docs/transformation/reference/admin-vendor-reference.jpg`): a welcome with the store's name,
 * today's orders and sales against yesterday, products and rating, sales over 7 days and the latest orders — plus what waits in the kitchen
 * now and each branch's open/closed switch. Every figure comes from the vendor's own scoped endpoints.
 */
export default function VendorOverviewPage() {
  const { t, num, money, locale } = useLang();
  const state = useApi<VendorOverview>('/vendor/overview');
  const { awaitingAcceptance, orders } = useVendorOrdersFeed();
  const weekFrom = cairoDate(-6);
  const today = cairoDate(0);
  const insights = useApi<VendorInsights>('/vendor/insights', { from: weekFrom, to: today });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const d = state.data;
  const delta = (now: number, before: number | undefined) => (before === undefined || before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10);
  const dayName = (md: string) => new Date(`${today.slice(0, 4)}-${md}T12:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', timeZone: 'Africa/Cairo' });
  const shortMoney = (minor: number) => { const egp = minor / 100; return egp >= 1000 ? `${Math.round(egp / 100) / 10}K` : String(Math.round(egp)); };
  const store = d?.vendorName ?? null;
  return (
    <div className="space-y-5">
      <PageHeader
        title={store ? t(`Welcome, ${store}`, `مرحباً بك، ${store}`) : t('Welcome', 'مرحباً بك')}
        subtitle={t('Here is how your store is doing today.', 'إليك ملخص أداء متجرك اليوم.')}
      />
      <Async state={state} rows={4}>
        {d && (
          <>
            {/* The reference's four cards: today's orders and sales (each against all of yesterday), products, and the store rating. */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="vendor-overview-kpis">
              <KpiCard icon={ICONS.cart} label={t('Orders today', 'الطلبات اليوم')} value={num(d.today.received)} delta={delta(d.today.received, d.yesterday?.received)} tone={(delta(d.today.received, d.yesterday?.received) ?? 0) >= 0 ? 'good' : 'bad'} hint={t('Compared with all of yesterday', 'مقارنة بيوم أمس كاملًا')} testId="vendor-kpi-orders" />
              <KpiCard icon={ICONS.receipt} label={t('Sales today', 'المبيعات اليوم')} value={money(d.today.goodsMinor)} delta={delta(d.today.goodsMinor, d.yesterday?.goodsMinor)} tone={(delta(d.today.goodsMinor, d.yesterday?.goodsMinor) ?? 0) >= 0 ? 'good' : 'bad'} hint={t('Goods value; cancelled parts are not counted. Compared with all of yesterday.', 'قيمة البضاعة دون الأجزاء الملغاة، مقارنة بيوم أمس كاملًا.')} testId="vendor-kpi-sales" />
              <KpiCard icon={ICONS.box} label={t('Products', 'المنتجات')} value={d.productCount === undefined ? '—' : num(d.productCount)} testId="vendor-kpi-products" />
              <KpiCard icon={ICONS.star} label={t('Rating', 'التقييم')} value={d.rating ? <span className="inline-flex items-center gap-1">{d.rating.average.toFixed(1)}<span className="text-amber-400" aria-hidden>★</span></span> : t('No ratings yet', 'لا تقييمات بعد')} footnote={d.rating ? t(`${d.rating.count} ratings`, `${d.rating.count} تقييم`) : undefined} testId="vendor-kpi-rating" />
            </div>
            {/* What needs the kitchen right now (live, not in the reference but the board's own counts). */}
            <div className="flex flex-wrap gap-2 text-sm" data-testid="vendor-overview-live">
              {[
                ['waiting', t('Waiting for you', 'بانتظارك'), awaitingAcceptance || d.awaitingAcceptance, 'bg-red-50 text-red-700'],
                ['preparing', t('Accepted / preparing', 'مقبولة / قيد التحضير'), (d.live.CONFIRMED ?? 0) + (d.live.PREPARING ?? 0), 'bg-orange-50 text-hatly-orangeDark'],
                ['ready', t('Ready for pickup', 'جاهزة للاستلام'), d.live.READY_FOR_PICKUP ?? 0, 'bg-blue-50 text-blue-700'],
              ].map(([id, text, n, tone]) => (
                <Link key={id as string} href="/orders" className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 font-medium ${tone as string}`}><b className="tabular-nums">{num(n as number)}</b>{text as string}</Link>
              ))}
            </div>
            {d.openExceptions > 0 && (
              <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {t(`${d.openExceptions} order(s) with an unavailable item are waiting for the customer’s answer or for Hatly.`, `${d.openExceptions} طلب به منتج غير متاح بانتظار رد العميل أو هاتلي.`)}{' '}
                <Link href="/orders" className="font-medium underline">{t('Open orders', 'فتح الطلبات')}</Link>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <Card title={t('Sales in the last 7 days', 'المبيعات خلال آخر 7 أيام')} className="min-w-0 xl:col-span-2" testId="vendor-overview-chart" actions={<Link href="/insights" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('Reports', 'التقارير')}</Link>}>
                <Async state={insights} empty={insights.data && insights.data.daily.length === 0} emptyTitle={t('No orders in the last 7 days', 'لا طلبات في آخر 7 أيام')} rows={3}>
                  {insights.data && <BarChart label={t('Goods value per day', 'قيمة البضاعة يوميًا')} format={(n) => money(n)} tick={shortMoney} xLabel={dayName} points={fillDays(insights.data.daily.map((x) => ({ label: x.day, value: x.goodsMinor })), weekFrom, today).map((p) => ({ label: p.label.slice(5), value: p.value }))} />}
                </Async>
              </Card>
              <Card className="min-w-0" title={t('Latest orders', 'أحدث الطلبات')} pad={false} actions={<Link href="/orders" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('View all', 'عرض الكل')}</Link>}>
                {!orders || orders.length === 0 ? <p className="p-5 text-sm text-gray-500">{t('No orders yet.', 'لا توجد طلبات بعد.')}</p> : (
                  <ul className="divide-y divide-gray-50" data-testid="vendor-overview-latest">
                    {orders.slice(0, 5).map((o) => (
                      <li key={o.id}>
                        <Link href={`/orders?order=${o.id}`} className="flex items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-orange-50/40">
                          <span className="font-mono text-xs font-semibold text-gray-900"><bdi>{o.orderNumber ?? `#${o.id.slice(0, 8)}`}</bdi></span>
                          <span className="flex items-center gap-2">
                            <SegmentBadge status={o.segments[0]?.status ?? 'PENDING'} />
                            {o.segments[0]?.createdAt && <span className="whitespace-nowrap text-xs text-gray-400">{ago(o.segments[0].createdAt, locale)}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Card title={t('My branches', 'فروعي')} actions={<Link href="/my-branches" className="text-xs font-medium text-hatly-orangeDark hover:underline">{t('Hours and settings', 'المواعيد والإعدادات')}</Link>}>
              <ul className="divide-y divide-gray-100">
                {d.branches.map((b) => {
                  const isOpen = open[b.id] ?? b.isOpen;
                  return (
                    <li key={b.id} className="flex items-center justify-between gap-3 py-3" data-testid={`vendor-branch-${b.id}`}>
                      <div>
                        <p className="font-medium text-gray-900"><bdi>{b.name}</bdi></p>
                        <p className="text-xs text-gray-500">
                          {!b.isActive ? t('Deactivated by Hatly', 'معطّل من هاتلي') : isOpen ? t('Open for orders', 'مفتوح للطلبات') : t('Closed', 'مغلق')}
                          {b.preparationTimeMinutes ? ` · ${t(`about ${b.preparationTimeMinutes} min`, `حوالي ${b.preparationTimeMinutes} دقيقة`)}` : ''}
                        </p>
                      </div>
                      <BranchOpenSwitch branchId={b.id} name={b.name} isOpen={isOpen} isActive={b.isActive} onChanged={(v) => setOpen((cur) => ({ ...cur, [b.id]: v }))} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          </>
        )}
      </Async>
    </div>
  );
}
