'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../lib/ui/api';
import { useLang } from '../../lib/ui/lang';
import { usePermissions } from '../../lib/ui/permissions';
import { apiErrorMessage } from '../../lib/api/errors';
import { DriverPicker } from './DriverPicker';
import { I18nProvider } from '../../lib/i18n/i18n';
import { updateSegmentOnBehalf } from '../../lib/api/admin-operations';
import { assignDriver } from '../../lib/api/admin-dispatch';
import { DispatchDriver } from '../../lib/api/admin-control-tower';
import { DispatchAction } from './DispatchAction';
import { RejectPart } from './RejectReason';
import { useToast } from '../ui';
import { useBoardShown, useShellFacts } from '../shell/ops-shell-context';

/**
 * Operations board (stage 1 of the Admin simplification, 2026-11-13): every live order in ONE list, most urgent first, with the next step
 * as a button on the row — accept for the store (or accept and start preparing, approved shortcut), start preparing, ready, assign to the
 * suggested driver (same ranking as automatic dispatch) or another one. Every button is an existing endpoint with its own permission; the
 * board re-reads the backend after each action and every 10 s. Stage 4: a pending store part can be rejected from the row with a ready-made
 * reason (two taps in place). Refunds and other irreversible steps stay in the order.
 */
type Reason = 'FAILED_DELIVERY' | 'STORE_NOT_ACCEPTED' | 'DRIVER_OFFLINE' | 'NEEDS_DRIVER' | 'VERIFY_TRANSFER' | 'NEW' | 'DRIVER_NOT_ACKNOWLEDGED' | 'PREPARATION_LATE' | 'READY_FOR_CUSTOMER' | 'PREPARING' | 'WITH_DRIVER';

const REASON: Record<Reason, { en: string; ar: string; tone: string; bar: string }> = {
  FAILED_DELIVERY: { en: 'Failed delivery — decide', ar: 'توصيل فاشل — قرار مطلوب', tone: 'bg-red-50 text-red-800', bar: 'bg-red-600' },
  STORE_NOT_ACCEPTED: { en: 'Store has not accepted', ar: 'المتجر لم يقبل', tone: 'bg-red-50 text-red-800', bar: 'bg-red-600' },
  DRIVER_OFFLINE: { en: 'Driver offline', ar: 'المندوب غير متصل', tone: 'bg-red-50 text-red-800', bar: 'bg-red-600' },
  NEEDS_DRIVER: { en: 'Needs a driver', ar: 'يحتاج مندوبًا', tone: 'bg-orange-50 text-orange-800', bar: 'bg-orange-500' },
  VERIFY_TRANSFER: { en: 'Verify the transfer', ar: 'تحقق من التحويل', tone: 'bg-orange-50 text-orange-800', bar: 'bg-orange-500' },
  NEW: { en: 'New order', ar: 'طلب جديد', tone: 'bg-orange-50 text-orange-800', bar: 'bg-orange-500' },
  DRIVER_NOT_ACKNOWLEDGED: { en: 'Driver has not acknowledged', ar: 'المندوب لم يؤكد', tone: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' },
  PREPARATION_LATE: { en: 'Preparation late', ar: 'التحضير متأخر', tone: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' },
  READY_FOR_CUSTOMER: { en: 'Ready for the customer', ar: 'جاهز لاستلام العميل', tone: 'bg-blue-50 text-blue-800', bar: 'bg-blue-500' },
  PREPARING: { en: 'In preparation', ar: 'قيد التحضير', tone: 'bg-gray-100 text-gray-700', bar: 'bg-gray-300' },
  WITH_DRIVER: { en: 'With the driver', ar: 'مع المندوب', tone: 'bg-green-50 text-green-800', bar: 'bg-green-500' },
};
const FILTERS: Array<{ id: 'urgent' | 'all' | Reason; en: string; ar: string }> = [
  { id: 'urgent', en: 'Needs action', ar: 'يحتاج إجراء' },
  { id: 'all', en: 'All live', ar: 'كل الطلبات الجارية' },
  { id: 'NEW', en: 'New', ar: 'جديدة' },
  { id: 'NEEDS_DRIVER', en: 'Needs a driver', ar: 'تحتاج مندوبًا' },
  { id: 'PREPARING', en: 'Preparing', ar: 'قيد التحضير' },
  { id: 'WITH_DRIVER', en: 'With a driver', ar: 'مع المندوب' },
];
const URGENT: Reason[] = ['FAILED_DELIVERY', 'STORE_NOT_ACCEPTED', 'DRIVER_OFFLINE', 'NEEDS_DRIVER', 'VERIFY_TRANSFER', 'NEW', 'DRIVER_NOT_ACKNOWLEDGED', 'PREPARATION_LATE'];
const SEG_STATUS: Record<string, [string, string]> = {
  PENDING: ['waiting to accept', 'بانتظار القبول'], CONFIRMED: ['accepted', 'مقبول'], PREPARING: ['preparing', 'قيد التحضير'],
  READY_FOR_PICKUP: ['ready', 'جاهز'], CANCELLED: ['rejected', 'مرفوض'], PICKED_UP: ['picked up', 'تم الاستلام'],
};

function age(iso: string | null, now: number, ar: boolean) {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (m < 60) return ar ? `${m} د` : `${m}m`;
  const h = Math.floor(m / 60);
  return ar ? `${h} س` : `${h}h`;
}

/** The reassign box (DispatchAction) reads its words from the pages' I18nProvider — the board brings its own, so it works on Home too. */
export function OperationsBoard() {
  return (
    <I18nProvider>
      <Board />
    </I18nProvider>
  );
}

/**
 * Stage 5 (2026-11-14): work that is NOT a row on the board, in one strip above it — so the board is the one place to look. Each chip opens the
 * page that resolves it. The orders the board already lists (new, not accepted, needs a driver, late, driver offline…) are not repeated here;
 * the shell banner, which listed them too, steps aside while the board is on screen. Counts are the backend's own (VIEW_ORDERS reads).
 */
function OtherWork() {
  const { t } = useLang();
  const facts = useShellFacts();
  const exceptions = useApi<any>('/admin/order-exceptions/summary', undefined, { refreshInterval: 30_000 });
  const alerts = useApi<any[]>('/admin/alerts', undefined, { refreshInterval: 60_000 });
  const ex = exceptions.data;
  const openAlerts = (alerts.data ?? []).filter((a) => !a.acknowledged).length;
  const chips: Array<{ id: string; n: number; en: string; ar: string; href: string; strong?: boolean }> = [
    { id: 'exceptions', n: ex?.awaitingOperations ?? 0, en: 'order issues waiting for Operations', ar: 'مشكلة طلب بانتظار العمليات', href: '/exceptions', strong: true },
    { id: 'escalated', n: ex?.escalated ?? 0, en: 'escalated to a supervisor', ar: 'مُصعَّدة لمشرف', href: '/exceptions', strong: true },
    { id: 'assign-errors', n: facts?.openDispatchAlerts?.ASSIGNMENT_ERROR ?? 0, en: 'automatic assignment errors', ar: 'خطأ في الإسناد التلقائي', href: '/control-tower', strong: true },
    { id: 'refunds', n: facts?.refundsToSend ?? 0, en: 'refunds to send', ar: 'استرداد بانتظار الإرسال', href: '/refunds' },
    { id: 'alerts', n: openAlerts, en: 'alerts (stock, integrations…)', ar: 'تنبيه (المخزون، التكاملات…)', href: '/alerts' },
  ].filter((c) => c.n > 0);
  if (chips.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-2" data-testid="board-other-work">
      <span className="px-1 text-xs font-semibold text-gray-600">{t('Also waiting:', 'أيضًا بانتظارك:')}</span>
      {chips.map((c) => (
        <Link key={c.id} href={c.href} data-testid={`board-other-${c.id}`}
          className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${c.strong ? 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100' : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'}`}>
          <span className="font-bold">{c.n}</span> {t(c.en, c.ar)}
        </Link>
      ))}
    </div>
  );
}

function Board() {
  useBoardShown();
  const { t, money, locale } = useLang();
  const ar = locale === 'ar';
  const { can } = usePermissions();
  const toast = useToast();
  const canStore = can('MANAGE_ORDER_FULFILMENT');
  const canAssign = can('ASSIGN_REASSIGN_ORDERS');
  const board = useApi<any>('/admin/operations/board', undefined, { refreshInterval: 10_000 });
  const drivers = useApi<DispatchDriver[]>(canAssign ? '/admin/control-tower/drivers' : null, undefined, { refreshInterval: 20_000 });
  const [filter, setFilter] = useState<'urgent' | 'all' | Reason>('urgent');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [other, setOther] = useState<string | null>(null);
  /** Stage 2: orders ticked for one "assign to…" (board order = most urgent first). */
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const busyRef = useRef(false);
  const now = Date.now();

  const items: any[] = board.data?.items ?? [];
  const counts: Record<string, number> = board.data?.counts ?? {};
  const urgentCount = URGENT.reduce((n, r) => n + (counts[r] ?? 0), 0);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) =>
      (filter === 'all' || (filter === 'urgent' ? URGENT.includes(i.reason) : filter === 'PREPARING' ? ['PREPARING', 'PREPARATION_LATE'].includes(i.reason) : filter === 'WITH_DRIVER' ? ['WITH_DRIVER', 'DRIVER_OFFLINE', 'DRIVER_NOT_ACKNOWLEDGED'].includes(i.reason) : i.reason === filter))
      && (!s || i.orderNumber.toLowerCase().includes(s) || i.segments.some((g: any) => `${g.vendorName ?? ''} ${g.vendorNameAr ?? ''} ${g.placeName ?? ''}`.toLowerCase().includes(s)) || (i.driver?.name ?? '').toLowerCase().includes(s)));
  }, [items, filter, q]);

  // A ticked order that no longer needs a driver (assigned meanwhile, cancelled…) silently drops out of the selection.
  const needing = useMemo(() => new Set(items.filter((i) => i.reason === 'NEEDS_DRIVER').map((i) => i.id)), [items]);
  const picked = items.filter((i) => selected.includes(i.id) && needing.has(i.id));
  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const sortedDrivers = useMemo(() => [...(drivers.data ?? [])].sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || (a.activeCount ?? 0) / (a.capacity ?? 1) - (b.activeCount ?? 0) / (b.capacity ?? 1)), [drivers.data]);

  /** One driver for several orders: the existing assign endpoint once per order, in board order; the backend checks each (capacity R18). */
  async function assignMany(orders: any[], driver: { id: string; name: string }) {
    if (busyRef.current || orders.length === 0) return;
    busyRef.current = true;
    setBusy('bulk');
    const done: string[] = [];
    const refused: Array<{ order: string; why: string }> = [];
    try {
      for (let k = 0; k < orders.length; k++) {
        const o = orders[k];
        try {
          await assignDriver(o.id, driver.id);
          done.push(o.orderNumber);
        } catch (e) {
          const reason = (e as any)?.response?.data?.error?.details?.reason;
          const why = reason === 'AT_CAPACITY' ? t('the driver is full', 'المندوب وصل لسعته') : reason === 'OFFLINE' ? t('the driver is offline', 'المندوب غير متصل') : apiErrorMessage(e, t('refused', 'مرفوض'));
          refused.push({ order: o.orderNumber, why });
          // full / offline concerns the driver, not the order: the rest would be refused for the same reason
          if (reason === 'AT_CAPACITY' || reason === 'OFFLINE') {
            for (const rest of orders.slice(k + 1)) refused.push({ order: rest.orderNumber, why });
            break;
          }
        }
      }
      if (done.length) toast.push('success', t(`${done.length} order(s) assigned to ${driver.name}: ${done.join(', ')}.`, `أُسند ${done.length} طلب إلى ${driver.name}: ${done.join('، ')}.`));
      if (refused.length) {
        const groups = new Map<string, string[]>();
        for (const r of refused) groups.set(r.why, [...(groups.get(r.why) ?? []), r.order]);
        toast.push('error', [...groups].map(([why, os]) => t(`Not assigned (${why}): ${os.join(', ')}. They stay selected.`, `لم يُسند (${why}): ${os.join('، ')}. ما زالت محددة.`)).join(' '));
      }
      setSelected((cur) => cur.filter((id) => !orders.some((o) => o.id === id && done.includes(o.orderNumber))));
      if (!refused.length) setBulkOpen(false);
    } finally {
      board.reload();
      drivers.reload();
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function act(key: string, fn: () => Promise<void>, ok: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await fn();
      toast.push('success', ok);
    } catch (e) {
      toast.push('error', apiErrorMessage(e, t('The action could not be completed. The board was refreshed.', 'تعذّر تنفيذ الإجراء. تم تحديث اللوحة.')));
    } finally {
      board.reload();
      drivers.reload();
      busyRef.current = false;
      setBusy(null);
    }
  }

  const storeName = (g: any) => (ar ? g.vendorNameAr ?? g.vendorName : g.vendorName) ?? g.placeName ?? t('Store', 'المتجر');

  return (
    <div data-testid="operations-board">
      <OtherWork />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = f.id === 'urgent' ? urgentCount : f.id === 'all' ? items.length : f.id === 'PREPARING' ? (counts.PREPARING ?? 0) + (counts.PREPARATION_LATE ?? 0) : f.id === 'WITH_DRIVER' ? (counts.WITH_DRIVER ?? 0) + (counts.DRIVER_OFFLINE ?? 0) + (counts.DRIVER_NOT_ACKNOWLEDGED ?? 0) : counts[f.id] ?? 0;
          const on = filter === f.id;
          return (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={on} data-testid={`board-filter-${f.id}`}
              className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border px-3.5 text-sm font-medium ${on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}>
              {t(f.en, f.ar)}
              <span className={`rounded-full px-2 text-xs ${on ? 'bg-white/20' : f.id === 'urgent' && n > 0 ? 'bg-red-600 text-white' : 'bg-gray-100'}`}>{n}</span>
            </button>
          );
        })}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Order, store or driver', 'رقم الطلب أو المتجر أو المندوب')} aria-label={t('Search', 'بحث')} data-testid="board-search"
          className="ms-auto min-h-[40px] w-full rounded-lg border border-gray-300 px-3 text-sm sm:w-64" />
      </div>

      {canAssign && filter === 'NEEDS_DRIVER' && shown.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button type="button" data-testid="board-select-all" onClick={() => setSelected(shown.map((i) => i.id))}
            className="min-h-[36px] rounded-lg px-3 text-sm font-medium text-hatly-orangeDark hover:bg-orange-50">{t(`Select all ${shown.length}`, `تحديد الكل (${shown.length})`)}</button>
        </div>
      )}
      {board.data?.truncated && <p className="mb-2 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-700" data-testid="board-truncated">{t(`Showing the newest ${items.length} of ${board.data.totalLive} live orders. Older ones are in Orders.`, `يُعرض أحدث ${items.length} من ${board.data.totalLive} طلبًا جاريًا. الأقدم في صفحة الطلبات.`)} <Link href="/order-management" className="font-medium text-hatly-orangeDark underline">{t('Orders', 'الطلبات')}</Link></p>}
      {board.error && <p role="alert" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('Could not refresh the board. Retrying…', 'تعذّر تحديث اللوحة. جارٍ إعادة المحاولة…')}</p>}
      {!board.data && board.loading && <p className="py-10 text-center text-sm text-gray-500">{t('Loading…', 'جارٍ التحميل…')}</p>}
      {board.data && shown.length === 0 && (
        <p className="rounded-xl bg-green-50 px-4 py-8 text-center text-sm font-medium text-green-800" data-testid="board-empty">
          ✓ {filter === 'urgent' ? t('Nothing needs action right now.', 'لا شيء يحتاج إجراء الآن.') : t('No orders here.', 'لا توجد طلبات هنا.')}
        </p>
      )}

      <ul className="space-y-2">
        {shown.map((o) => {
          const r = REASON[o.reason as Reason];
          const live = o.segments.filter((g: any) => g.status !== 'CANCELLED');
          const suggested = o.suggestedDrivers?.[0];
          return (
            <li key={o.id} className="relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" data-testid={`board-row-${o.orderNumber}`} data-reason={o.reason}>
              <span aria-hidden className={`absolute inset-y-0 start-0 w-1.5 ${r.bar}`} />
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-3 ps-5">
                <div className="min-w-[11rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {canAssign && o.reason === 'NEEDS_DRIVER' && (
                      <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} data-testid="board-select"
                        aria-label={t(`Select ${o.orderNumber} to assign`, `تحديد ${o.orderNumber} للإسناد`)} className="h-5 w-5 accent-hatly-orange" />
                    )}
                    <Link href={`/order-management?order=${o.id}`} className="font-mono text-base font-bold text-gray-900 hover:underline"><bdi>{o.orderNumber}</bdi></Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.tone}`} data-testid="board-reason">{t(r.en, r.ar)}</span>
                    <span className="text-xs text-gray-500">{age(o.createdAt, now, ar)}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600">
                    {o.fulfillmentType === 'PICKUP' ? t('Customer pickup', 'استلام من العميل') : <bdi>{o.area ?? t('Delivery', 'توصيل')}</bdi>}
                    {' · '}{o.paymentMethod === 'COD' ? t(`Cash ${money(o.amountDueMinor ?? o.totalMinor ?? 0)}`, `نقدي ${money(o.amountDueMinor ?? o.totalMinor ?? 0)}`) : o.paymentMethod === 'MANUAL_TRANSFER' ? t('Transfer', 'تحويل') : o.paymentMethod === 'WALLET' ? t('Wallet', 'محفظة') : o.paymentMethod}
                    {o.driver && <> · {t('Driver', 'المندوب')} <bdi className="font-medium">{o.driver.name}</bdi>{!o.driver.online && <span className="ms-1 text-red-700">({t('offline', 'غير متصل')})</span>}</>}
                  </p>
                </div>

                <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:min-w-[22rem]">
                  {o.unverifiedTransfer && ['PENDING', 'CONFIRMED', 'PREPARING'].includes(o.status) ? (
                    <Link href="/manual-transfer" className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-hatly-orange px-3 text-sm font-semibold text-white hover:bg-hatly-orangeDark" data-testid="board-verify-transfer">{t('Verify the transfer', 'تحقق من التحويل')}</Link>
                  ) : (
                    live.filter((g: any) => ['PENDING', 'CONFIRMED', 'PREPARING'].includes(g.status)).map((g: any) => (
                      <div key={g.id} className="flex flex-wrap items-center gap-2" data-testid={`board-seg-${g.id}`}>
                        <span className="min-w-0 flex-1 truncate text-sm"><bdi className="font-medium">{storeName(g)}</bdi> <span className="text-xs text-gray-500">· {t(...(SEG_STATUS[g.status] ?? [g.status, g.status]))}</span></span>
                        {canStore && g.status === 'PENDING' && (
                          <>
                            <button type="button" disabled={busy !== null} data-testid="board-accept-prepare"
                              onClick={() => act(`ap-${g.id}`, async () => { await updateSegmentOnBehalf(g.id, { status: 'CONFIRMED' }); await updateSegmentOnBehalf(g.id, { status: 'PREPARING' }); }, t(`${o.orderNumber}: accepted and preparing for ${storeName(g)}.`, `${o.orderNumber}: قُبل وبدأ التحضير نيابة عن ${storeName(g)}.`))}
                              className="min-h-[40px] rounded-lg bg-hatly-orange px-3 text-sm font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50">
                              {busy === `ap-${g.id}` ? '…' : t('Accept & start preparing', 'قبول وبدء التحضير')}
                            </button>
                            <button type="button" disabled={busy !== null} data-testid="board-accept"
                              onClick={() => act(`a-${g.id}`, () => updateSegmentOnBehalf(g.id, { status: 'CONFIRMED' }), t(`${o.orderNumber}: accepted for ${storeName(g)}.`, `${o.orderNumber}: قُبل نيابة عن ${storeName(g)}.`))}
                              className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                              {t('Accept only', 'قبول فقط')}
                            </button>
                            <RejectPart segmentId={g.id} orderNumber={o.orderNumber} storeName={storeName(g)} disabled={busy !== null} run={act} />
                          </>
                        )}
                        {canStore && g.status === 'CONFIRMED' && (
                          <button type="button" disabled={busy !== null} data-testid="board-prepare"
                            onClick={() => act(`p-${g.id}`, () => updateSegmentOnBehalf(g.id, { status: 'PREPARING' }), t(`${o.orderNumber}: preparing.`, `${o.orderNumber}: بدأ التحضير.`))}
                            className="min-h-[40px] rounded-lg bg-hatly-orange px-3 text-sm font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50">{t('Start preparing', 'بدء التحضير')}</button>
                        )}
                        {canStore && g.status === 'PREPARING' && (
                          <button type="button" disabled={busy !== null} data-testid="board-ready"
                            onClick={() => act(`r-${g.id}`, () => updateSegmentOnBehalf(g.id, { status: 'READY_FOR_PICKUP' }), t(`${o.orderNumber}: ready.`, `${o.orderNumber}: جاهز.`))}
                            className="min-h-[40px] rounded-lg bg-hatly-orange px-3 text-sm font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50">{t('Ready', 'جاهز')}</button>
                        )}
                      </div>
                    ))
                  )}

                  {o.reason === 'NEEDS_DRIVER' && canAssign && (
                    <div className="flex flex-wrap items-center gap-2">
                      {suggested ? (
                        <button type="button" disabled={busy !== null} data-testid="board-assign-suggested"
                          onClick={() => act(`as-${o.id}`, () => assignDriver(o.id, suggested.id), t(`${o.orderNumber} assigned to ${suggested.name}.`, `أُسند ${o.orderNumber} إلى ${suggested.name}.`))}
                          className="min-h-[40px] flex-1 rounded-lg bg-hatly-orange px-3 text-sm font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50">
                          {busy === `as-${o.id}` ? '…' : <>{t('Assign to', 'إسناد إلى')} <bdi>{suggested.name}</bdi> <span className="font-normal opacity-90">({suggested.active}/{suggested.capacity})</span></>}
                        </button>
                      ) : (
                        <span className="flex-1 text-xs text-amber-800">{t('No eligible driver suggested right now — choose one.', 'لا يوجد مندوب مقترح الآن — اختر مندوبًا.')}</span>
                      )}
                      <button type="button" onClick={() => setOther(other === o.id ? null : o.id)} className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 hover:bg-gray-50" data-testid="board-assign-other">{t('Another driver…', 'مندوب آخر…')}</button>
                    </div>
                  )}
                  {o.reason === 'NEEDS_DRIVER' && other === o.id && canAssign && (
                    <DriverPicker orderId={o.id} count={1} drivers={drivers.data ?? []} busy={busy !== null} onClose={() => setOther(null)}
                      onPick={(d) => act(`as-${o.id}`, async () => { await assignDriver(o.id, d.id); setOther(null); }, t(`${o.orderNumber} assigned to ${d.name}.`, `أُسند ${o.orderNumber} إلى ${d.name}.`))} />
                  )}
                  {(o.reason === 'DRIVER_OFFLINE' || o.reason === 'DRIVER_NOT_ACKNOWLEDGED') && o.status === 'ASSIGNED_TO_DRIVER' && canAssign && (
                    <DispatchAction orderId={o.id} orderNumber={o.orderNumber} status={o.status} currentDriver={o.driver ? { id: o.driver.id, fullName: o.driver.name } : null}
                      drivers={sortedDrivers}
                      onChanged={(res) => { setOther(null); toast.push(res.ok ? 'success' : 'error', res.message); board.reload(); drivers.reload(); }} />
                  )}
                  {o.driver?.phone && ['DRIVER_OFFLINE', 'DRIVER_NOT_ACKNOWLEDGED'].includes(o.reason) && (
                    <a href={`tel:${o.driver.phone}`} className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-800" data-testid="board-call-driver">{t('Call the driver', 'اتصل بالمندوب')} <bdi className="ms-1">{o.driver.phone}</bdi></a>
                  )}
                  {o.reason === 'FAILED_DELIVERY' && (
                    <Link href="/failed-deliveries" className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-red-600 px-3 text-sm font-semibold text-white">{t('Decide what happens next', 'قرّر الخطوة التالية')}</Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {canAssign && picked.length > 0 && (
        <div className="sticky bottom-3 z-20 mt-3 rounded-2xl border border-gray-300 bg-white p-3 shadow-lg" data-testid="board-bulk-bar">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex-1 text-sm font-semibold text-gray-900" data-testid="board-bulk-count">{t(`${picked.length} order(s) selected`, `${picked.length} طلب محدد`)}
              <span className="ms-2 font-normal text-gray-500"><bdi>{picked.map((i) => i.orderNumber).join(ar ? '، ' : ', ')}</bdi></span></span>
            <button type="button" disabled={busy !== null} onClick={() => setBulkOpen((v) => !v)} data-testid="board-bulk-assign"
              className="min-h-[40px] rounded-lg bg-hatly-orange px-4 text-sm font-semibold text-white hover:bg-hatly-orangeDark disabled:opacity-50">
              {busy === 'bulk' ? '…' : t('Assign to…', 'إسناد إلى…')}</button>
            <button type="button" onClick={() => { setSelected([]); setBulkOpen(false); }} data-testid="board-bulk-clear"
              className="min-h-[40px] rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50">{t('Clear', 'إلغاء التحديد')}</button>
          </div>
          {bulkOpen && (
            <div className="mt-2">
              <DriverPicker orderId={picked[0].id} count={picked.length} drivers={drivers.data ?? []} busy={busy !== null} onClose={() => setBulkOpen(false)}
                onPick={(d) => assignMany(picked, d)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
