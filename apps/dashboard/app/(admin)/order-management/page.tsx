'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AdminOrderListItem, searchAdminOrders } from '../../../lib/api/admin-order-search';
import { ControlTowerSummary, DispatchDriver, getControlTowerSummary, listDispatchDrivers } from '../../../lib/api/admin-control-tower';
import { apiErrorMessage } from '../../../lib/api/errors';
import { ORDER_STATUS, label } from '../../../lib/admin/labels';
import { I18nProvider } from '../../../lib/i18n/i18n';
import { useApi } from '../../../lib/ui/api';
import { useLang } from '../../../lib/ui/lang';
import { usePermissions } from '../../../lib/ui/permissions';
import { Badge, Button, DateRange, EmptyState, ErrorState, inputCls, LabeledSelect, PageHeader, Pagination, Skeleton, StatusPill, useDebounced } from '../../../components/ui';
import { Drawer } from '../../../components/ui/Drawer';
import { DispatchAction } from '../../../components/operations/DispatchAction';
import { OrderDetailView } from '../../../components/orders/OrderDetailView';
import { ExportButton } from '../../../components/reports/ExportButton';

/**
 * The Orders workspace — one place to find an order, understand it and act on it.
 *
 *  • Views group the orders by what needs doing (needs a driver · new · in preparation · with a driver · …). Every count is the backend's own
 *    (`GET admin/control-tower/summary`); a view with no honest count shows none.
 *  • "Needs attention" lists only real, non-zero facts and jumps straight to the list or page that resolves each.
 *  • Clicking a row opens the full order in a drawer — the list stays where it was, so working through a queue is a click, not a page load.
 *    A driver is assigned or reassigned from the row itself.
 *  • Keyboard: j/k (or ↑/↓) move, Enter opens, Esc closes, "/" searches. The list refreshes itself while the tab is visible.
 *  The state lives in the URL (`?view=&search=&order=`), so any view or open order can be shared or reloaded.
 */
type ViewId = 'all' | 'needsDriver' | 'pending' | 'preparing' | 'withDriver' | 'readyPickup' | 'failed' | 'done' | 'cancelled';
interface View {
  id: ViewId;
  en: string;
  ar: string;
  statuses?: string[];
  fulfillment?: 'DELIVERY' | 'PICKUP';
  /** The backend's own number for the view, or null when there is none to show. */
  count?: (s: ControlTowerSummary) => number | null;
}
const by = (s: ControlTowerSummary, ...statuses: string[]) => statuses.reduce((n, k) => n + (s.ordersByStatus?.[k] ?? 0), 0);
const VIEWS: View[] = [
  { id: 'all', en: 'All orders', ar: 'كل الطلبات' },
  { id: 'needsDriver', en: 'Needs a driver', ar: 'تحتاج سائقًا', statuses: ['READY_FOR_PICKUP'], fulfillment: 'DELIVERY', count: (s) => s.attention.awaitingAssignment },
  { id: 'pending', en: 'New', ar: 'جديدة', statuses: ['PENDING'], count: (s) => by(s, 'PENDING') },
  { id: 'preparing', en: 'In preparation', ar: 'قيد التحضير', statuses: ['CONFIRMED', 'PREPARING'], count: (s) => by(s, 'CONFIRMED', 'PREPARING') },
  { id: 'withDriver', en: 'With a driver', ar: 'مع السائق', statuses: ['ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY'], count: (s) => by(s, 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY') },
  { id: 'readyPickup', en: 'Ready for pickup', ar: 'جاهزة للاستلام', statuses: ['READY_FOR_PICKUP'], fulfillment: 'PICKUP', count: (s) => s.attention.readyForCustomerPickup },
  { id: 'failed', en: 'Failed delivery', ar: 'توصيل فاشل', statuses: ['FAILED_DELIVERY'], count: (s) => by(s, 'FAILED_DELIVERY') },
  { id: 'done', en: 'Completed', ar: 'مكتملة', statuses: ['DELIVERED', 'COLLECTED'] },
  { id: 'cancelled', en: 'Cancelled', ar: 'ملغاة', statuses: ['CANCELLED'] },
];
const VIEW_IDS = VIEWS.map((v) => v.id) as string[];
const PAYMENT_METHODS = ['COD', 'WALLET', 'MANUAL_TRANSFER', 'PAY_AT_DELIVERY', 'ELECTRONIC'];

/** How long ago, in the unit that reads best ("5m", "3h", "2d"). Display only. */
function age(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 60 * 48) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

export default function OrdersWorkspacePage() {
  return (
    <I18nProvider>
      <OrdersWorkspace />
    </I18nProvider>
  );
}

function OrdersWorkspace() {
  const { t, money, dateTime } = useLang();
  const { can } = usePermissions();
  const canAssign = can('ASSIGN_REASSIGN_ORDERS');

  const [view, setView] = useState<ViewId>('all');
  const [q, setQ] = useState('');
  const search = useDebounced(q, 300);
  const [payment, setPayment] = useState('');
  const [branch, setBranch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pricing, setPricing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // A raw status from an older link (?status=CONFIRMED) that no view matches exactly: shown as a removable chip.
  const [rawStatus, setRawStatus] = useState('');
  const [rawFulfillment, setRawFulfillment] = useState('');
  const [active, setActive] = useState(-1);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);

  const [items, setItems] = useState<AdminOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ControlTowerSummary | null>(null);
  const [drivers, setDrivers] = useState<DispatchDriver[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reassigning, setReassigning] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const branches = useApi<any[]>('/admin/branch-directory', { limit: 100 });
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  // The URL is the state: read it once, then keep it in step.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const v = p.get('view');
    // Control Tower / legacy links use ?status= (+ fulfillmentType=); map them onto the matching view so they still land somewhere useful.
    const legacy = p.get('status');
    const legacyView = legacy
      ? VIEWS.find((x) => x.statuses?.length === 1 && x.statuses[0] === legacy && (x.fulfillment ?? p.get('fulfillmentType') ?? undefined) === (p.get('fulfillmentType') ?? undefined))?.id
      : undefined;
    setView(v && VIEW_IDS.includes(v) ? (v as ViewId) : legacyView ?? 'all');
    if (!v && legacy && !legacyView && /^[A-Z_]+$/.test(legacy)) { setRawStatus(legacy); setRawFulfillment(p.get('fulfillmentType') ?? ''); }
    setQ(p.get('search') ?? p.get('q') ?? '');
    setOpenId(p.get('order'));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams();
    if (view !== 'all') p.set('view', view);
    if (rawStatus && view === 'all') p.set('status', rawStatus);
    if (rawFulfillment && view === 'all') p.set('fulfillmentType', rawFulfillment);
    if (q.trim()) p.set('search', q.trim());
    if (openId) p.set('order', openId);
    window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname);
  }, [ready, view, q, openId, rawStatus, rawFulfillment]);

  const loadSummary = useCallback(() => { getControlTowerSummary().then(setSummary).catch(() => undefined); }, []);
  const loadDrivers = useCallback(() => { if (canAssign) listDispatchDrivers().then(setDrivers).catch(() => undefined); }, [canAssign]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadDrivers(); }, [loadDrivers]);

  const filterKey = JSON.stringify([view, search, payment, branch, from, to, pricing, rawStatus, rawFulfillment]);
  useEffect(() => { setPage(1); }, [filterKey]);

  const run = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await searchAdminOrders({
        page,
        limit: 25,
        search: search.trim() || undefined,
        statuses: current.statuses?.length ? current.statuses.join(',') : view === 'all' && rawStatus ? rawStatus : undefined,
        fulfillmentType: current.fulfillment ?? (view === 'all' && rawFulfillment ? rawFulfillment : undefined),
        paymentMethod: payment || undefined,
        vendorBranchId: branch || undefined,
        from: from || undefined,
        to: to || undefined,
        hasPendingPricing: pricing ? true : undefined,
      });
      setItems(r.data); setTotal(r.meta.total); setLimit(r.meta.limit); setError(null); setNow(Date.now());
    } catch (e: any) {
      setError(apiErrorMessage(e, t('Could not load orders.', 'تعذّر تحميل الطلبات.')));
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, current, view, rawStatus, rawFulfillment, payment, branch, from, to, pricing, t]);
  useEffect(() => { if (ready) void run(); }, [ready, run]);

  // Keep the queue live while the tab is on screen.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') { void run(true); loadSummary(); }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [run, loadSummary]);

  const rows = items ?? [];
  const openIndex = openId ? rows.findIndex((r) => r.id === openId) : -1;
  const move = useCallback((delta: number) => {
    if (rows.length === 0) return;
    const base = openId && openIndex >= 0 ? openIndex : active;
    const next = Math.min(rows.length - 1, Math.max(0, (base < 0 ? (delta > 0 ? -1 : rows.length) : base) + delta));
    setActive(next);
    if (openId) setOpenId(rows[next].id);
  }, [rows, openId, openIndex, active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (typing) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if ((e.key === 'Enter' || e.key === 'o') && !openId && active >= 0 && rows[active]) { e.preventDefault(); setOpenId(rows[active].id); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move, openId, rows, active]);

  const attention = useMemo(() => {
    if (!summary) return [];
    const a = summary.attention;
    const o = summary.operations;
    const list: { key: string; n: number; en: string; ar: string; view?: ViewId; href?: string }[] = [
      { key: 'needsDriver', n: a.awaitingAssignment, en: 'need a driver', ar: 'تحتاج سائقًا', view: 'needsDriver' },
      { key: 'released', n: a.releasedAwaitingManualAssignment, en: 'released — nobody will pick them up automatically', ar: 'أُفرج عنها — لن يُسندها النظام تلقائيًا', view: 'needsDriver' },
      { key: 'deadline', n: a.assignedPastAcceptDeadline, en: 'assigned and past the acceptance deadline', ar: 'مُسندة وتجاوزت مهلة القبول', view: 'withDriver' },
      { key: 'vendorOverdue', n: o?.pendingAcceptanceOverdue ?? 0, en: 'vendor parts not accepted in time', ar: 'أجزاء لم يقبلها المورد في الوقت المناسب', view: 'pending' },
      { key: 'prepOverdue', n: o?.preparationOverdue ?? 0, en: 'orders overdue in preparation', ar: 'طلبات متأخرة في التحضير', view: 'preparing' },
      { key: 'failed', n: a.failedDeliveriesUnresolved, en: 'failed deliveries to resolve', ar: 'توصيلات فاشلة تحتاج حلًا', href: '/failed-deliveries' },
    ];
    return list.filter((x) => x.n > 0);
  }, [summary]);

  const moreActive = [payment, branch, from || to, pricing].filter(Boolean).length;
  const anyFilter = moreActive + (q.trim() ? 1 : 0) + (view !== 'all' ? 1 : 0) + (rawStatus ? 1 : 0);
  const clearAll = () => { setRawStatus(''); setRawFulfillment(''); setQ(''); setView('all'); setPayment(''); setBranch(''); setFrom(''); setTo(''); setPricing(false); };

  const onAssigned = (outcome: { ok: boolean; message: string }) => {
    setNotice(outcome.message);
    void run(true); loadSummary(); loadDrivers();
    window.setTimeout(() => setNotice(null), 6000);
  };

  const canInlineAssign = (o: AdminOrderListItem) => canAssign && o.fulfillmentType === 'DELIVERY' && (o.status === 'READY_FOR_PICKUP' || o.status === 'ASSIGNED_TO_DRIVER');

  const openOrder = openIndex >= 0 ? rows[openIndex] : null;

  // Whatever was done inside the drawer (assign, cancel, price…), the list and the counts catch up when it closes.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !openId) { void run(true); loadSummary(); loadDrivers(); }
    wasOpen.current = !!openId;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title={t('Orders', 'الطلبات')}
        actions={
          <>
            {summary && (
              <Link href="/control-tower" className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-50" data-testid="dispatch-mode">
                <span aria-hidden className={`h-2 w-2 rounded-full ${summary.automaticDispatchEnabled ? 'bg-green-500' : 'bg-amber-500'}`} />
                {summary.automaticDispatchEnabled ? t('Automatic dispatch on', 'الإسناد التلقائي مُفعّل') : t('Manual dispatch', 'إسناد يدوي')}
              </Link>
            )}
            {can('ORDERS_EXPORT') && <ExportButton report="S02" params={{ from: from || undefined, to: to || undefined, paymentMethod: payment || undefined, vendorBranchId: branch || undefined }} />}
          </>
        }
      />

      {attention.length > 0 && (
        <section aria-label={t('Needs attention', 'يحتاج انتباهًا')} className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="attention-strip">
          {attention.map((a) => {
            const body = (
              <>
                <span className="font-semibold tabular-nums">{a.n}</span> {t(a.en, a.ar)}
              </>
            );
            const cls = 'inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-3 text-xs text-amber-900 hover:bg-amber-100';
            return a.href ? (
              <Link key={a.key} href={a.href} className={cls} data-testid={`attention-${a.key}`}>{body}</Link>
            ) : (
              <button key={a.key} type="button" onClick={() => setView(a.view!)} className={cls} data-testid={`attention-${a.key}`}>{body}</button>
            );
          })}
        </section>
      )}

      <div role="tablist" aria-label={t('Order views', 'عروض الطلبات')} className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1" data-testid="order-views">
        {VIEWS.map((v) => {
          const n = summary && v.count ? v.count(summary) : null;
          const on = v.id === view;
          return (
            <button
              key={v.id} role="tab" aria-selected={on} onClick={() => setView(v.id)} data-testid={`view-${v.id}`}
              className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition ${on ? 'bg-hatly-orange text-white shadow-sm' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {t(v.en, v.ar)}
              {n != null && <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? 'bg-white/25' : n > 0 && (v.id === 'needsDriver' || v.id === 'failed') ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mb-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <input
              ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} data-testid="orders-search"
              placeholder={t('Search: order number (HT-100234), customer name or phone — press / to focus', 'ابحث: رقم الطلب (HT-100234) أو اسم العميل أو هاتفه — اضغط / للتركيز')}
              aria-label={t('Search orders', 'بحث في الطلبات')} className={`${inputCls} min-h-[44px] pe-9 sm:min-h-0`}
            />
            {q && <button type="button" onClick={() => setQ('')} aria-label={t('Clear search', 'مسح البحث')} className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700">✕</button>}
          </div>
          <Button type="button" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen} className="min-h-[40px]">
            {t('Filters', 'الفلاتر')}{moreActive > 0 && <Badge tone="orange">{moreActive}</Badge>}
          </Button>
          {anyFilter > 0 && <Button type="button" variant="ghost" onClick={clearAll} className="min-h-[40px]">{t('Clear all', 'مسح الكل')}</Button>}
        </div>
        {rawStatus && view === 'all' && (
          <p className="mt-2 flex items-center gap-2 text-xs text-gray-600" data-testid="raw-status-chip">
            {t('Status', 'الحالة')}: <Badge tone="orange">{label(ORDER_STATUS, rawStatus, t)}{rawFulfillment ? ` · ${rawFulfillment === 'PICKUP' ? t('Pickup', 'استلام') : t('Delivery', 'توصيل')}` : ''}</Badge>
            <button type="button" onClick={() => { setRawStatus(''); setRawFulfillment(''); }} className="rounded px-1 text-gray-400 hover:text-gray-700" aria-label={t('Remove status filter', 'إزالة فلتر الحالة')}>✕</button>
          </p>
        )}
        {moreOpen && (
          <div className="mt-3 grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="orders-filters">
            <LabeledSelect label={t('Payment method', 'طريقة الدفع')} value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="">{t('Any', 'أي')}</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
            </LabeledSelect>
            <LabeledSelect label={t('Vendor branch', 'فرع المورد')} value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('Any', 'أي')}</option>
              {(branches.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.vendorName ? `${b.vendorName} — ${b.name}` : b.name}</option>)}
            </LabeledSelect>
            <div className="sm:col-span-2 lg:col-span-1"><DateRange from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /></div>
            <label className="flex min-h-[40px] items-center gap-2 self-end text-sm text-gray-700">
              <input type="checkbox" checked={pricing} onChange={(e) => setPricing(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-hatly-orange focus:ring-hatly-orange" />
              {t('Hatly Service price pending', 'سعر خدمة هاتلي معلّق')}
            </label>
          </div>
        )}
      </div>

      {notice && <div role="status" className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="orders-notice">{notice}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {items && (
          <p className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-500" aria-live="polite" data-testid="orders-count">
            <span>{t(`${total} order${total === 1 ? '' : 's'}`, `${total} طلب`)}</span>
            <span className="hidden sm:inline">{t('j / k to move · Enter to open · Esc to close', 'j / k للتنقل · Enter للفتح · Esc للإغلاق')}</span>
          </p>
        )}
        {error && !items ? (
          <ErrorState message={error} onRetry={() => void run()} />
        ) : !items ? (
          <div className="space-y-2 p-4" aria-busy="true">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={view === 'needsDriver' ? t('No order is waiting for a driver.', 'لا يوجد طلب ينتظر سائقًا.') : t('No orders match.', 'لا توجد طلبات مطابقة.')}
            hint={anyFilter > 0 ? t('Try another view, or clear the filters.', 'جرّب عرضًا آخر أو امسح الفلاتر.') : undefined}
            action={anyFilter > 0 ? <Button onClick={clearAll}>{t('Clear all', 'مسح الكل')}</Button> : undefined}
          />
        ) : (
          <>
            <div className={`hidden overflow-x-auto md:block ${loading ? 'opacity-60' : ''}`}>
              <table className="min-w-full text-sm" data-testid="orders-table">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    {[t('Order', 'الطلب'), t('Status', 'الحالة'), t('Vendors', 'الموردون'), t('Customer', 'العميل'), t('Driver', 'السائق'), t('Total', 'الإجمالي')].map((h, i) => (
                      <th key={i} scope="col" className={`px-3 py-2 font-medium ${i === 5 ? 'text-end' : 'text-start'}`}>{h}</th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => (
                    <tr
                      key={o.id} data-testid={`order-row-${o.orderNumber}`} aria-selected={i === active}
                      onClick={() => { setActive(i); setOpenId(o.id); }}
                      className={`cursor-pointer border-b border-gray-100 align-middle hover:bg-orange-50/40 ${i === active ? 'bg-orange-50/60 outline outline-1 -outline-offset-1 outline-orange-200' : ''}`}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="font-mono text-xs font-semibold text-gray-900"><bdi>{o.orderNumber}</bdi></span>
                        <span className="ms-2 text-xs text-gray-400" title={dateTime(o.createdAt)}>{age(o.createdAt, now)}</span>
                        <span className="ms-1.5 inline-flex gap-1">
                          {o.hasPendingHatlyServicePricing && <span data-testid="pending-price-badge"><Badge tone="amber">{t('Price pending', 'سعر معلّق')}</Badge></span>}
                          {o.fulfillmentType === 'PICKUP' && <Badge tone="blue">{t('Pickup', 'استلام')}</Badge>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5"><StatusPill status={o.status} label={label(ORDER_STATUS, o.status, t)} /></td>
                      <td className="max-w-[14rem] px-3 py-2.5 text-gray-700">
                        <span className="block truncate" title={(o.vendorNames ?? []).join(' · ')}>
                          {(o.vendorNames ?? []).length === 0 ? '—' : <bdi>{o.vendorNames![0]}</bdi>}
                          {(o.vendorNames ?? []).length > 1 && <span className="ms-1 text-xs text-gray-400">+{o.vendorNames!.length - 1}</span>}
                        </span>
                      </td>
                      <td className="max-w-[12rem] px-3 py-2.5"><span className="block truncate text-gray-800"><bdi>{o.customer?.fullName ?? '—'}</bdi></span></td>
                      <td className="min-w-[12rem] px-3 py-2.5" onClick={(e) => canInlineAssign(o) && e.stopPropagation()}>
                        {canInlineAssign(o) && (o.status === 'READY_FOR_PICKUP' || reassigning === o.id) ? (
                          <DispatchAction orderId={o.id} orderNumber={o.orderNumber} status={o.status} currentDriver={o.driver ?? null} drivers={drivers} onChanged={(r) => { setReassigning(null); onAssigned(r); }} />
                        ) : o.driver ? (
                          <span className="text-gray-800">
                            <bdi>{o.driver.fullName}</bdi>
                            {canInlineAssign(o) && <button type="button" onClick={() => setReassigning(o.id)} className="ms-2 text-xs font-medium text-hatly-orangeDark hover:underline" data-testid={`reassign-${o.orderNumber}`}>{t('Reassign', 'إعادة إسناد')}</button>}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-end tabular-nums text-gray-900">
                        {o.totalMinor != null ? money(o.totalMinor) : o.hasPendingHatlyServicePricing ? t('Pending', 'معلّق') : '—'}
                        <span className="block text-[11px] font-normal text-gray-500">{o.paymentMethod.replace(/_/g, ' ')}{o.paymentStatus ? ` · ${o.paymentStatus.replace(/_/g, ' ').toLowerCase()}` : ''}</span>
                      </td>
                      <td className="px-2 text-gray-300 rtl:rotate-180" aria-hidden>›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className={`divide-y divide-gray-100 md:hidden ${loading ? 'opacity-60' : ''}`} data-testid="orders-cards">
              {rows.map((o, i) => (
                <li key={o.id} className={`px-3 py-3 ${i === active ? 'bg-orange-50/50' : ''}`}>
                  <button type="button" onClick={() => { setActive(i); setOpenId(o.id); }} className="block w-full text-start">
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-semibold text-gray-900"><bdi>{o.orderNumber}</bdi> <span className="font-sans text-xs font-normal text-gray-400">{age(o.createdAt, now)}</span></span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{o.totalMinor != null ? money(o.totalMinor) : t('Pending', 'معلّق')}</span>
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusPill status={o.status} label={label(ORDER_STATUS, o.status, t)} />
                      {o.hasPendingHatlyServicePricing && <Badge tone="amber">{t('Price pending', 'سعر معلّق')}</Badge>}
                      {o.fulfillmentType === 'PICKUP' && <Badge tone="blue">{t('Pickup', 'استلام')}</Badge>}
                    </span>
                    <span className="mt-1 block truncate text-xs text-gray-500"><bdi>{(o.vendorNames ?? []).join(' · ') || '—'}</bdi>{o.driver ? <> · <bdi>{o.driver.fullName}</bdi></> : null}</span>
                  </button>
                  {canInlineAssign(o) && o.status === 'READY_FOR_PICKUP' && <div className="mt-2"><DispatchAction orderId={o.id} orderNumber={o.orderNumber} status={o.status} currentDriver={o.driver ?? null} drivers={drivers} onChanged={onAssigned} /></div>}
                </li>
              ))}
            </ul>
            <Pagination page={page} limit={limit} total={total} onPage={setPage} />
          </>
        )}
      </div>

      <Drawer
        open={!!openId} onClose={() => setOpenId(null)} title={t('Order', 'الطلب')} testId="order-drawer"
        header={
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{openOrder ? <bdi>{openOrder.orderNumber}</bdi> : t('Order', 'الطلب')}</p>
            <button type="button" onClick={() => move(-1)} disabled={openIndex <= 0} aria-label={t('Previous order', 'الطلب السابق')} data-testid="drawer-prev" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"><span aria-hidden className="rtl:rotate-180">‹</span></button>
            <button type="button" onClick={() => move(1)} disabled={openIndex < 0 || openIndex >= rows.length - 1} aria-label={t('Next order', 'الطلب التالي')} data-testid="drawer-next" className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-30"><span aria-hidden className="rtl:rotate-180">›</span></button>
          </div>
        }
      >
        {openId && <OrderDetailView key={openId} orderId={openId} embedded />}
      </Drawer>
    </div>
  );
}
