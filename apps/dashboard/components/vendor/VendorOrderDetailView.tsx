'use client';
import { parseKgToGrams } from '../../lib/money';

import { useEffect, useRef, useState } from 'react';
import {
  VendorOrder,
  VendorOrderSegment,
  getVendorOrder,
  priceCustomItem,
  recordItemWeight,
  updateSegmentStatus,
} from '../../lib/api/vendor-orders';
import { apiErrorMessage } from '../../lib/api/errors';
import { markOrderCollected } from '../../lib/api/order-collection';
import { UnavailableItemsControl } from '../../components/vendor/UnavailableItemsControl';
import { useLang } from '../../lib/ui/lang';

/**
 * CONFIRMED (closed rule — segment lifecycle is authoritative,
 * mirrored here only for which BUTTONS to show, never enforced
 * client-side): PENDING -> CONFIRMED | CANCELLED; CONFIRMED ->
 * PREPARING | CANCELLED; PREPARING -> READY_FOR_PICKUP | CANCELLED;
 * READY_FOR_PICKUP -> CANCELLED only. The backend's own transition
 * table (order-vendor-segment-state-machine.service.ts) is the sole
 * authority — an invalid attempt is rejected there regardless of what
 * this map shows.
 */
const SEGMENT_NEXT_ACTIONS: Record<string, { label: [string, string]; to: VendorOrderSegment['status'] }[]> = {
  PENDING: [
    { label: ['Confirm', 'قبول الطلب'], to: 'CONFIRMED' },
    { label: ['Cancel', 'إلغاء'], to: 'CANCELLED' },
  ],
  CONFIRMED: [
    { label: ['Start Preparing', 'بدء التحضير'], to: 'PREPARING' },
    { label: ['Cancel', 'إلغاء'], to: 'CANCELLED' },
  ],
  PREPARING: [
    { label: ['Mark Ready for Pickup', 'جاهز للاستلام'], to: 'READY_FOR_PICKUP' },
    { label: ['Cancel', 'إلغاء'], to: 'CANCELLED' },
  ],
  READY_FOR_PICKUP: [{ label: ['Cancel', 'إلغاء'], to: 'CANCELLED' }],
};

/**
 * Once the ORDER has moved past the vendor (picked up by a driver, collected by the customer — U2 — or finished), the
 * backend locks every segment (order-vendor-segment-state-machine.service.ts, SEGMENT_LOCKED_ORDER_STATUSES): a segment
 * still reading READY_FOR_PICKUP offers no action then, instead of a "Cancel" the backend would refuse.
 */
const SEGMENT_LOCKED_ORDER_STATUSES = ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'COLLECTED', 'CANCELLED', 'FAILED_DELIVERY'];

/** The vendor's own order view: the full page (`/orders/:id`) and the quick-view drawer on the incoming-orders board share this body. */
export function VendorOrderDetailView({ id, embedded = false, onChanged }: { id: string; embedded?: boolean; onChanged?: () => void }) {
  const { t } = useLang();
  const loadedOnce = useRef(false);
  const [order, setOrder] = useState<VendorOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [weightInputs, setWeightInputs] = useState<Record<string, string>>({});
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [pricingItemId, setPricingItemId] = useState<string | null>(null);
  // Reliability & Adversarial Testing milestone (client-level): mirrors the SAME guard
  // `pricingItemId` already provides for `handleSetPrice` below — without it, a double-click on a
  // segment action button fires the same transition twice; the backend correctly rejects the
  // second (stale, already-applied) attempt, but the vendor then sees a scary "Failed to update
  // status" error for an action that, from their perspective, already succeeded on the first click.
  const [pendingSegmentId, setPendingSegmentId] = useState<string | null>(null);
  const [rejectingSegmentId, setRejectingSegmentId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [recordingWeightItemId, setRecordingWeightItemId] = useState<string | null>(null);
  // The `useState` guards above are for RENDERING only (disabled attribute / "Saving..." text) —
  // `setState` doesn't take effect until the next render, so two click handlers fired back-to-back
  // in the SAME tick (a real fast double-click, or two Playwright clicks close enough together)
  // can both read the same stale (pre-update) state value and both pass the check. `useRef` updates
  // are synchronous and visible immediately to the very next handler invocation, so the actual
  // re-entrancy guard lives here; the state variables just drive what's on screen.
  const pendingSegmentRef = useRef<string | null>(null);
  const recordingWeightRef = useRef<string | null>(null);
  const pricingRef = useRef<string | null>(null);
  // U2 — "the customer collected it" (pickup orders). Same ref + state double-click guard as the actions above.
  const [collecting, setCollecting] = useState(false);
  const [collectedMessage, setCollectedMessage] = useState<string | null>(null);
  const collectingRef = useRef(false);

  async function refresh() {
    setError(null);
    try {
      setOrder(await getVendorOrder(id));
      if (loadedOnce.current) onChanged?.(); // a reload after an action tells the board behind the drawer to catch up
      loadedOnce.current = true;
    } catch (err: any) {
      setError(apiErrorMessage(err, t('Failed to load order.', 'تعذّر تحميل الطلب.')));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSegmentAction(segmentId: string, to: VendorOrderSegment['status'], reason?: string) {
    if (pendingSegmentRef.current === segmentId) return; // already mid-flight for this segment — ignore the duplicate tap
    // Rejecting (CANCELLED) is the one destructive transition here and needs a reason (shown to the customer, kept in the history): it is
    // collected by the inline form below, never by a bare confirm.
    if (to === 'CANCELLED' && !reason?.trim()) {
      setActionError(t('Enter the reason for rejecting this order.', 'اكتب سبب رفض هذا الطلب.'));
      return;
    }
    pendingSegmentRef.current = segmentId;
    setActionError(null);
    setPendingSegmentId(segmentId);
    try {
      await updateSegmentStatus(segmentId, to, reason?.trim());
      setRejectingSegmentId(null);
      setRejectReason('');
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t('Failed to update status.', 'تعذّر تحديث الحالة.')));
    } finally {
      pendingSegmentRef.current = null;
      setPendingSegmentId(null);
    }
  }

  async function handleRecordWeight(itemId: string) {
    if (recordingWeightRef.current === itemId) return; // already mid-flight for this item — ignore the duplicate tap
    setActionError(null);
    const raw = weightInputs[itemId];
    const grams = raw ? parseKgToGrams(raw.trim()) : null;
    if (grams === null || grams <= 0) {
      setActionError(t('Enter the actual weight in kg, e.g. 1.25.', 'أدخل الوزن الفعلي بالكيلو، مثل 1.25.'));
      return;
    }
    recordingWeightRef.current = itemId;
    setRecordingWeightItemId(itemId);
    try {
      await recordItemWeight(itemId, grams);
      await refresh();
    } catch (err: any) {
      // Covers the first-actor-wins rejection (e.g. already recorded
      // by the driver) as a normal, expected outcome — not a crash.
      setActionError(apiErrorMessage(err, t('Failed to record weight — it may already be recorded.', 'تعذّر تسجيل الوزن — ربما سُجّل من قبل.')));
    } finally {
      recordingWeightRef.current = null;
      setRecordingWeightItemId(null);
    }
  }

  async function handleSetPrice(itemId: string) {
    if (pricingRef.current === itemId) return; // already mid-flight for this item — ignore the duplicate tap (same class of guard as the two handlers above)
    setActionError(null);
    const raw = priceInputs[itemId];
    // Vendor enters the normal currency unit (e.g. EGP); converted to
    // minor units the same way every other amount in this dashboard
    // is displayed (amountMinor / 100), just inverted — an
    // integer-safe round, never raw floating-point cents math.
    const majorAmount = Number(raw);
    if (!raw || Number.isNaN(majorAmount) || majorAmount <= 0) {
      setActionError(t('Enter a valid price.', 'أدخل سعرًا صحيحًا.'));
      return;
    }
    const amountMinor = Math.round(majorAmount * 100);
    pricingRef.current = itemId;
    setPricingItemId(itemId);
    try {
      await priceCustomItem(itemId, amountMinor);
      // No local pricing-state flag is set here — the refreshed
      // order's own `item.actualAmountMinor` (Chunk 4C) is the sole
      // source of truth driving the pending/priced UI split below.
      await refresh();
    } catch (err: any) {
      // Whether this is a genuine validation failure or the item was
      // already priced in a previous session, the refreshed
      // `actualAmountMinor` (not a local flag) is what determines the
      // correct UI state afterward.
      setActionError(apiErrorMessage(err, t('Failed to save price.', 'تعذّر حفظ السعر.')));
      await refresh();
    } finally {
      pricingRef.current = null;
      setPricingItemId(null);
    }
  }

  async function handleCollected() {
    if (collectingRef.current || !order) return;
    if (!window.confirm(t('Confirm the customer has collected this order at the counter? This completes the order and cannot be undone.', 'هل تؤكد أن العميل استلم هذا الطلب من الفرع؟ سيكتمل الطلب ولا يمكن التراجع.'))) return;
    collectingRef.current = true;
    setCollecting(true);
    setActionError(null);
    setCollectedMessage(null);
    try {
      await markOrderCollected(order.id);
      setCollectedMessage(t('Order marked as collected.', 'تم تسجيل الطلب كمُستلَم.'));
    } catch (err: any) {
      setActionError(apiErrorMessage(err, t('Failed to mark the order as collected.', 'تعذّر تسجيل الاستلام.')));
    } finally {
      await refresh(); // always re-read: the order may have been collected or cancelled by someone else meanwhile
      collectingRef.current = false;
      setCollecting(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <button onClick={refresh} className="underline">
          {t('Retry', 'إعادة المحاولة')}
        </button>
      </div>
    );
  }
  if (!order) return <p className="text-gray-500">{t('Loading...', 'جارٍ التحميل...')}</p>;
  const segmentActions = (status: string) =>
    SEGMENT_LOCKED_ORDER_STATUSES.includes(order.status) ? [] : SEGMENT_NEXT_ACTIONS[status] ?? [];

  return (
    <div className={embedded ? "space-y-4" : "max-w-4xl space-y-5"} data-testid={embedded ? "vendor-drawer-body" : undefined}>
      <div className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">{t('Order', 'طلب')} <bdi dir="ltr">{order.orderNumber ?? `#${order.id.slice(0, 8)}`}</bdi></h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('Order status:', 'حالة الطلب:')} <span data-testid="vendor-order-status">{order.status}</span>
          {order.fulfillmentType === 'PICKUP'
            ? t(' (pickup — the customer collects it at your branch)', ' (استلام — يستلمه العميل من فرعك)')
            : t(' (read-only — set by dispatch/delivery, not by this dashboard)', ' (للعرض فقط — يحدده التوزيع والتوصيل وليس هذه اللوحة)')}{' '}
          &middot; {order.paymentMethod}
        </p>
        {order.orderNote && <p className="mt-2 text-sm">{t('Note:', 'ملاحظة:')} {order.orderNote}</p>}
      </div>

      {order.fulfillmentType === 'PICKUP' && order.status === 'READY_FOR_PICKUP' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4" data-testid="vendor-pickup-ready">
          <p className="text-sm font-medium text-green-900">{t('Ready — waiting for the customer to collect it at the counter.', 'جاهز — بانتظار أن يستلمه العميل من الفرع.')}</p>
          {order.paymentMethod === 'COD' && <p className="mt-1 text-sm text-green-900">{t('The customer pays you in cash when collecting.', 'يدفع العميل لك نقدًا عند الاستلام.')}</p>}
          <button
            data-testid="vendor-mark-collected"
            onClick={handleCollected}
            disabled={collecting}
            className="mt-3 rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {collecting ? t('Saving...', 'جارٍ الحفظ...') : t('Customer collected the order', 'العميل استلم الطلب')}
          </button>
        </div>
      )}
      {order.status === 'COLLECTED' && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900" data-testid="vendor-order-collected" role="status">
          {collectedMessage ?? t('Collected by the customer — this order is complete.', 'استلمه العميل — اكتمل هذا الطلب.')}
        </div>
      )}

      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>
      )}

      {order.segments.map((segment) => (
        <div key={segment.id} className="rounded-xl border bg-white p-4 border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t('Your items — status:', 'أصنافك — الحالة:')} {segment.status}</h2>
            {segment.subtotalMinor != null && (
              <span className="text-sm text-gray-600">{(segment.subtotalMinor / 100).toFixed(2)}</span>
            )}
          </div>
          {segment.vendorNoteSnapshot && (
            <p className="mt-1 text-sm text-gray-500">{t('Note:', 'ملاحظة:')} {segment.vendorNoteSnapshot}</p>
          )}

          <ul className="mt-3 divide-y">
            {segment.items.map((item) => {
              const isWeighted = item.pricingUnitSnapshot === 'WEIGHT';
              const alreadyRecorded = item.actualWeightGrams != null;
              return (
                <li key={item.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      {item.productNameSnapshot ?? item.freeTextDescriptionSnapshot ?? t('Item', 'صنف')}
                      {!isWeighted && ` x${item.quantity}`}
                    </span>
                    {item.unitPriceMinor != null && (
                      <span className="text-sm text-gray-600">
                        {(item.unitPriceMinor / 100).toFixed(2)}
                        {isWeighted ? t(' / kg', ' / كجم') : ''}
                      </span>
                    )}
                  </div>
                  {item.notes && <p className="text-xs text-gray-500">{t('Note:', 'ملاحظة:')} {item.notes}</p>}

                  {item.productId === null && (() => {
                    const pricedAmountMinor = item.actualAmountMinor;
                    const isPriced = pricedAmountMinor != null;
                    return (
                      <div className="mt-1 rounded bg-blue-50 p-2 text-sm">
                        <p className="text-xs font-medium text-blue-800">{t('Custom Request', 'طلب مخصّص')}</p>
                        {item.imageUrlsSnapshot && item.imageUrlsSnapshot.length > 0 && (
                          <div className="mt-1 flex gap-2">
                            {item.imageUrlsSnapshot.map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={url} src={url} alt={t('Custom request', 'طلب مخصّص')} className="h-16 w-16 rounded object-cover" />
                            ))}
                          </div>
                        )}
                        {isPriced ? (
                          <p className="mt-1 text-green-700">
                            {t('Final price:', 'السعر النهائي:')} {(pricedAmountMinor! / 100).toFixed(2)}
                          </p>
                        ) : (
                          <>
                            <p className="mt-1 text-gray-600">{t('Price pending', 'السعر معلّق')}</p>
                            <div className="mt-1 flex gap-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder={t('Price', 'السعر')}
                                value={priceInputs[item.id] ?? ''}
                                onChange={(e) => setPriceInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-32 rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
                              />
                              <button
                                onClick={() => handleSetPrice(item.id)}
                                disabled={pricingItemId === item.id}
                                className="rounded-lg bg-hatly-orange px-3 py-1 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
                              >
                                {pricingItemId === item.id ? t('Saving...', 'جارٍ الحفظ...') : t('Set Price', 'تحديد السعر')}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  {isWeighted && (
                    <div className="mt-1 rounded bg-amber-50 p-2 text-sm">
                      <p>
                        {t('Requested:', 'المطلوب:')}{' '}
                        {item.requestedWeightGrams != null ? `${(item.requestedWeightGrams / 1000).toFixed(2)} ${t('kg', 'كجم')}` : '—'}
                      </p>
                      {alreadyRecorded ? (
                        <p className="text-green-700">
                          {t('Actual weight recorded:', 'الوزن الفعلي المسجّل:')} {(item.actualWeightGrams! / 1000).toFixed(2)} {t('kg', 'كجم')}
                        </p>
                      ) : (
                        <div className="mt-1 flex gap-2">
                          <input
                            inputMode="decimal"
                            dir="ltr"
                            placeholder={t('Actual weight (kg), e.g. 1.25', 'الوزن الفعلي (كجم)، مثل 1.25')}
                            value={weightInputs[item.id] ?? ''}
                            onChange={(e) => setWeightInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            className="w-40 rounded-lg border px-2 py-1 text-sm border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
                          />
                          <button
                            onClick={() => handleRecordWeight(item.id)}
                            disabled={recordingWeightItemId === item.id}
                            className="rounded-lg bg-hatly-orange px-3 py-1 text-sm font-medium text-white disabled:opacity-50 shadow-sm hover:bg-hatly-orangeDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40"
                          >
                            {recordingWeightItemId === item.id ? t('Saving...', 'جارٍ الحفظ...') : t('Record Weight', 'تسجيل الوزن')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <UnavailableItemsControl segment={segment} onDone={refresh} />

          <div className="mt-3 flex gap-2">
            {segmentActions(segment.status).map((action) => (
              <button
                key={action.to}
                data-testid={`vendor-segment-action-${action.to}`}
                onClick={() => (action.to === 'CANCELLED' ? setRejectingSegmentId(segment.id) : handleSegmentAction(segment.id, action.to))}
                disabled={pendingSegmentId === segment.id}
                className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  action.to === 'CANCELLED' ? 'bg-gray-200 text-gray-700' : 'bg-hatly-orange text-white'
                }`}
              >
                {pendingSegmentId === segment.id ? t('Saving...', 'جارٍ الحفظ...') : t(action.label[0], action.label[1])}
              </button>
            ))}
            {segmentActions(segment.status).length === 0 && (
              <span className="text-sm text-gray-500">{t('No further action available.', 'لا يوجد إجراء إضافي.')}</span>
            )}
          </div>

          {rejectingSegmentId === segment.id && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3" data-testid="vendor-reject-form">
              <label className="block text-sm font-medium text-red-900">
                {t('Why are you rejecting this order? (required — the customer is told)', 'لماذا ترفض هذا الطلب؟ (مطلوب — يُبلَّغ العميل)')}
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                  data-testid="vendor-reject-reason"
                  className="mt-1 w-full rounded-lg border px-2 py-1 text-sm font-normal border-gray-300 bg-white shadow-sm focus:border-hatly-orange focus:outline-none focus:ring-2 focus:ring-hatly-orange/30 disabled:bg-gray-100"
                />
              </label>
              <p className="mt-1 text-xs text-red-800">{t('This cannot be undone. The customer is refunded for your items.', 'لا يمكن التراجع. يُردّ للعميل ثمن أصنافك.')}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="vendor-reject-confirm"
                  disabled={pendingSegmentId === segment.id}
                  onClick={() => handleSegmentAction(segment.id, 'CANCELLED', rejectReason)}
                  className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {t('Reject order', 'رفض الطلب')}
                </button>
                <button type="button" onClick={() => { setRejectingSegmentId(null); setActionError(null); }} className="rounded-lg border px-3 py-1.5 text-sm border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hatly-orange/40">
                  {t('Keep order', 'الاحتفاظ بالطلب')}
                </button>
              </div>
            </div>
          )}

          {(segment.history?.length ?? 0) > 0 && (
            <div className="mt-3" data-testid="vendor-segment-history">
              <p className="text-xs font-medium uppercase text-gray-500">{t('History', 'السجل')}</p>
              <ol className="mt-1 space-y-0.5 text-xs text-gray-700">
                {segment.history!.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">
                      {h.fromStatus ? `${h.fromStatus.replace(/_/g, ' ')} → ` : ''}
                      {h.toStatus.replace(/_/g, ' ')}
                    </span>{' '}
                    — {new Date(h.at).toLocaleString()} ·{' '}
                    {h.onBehalfOfVendor ? (
                      <span className="rounded bg-amber-100 px-1 text-amber-900" data-testid="vendor-on-behalf-label">
                        {t('Hatly operations, on your behalf', 'عمليات هاتلي نيابةً عنك')}
                      </span>
                    ) : h.actorRole === 'SYSTEM' ? (
                      t('Automatic', 'تلقائي')
                    ) : (
                      t('Your team', 'فريقك')
                    )}
                    {h.reason && <span className="text-gray-600"> — {h.reason}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
