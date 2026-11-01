'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { VendorOrder, VendorOrderSegment, updateSegmentStatus } from '../../../lib/api/vendor-orders';
import { apiErrorMessage } from '../../../lib/api/errors';
import { Badge, Button, Card, EmptyState, PageHeader } from '../../../components/ui';
import { Drawer } from '../../../components/ui/Drawer';
import { SegmentBadge } from '../../../components/vendor/SegmentBadge';
import { VendorOrderDetailView } from '../../../components/vendor/VendorOrderDetailView';
import { useLang } from '../../../lib/ui/lang';
import { useVendorOrdersFeed } from '../../../lib/vendor/orders-feed';
import { FULFILLMENT, PAYMENT_METHOD, pick } from '../../../lib/vendor/labels';

/**
 * The vendor's incoming-orders board. Every card is one of YOUR parts of an order (the server only ever sends those), sitting in the column for
 * its state: waiting for you → being prepared → ready. The next step is one tap on the card (Confirm · Start preparing · Mark ready), a rejection
 * or a weight / price / unavailable item is a tap on "Details", which opens the full order in a drawer without leaving the board. The list
 * refreshes itself (change feed with a timed fallback). The vendor never sees the customer's phone or address here — the API does not send them.
 * The order-level status is read-only context: only the part's own status is ever changed.
 */
type Column = 'new' | 'preparing' | 'ready';
const COLUMNS: { id: Column; en: string; ar: string; statuses: VendorOrderSegment['status'][]; tone: string }[] = [
  { id: 'new', en: 'Waiting for you', ar: 'بانتظارك', statuses: ['PENDING'], tone: 'border-amber-200 bg-amber-50/60' },
  { id: 'preparing', en: 'Being prepared', ar: 'قيد التحضير', statuses: ['CONFIRMED', 'PREPARING'], tone: 'border-blue-200 bg-blue-50/50' },
  { id: 'ready', en: 'Ready for pickup', ar: 'جاهز للاستلام', statuses: ['READY_FOR_PICKUP'], tone: 'border-green-200 bg-green-50/50' },
];
/** The ONE forward step of each state (the backend's transition table is the authority; this only picks the button). */
const NEXT: Record<string, { to: VendorOrderSegment['status']; en: string; ar: string } | undefined> = {
  PENDING: { to: 'CONFIRMED', en: 'Confirm', ar: 'قبول الطلب' },
  CONFIRMED: { to: 'PREPARING', en: 'Start preparing', ar: 'بدء التحضير' },
  PREPARING: { to: 'READY_FOR_PICKUP', en: 'Mark ready', ar: 'جاهز للاستلام' },
};
/** Once the order itself has left the vendor, no part can move any more (mirrors the backend lock). */
const LOCKED_ORDER_STATUSES = ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'COLLECTED', 'CANCELLED', 'FAILED_DELIVERY'];

interface BoardCard { order: VendorOrder; segment: VendorOrderSegment }

const grams = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2)} kg` : `${g} g`);

export default function VendorOrdersBoard() {
  const { t, locale } = useLang();
  const { orders, error, refresh, newIds, acknowledgeNew, lastUpdatedAt, soundEnabled, setSoundEnabled } = useVendorOrdersFeed();
  const [openId, setOpenId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<Column>('new');
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);
  const inFlight = useRef<string | null>(null);

  useEffect(() => { setOpenId(new URLSearchParams(window.location.search).get('order')); }, []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (openId) p.set('order', openId);
    window.history.replaceState(null, '', p.toString() ? `?${p}` : window.location.pathname);
  }, [openId]);

  const cards = useMemo<BoardCard[]>(() => (orders ?? []).flatMap((o) => o.segments.map((s) => ({ order: o, segment: s }))), [orders]);
  const byColumn = (c: Column) => cards.filter((x) => COLUMNS.find((k) => k.id === c)!.statuses.includes(x.segment.status) && !(c !== 'new' && LOCKED_ORDER_STATUSES.includes(x.order.status)));
  const counts = { new: byColumn('new').length, preparing: byColumn('preparing').length, ready: byColumn('ready').length };
  const other = cards.length - counts.new - counts.preparing - counts.ready;

  const advance = useCallback(async (card: BoardCard) => {
    const step = NEXT[card.segment.status];
    if (!step || inFlight.current) return;
    inFlight.current = card.segment.id;
    setBusy(card.segment.id);
    setActionError(null);
    try {
      await updateSegmentStatus(card.segment.id, step.to);
      await refresh();
    } catch (e: any) {
      setActionError({ id: card.segment.id, message: apiErrorMessage(e, t('Could not update this order.', 'تعذّر تحديث هذا الطلب.')) });
      await refresh();
    } finally {
      inFlight.current = null;
      setBusy(null);
    }
  }, [refresh, t]);

  const renderCard = ({ order, segment }: BoardCard) => {
    const step = NEXT[segment.status];
    const locked = LOCKED_ORDER_STATUSES.includes(order.status);
    const needsWeight = segment.items.some((i) => i.pricingUnitSnapshot === 'WEIGHT' && i.actualWeightGrams == null);
    const needsPrice = segment.items.some((i) => i.productId == null && i.actualAmountMinor == null);
    const isNew = newIds.has(order.id);
    return (
      <li key={segment.id} data-testid={`vendor-order-${order.id}`} className={`rounded-xl border bg-white p-3 shadow-sm ${isNew ? 'border-green-400 ring-2 ring-green-200' : 'border-gray-200'}`}>
        <div className="flex items-start justify-between gap-2">
          <Link href={`/orders/${order.id}`} className="font-semibold text-gray-900 hover:underline">
            {t('Order', 'طلب')} #{order.id.slice(0, 8)}
            {isNew && <span className="ms-2 rounded bg-green-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">{t('NEW', 'جديد')}</span>}
          </Link>
          <SegmentBadge status={segment.status} />
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          {pick(FULFILLMENT, order.fulfillmentType, t)} · {pick(PAYMENT_METHOD, order.paymentMethod, t)}
          {segment.expectedReadyAt && <> · {t('ready by', 'جاهز بحلول')} {new Date(segment.expectedReadyAt).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</>}
        </p>
        <ul className="mt-2 space-y-0.5 text-sm text-gray-800">
          {segment.items.slice(0, 4).map((i) => (
            <li key={i.id} className="flex justify-between gap-2">
              <span className="min-w-0 truncate"><bdi>{i.productNameSnapshot ?? i.freeTextDescriptionSnapshot ?? '—'}</bdi></span>
              <span className="shrink-0 tabular-nums text-gray-500">{i.pricingUnitSnapshot === 'WEIGHT' && i.requestedWeightGrams ? grams(i.actualWeightGrams ?? i.requestedWeightGrams) : `× ${i.quantity}`}</span>
            </li>
          ))}
          {segment.items.length > 4 && <li className="text-xs text-gray-400">+{segment.items.length - 4} {t('more', 'أخرى')}</li>}
        </ul>
        {(needsWeight || needsPrice || (segment.removedItems?.length ?? 0) > 0 || order.orderNote) && (
          <p className="mt-2 flex flex-wrap gap-1">
            {needsWeight && <Badge tone="amber">{t('Weight needed', 'الوزن مطلوب')}</Badge>}
            {needsPrice && <Badge tone="amber">{t('Price needed', 'السعر مطلوب')}</Badge>}
            {(segment.removedItems?.length ?? 0) > 0 && <Badge tone="gray">{t('Items removed', 'أصناف محذوفة')}</Badge>}
            {order.orderNote && <Badge tone="blue">{t('Customer note', 'ملاحظة العميل')}</Badge>}
          </p>
        )}
        {actionError?.id === segment.id && <p role="alert" className="mt-2 text-xs text-red-600">{actionError.message}</p>}
        <div className="mt-3 flex items-center gap-2">
          {step && !locked && (
            <Button variant="primary" size="sm" loading={busy === segment.id} disabled={!!busy} onClick={() => void advance({ order, segment })} data-testid={`vendor-advance-${segment.id}`} className="min-h-[40px] flex-1">
              {t(step.en, step.ar)}
            </Button>
          )}
          <Button size="sm" onClick={() => setOpenId(order.id)} data-testid={`vendor-details-${order.id}`} className="min-h-[40px]">{t('Details', 'التفاصيل')}</Button>
        </div>
      </li>
    );
  };

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title={t('Incoming Orders', 'الطلبات الواردة')}
        subtitle={t('Each card is your part of an order. Tap the button on a card to move it forward; open Details for weights, prices, unavailable items or a rejection.', 'كل بطاقة هي الجزء الخاص بك من طلب. اضغط زر البطاقة لتقدّمها، وافتح التفاصيل للأوزان والأسعار والأصناف غير المتوفرة أو الرفض.')}
        actions={
          <>
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              <input type="checkbox" checked={soundEnabled} onChange={(e) => setSoundEnabled(e.target.checked)} data-testid="vendor-sound-toggle" />
              {t('Sound for new orders', 'صوت للطلبات الجديدة')}
            </label>
            {lastUpdatedAt && <span className="text-xs text-gray-500" data-testid="vendor-last-updated">{t('Updated', 'آخر تحديث')} {lastUpdatedAt.toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
            <Button onClick={refresh}>{t('Refresh', 'تحديث')}</Button>
          </>
        }
      />

      {newIds.size > 0 && (
        <div role="status" data-testid="vendor-new-orders" className="mb-3 flex items-center justify-between rounded-xl border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-900">
          <span>{locale === 'ar' ? `وصل ${newIds.size} طلب جديد` : `${newIds.size} new order${newIds.size === 1 ? '' : 's'} arrived`}</span>
          <button onClick={acknowledgeNew} className="font-medium underline">{t('Dismiss', 'إخفاء')}</button>
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}{' '}<button onClick={refresh} className="font-medium underline">{t('Retry', 'إعادة المحاولة')}</button>
        </div>
      )}
      {!error && orders === null && <p className="text-gray-500">{t('Loading...', 'جارٍ التحميل...')}</p>}
      {!error && orders !== null && orders.length === 0 && <Card><EmptyState title={t('No orders yet.', 'لا توجد طلبات بعد.')} /></Card>}

      {orders !== null && orders.length > 0 && (
        <>
          <div role="tablist" className="mb-3 flex gap-1 lg:hidden" data-testid="vendor-board-tabs">
            {COLUMNS.map((c) => (
              <button key={c.id} role="tab" aria-selected={mobileTab === c.id} onClick={() => setMobileTab(c.id)} className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-medium ${mobileTab === c.id ? 'bg-hatly-orange text-white' : 'border border-gray-200 bg-white text-gray-700'}`}>
                {t(c.en, c.ar)} <span className={`rounded-full px-1.5 text-xs tabular-nums ${mobileTab === c.id ? 'bg-white/25' : 'bg-gray-100 text-gray-600'}`}>{counts[c.id]}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-3" data-testid="vendor-board">
            {COLUMNS.map((c) => (
              <section key={c.id} aria-label={t(c.en, c.ar)} className={`${mobileTab === c.id ? 'block' : 'hidden'} lg:block rounded-2xl border p-3 ${c.tone}`} data-testid={`vendor-col-${c.id}`}>
                <h2 className="mb-2 hidden items-center justify-between text-sm font-semibold text-gray-800 lg:flex">
                  {t(c.en, c.ar)} <span className="rounded-full bg-white px-2 py-0.5 text-xs tabular-nums text-gray-600 ring-1 ring-gray-200">{counts[c.id]}</span>
                </h2>
                {byColumn(c.id).length === 0 ? (
                  <p className="rounded-xl bg-white/70 px-3 py-6 text-center text-sm text-gray-400">{c.id === 'new' ? t('Nothing is waiting for you.', 'لا شيء بانتظارك.') : t('Nothing here.', 'لا شيء هنا.')}</p>
                ) : (
                  <ul className="space-y-2.5">{byColumn(c.id).map(renderCard)}</ul>
                )}
              </section>
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            {other > 0 && <>{other} {t('part(s) are with the driver, finished or cancelled — see', 'جزءًا مع السائق أو منتهٍ أو ملغى — راجع')} </>}
            {other === 0 && <>{t('Looking for an older order? Use', 'تبحث عن طلب أقدم؟ استخدم')} </>}
            <Link href="/order-history" className="font-medium text-hatly-orangeDark hover:underline">{t('Order history', 'سجل الطلبات')}</Link>
          </p>
        </>
      )}

      <Drawer open={!!openId} onClose={() => setOpenId(null)} title={t('Order', 'طلب')} testId="vendor-drawer"
        header={<p className="truncate text-sm font-semibold text-gray-900">{t('Order', 'طلب')} {openId ? `#${openId.slice(0, 8)}` : ''}</p>}>
        {openId && <VendorOrderDetailView key={openId} id={openId} embedded onChanged={() => void refresh()} />}
      </Drawer>
    </div>
  );
}
