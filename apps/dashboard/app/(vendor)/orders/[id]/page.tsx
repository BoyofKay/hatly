'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  VendorOrder,
  VendorOrderSegment,
  getVendorOrder,
  priceCustomItem,
  recordItemWeight,
  updateSegmentStatus,
} from '../../../../lib/api/vendor-orders';
import { apiErrorMessage } from '../../../../lib/api/errors';
import { markOrderCollected } from '../../../../lib/api/order-collection';

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
const SEGMENT_NEXT_ACTIONS: Record<string, { label: string; to: VendorOrderSegment['status'] }[]> = {
  PENDING: [
    { label: 'Confirm', to: 'CONFIRMED' },
    { label: 'Cancel', to: 'CANCELLED' },
  ],
  CONFIRMED: [
    { label: 'Start Preparing', to: 'PREPARING' },
    { label: 'Cancel', to: 'CANCELLED' },
  ],
  PREPARING: [
    { label: 'Mark Ready for Pickup', to: 'READY_FOR_PICKUP' },
    { label: 'Cancel', to: 'CANCELLED' },
  ],
  READY_FOR_PICKUP: [{ label: 'Cancel', to: 'CANCELLED' }],
};

/**
 * Once the ORDER has moved past the vendor (picked up by a driver, collected by the customer — U2 — or finished), the
 * backend locks every segment (order-vendor-segment-state-machine.service.ts, SEGMENT_LOCKED_ORDER_STATUSES): a segment
 * still reading READY_FOR_PICKUP offers no action then, instead of a "Cancel" the backend would refuse.
 */
const SEGMENT_LOCKED_ORDER_STATUSES = ['PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'COLLECTED', 'CANCELLED', 'FAILED_DELIVERY'];

export default function VendorOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
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
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load order.'));
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSegmentAction(segmentId: string, to: VendorOrderSegment['status']) {
    if (pendingSegmentRef.current === segmentId) return; // already mid-flight for this segment — ignore the duplicate tap
    // M3a (Launch-Readiness Gap Audit, G-12) — cancelling is the one destructive transition here
    // (every other transition in SEGMENT_NEXT_ACTIONS is a normal forward step); confirm before
    // sending, never after.
    if (to === 'CANCELLED' && !window.confirm('Cancel your items on this order? This cannot be undone.')) {
      return;
    }
    pendingSegmentRef.current = segmentId;
    setActionError(null);
    setPendingSegmentId(segmentId);
    try {
      await updateSegmentStatus(segmentId, to);
      await refresh();
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to update status.'));
    } finally {
      pendingSegmentRef.current = null;
      setPendingSegmentId(null);
    }
  }

  async function handleRecordWeight(itemId: string) {
    if (recordingWeightRef.current === itemId) return; // already mid-flight for this item — ignore the duplicate tap
    setActionError(null);
    const raw = weightInputs[itemId];
    const grams = Number(raw);
    if (!raw || Number.isNaN(grams) || grams <= 0) {
      setActionError('Enter a valid weight in grams.');
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
      setActionError(apiErrorMessage(err, 'Failed to record weight — it may already be recorded.'));
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
      setActionError('Enter a valid price.');
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
      setActionError(apiErrorMessage(err, 'Failed to save price.'));
      await refresh();
    } finally {
      pricingRef.current = null;
      setPricingItemId(null);
    }
  }

  async function handleCollected() {
    if (collectingRef.current || !order) return;
    if (!window.confirm('Confirm the customer has collected this order at the counter? This completes the order and cannot be undone.')) return;
    collectingRef.current = true;
    setCollecting(true);
    setActionError(null);
    setCollectedMessage(null);
    try {
      await markOrderCollected(order.id);
      setCollectedMessage('Order marked as collected.');
    } catch (err: any) {
      setActionError(apiErrorMessage(err, 'Failed to mark the order as collected.'));
    } finally {
      await refresh(); // always re-read: the order may have been collected or cancelled by someone else meanwhile
      collectingRef.current = false;
      setCollecting(false);
    }
  }

  if (error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}{' '}
        <button onClick={refresh} className="underline">
          Retry
        </button>
      </div>
    );
  }
  if (!order) return <p className="text-gray-500">Loading...</p>;
  const segmentActions = (status: string) =>
    SEGMENT_LOCKED_ORDER_STATUSES.includes(order.status) ? [] : SEGMENT_NEXT_ACTIONS[status] ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded border bg-white p-4">
        <h1 className="text-xl font-semibold">Order #{order.id.slice(0, 8)}</h1>
        <p className="mt-1 text-sm text-gray-500">
          Order status: <span data-testid="vendor-order-status">{order.status}</span>
          {order.fulfillmentType === 'PICKUP'
            ? ' (pickup — the customer collects it at your branch)'
            : ' (read-only — set by dispatch/delivery, not by this dashboard)'}{' '}
          &middot; {order.paymentMethod}
        </p>
        {order.orderNote && <p className="mt-2 text-sm">Note: {order.orderNote}</p>}
      </div>

      {order.fulfillmentType === 'PICKUP' && order.status === 'READY_FOR_PICKUP' && (
        <div className="rounded border border-green-200 bg-green-50 p-4" data-testid="vendor-pickup-ready">
          <p className="text-sm font-medium text-green-900">Ready — waiting for the customer to collect it at the counter.</p>
          {order.paymentMethod === 'COD' && <p className="mt-1 text-sm text-green-900">The customer pays you in cash when collecting.</p>}
          <button
            data-testid="vendor-mark-collected"
            onClick={handleCollected}
            disabled={collecting}
            className="mt-3 rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {collecting ? 'Saving...' : 'Customer collected the order'}
          </button>
        </div>
      )}
      {order.status === 'COLLECTED' && (
        <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900" data-testid="vendor-order-collected" role="status">
          {collectedMessage ?? 'Collected by the customer — this order is complete.'}
        </div>
      )}

      {actionError && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{actionError}</div>
      )}

      {order.segments.map((segment) => (
        <div key={segment.id} className="rounded border bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Your items — status: {segment.status}</h2>
            {segment.subtotalMinor != null && (
              <span className="text-sm text-gray-600">{(segment.subtotalMinor / 100).toFixed(2)}</span>
            )}
          </div>
          {segment.vendorNoteSnapshot && (
            <p className="mt-1 text-sm text-gray-500">Note: {segment.vendorNoteSnapshot}</p>
          )}

          <ul className="mt-3 divide-y">
            {segment.items.map((item) => {
              const isWeighted = item.pricingUnitSnapshot === 'WEIGHT';
              const alreadyRecorded = item.actualWeightGrams != null;
              return (
                <li key={item.id} className="py-2">
                  <div className="flex items-center justify-between">
                    <span>
                      {item.productNameSnapshot ?? item.freeTextDescriptionSnapshot ?? 'Item'}
                      {!isWeighted && ` x${item.quantity}`}
                    </span>
                    {item.unitPriceMinor != null && (
                      <span className="text-sm text-gray-600">
                        {(item.unitPriceMinor / 100).toFixed(2)}
                        {isWeighted ? ' / kg' : ''}
                      </span>
                    )}
                  </div>
                  {item.notes && <p className="text-xs text-gray-500">Note: {item.notes}</p>}

                  {item.productId === null && (() => {
                    const pricedAmountMinor = item.actualAmountMinor;
                    const isPriced = pricedAmountMinor != null;
                    return (
                      <div className="mt-1 rounded bg-blue-50 p-2 text-sm">
                        <p className="text-xs font-medium text-blue-800">Custom Request</p>
                        {item.imageUrlsSnapshot && item.imageUrlsSnapshot.length > 0 && (
                          <div className="mt-1 flex gap-2">
                            {item.imageUrlsSnapshot.map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={url} src={url} alt="Custom request" className="h-16 w-16 rounded object-cover" />
                            ))}
                          </div>
                        )}
                        {isPriced ? (
                          <p className="mt-1 text-green-700">
                            Final price: {(pricedAmountMinor! / 100).toFixed(2)}
                          </p>
                        ) : (
                          <>
                            <p className="mt-1 text-gray-600">Price pending</p>
                            <div className="mt-1 flex gap-2">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Price"
                                value={priceInputs[item.id] ?? ''}
                                onChange={(e) => setPriceInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-32 rounded border px-2 py-1 text-sm"
                              />
                              <button
                                onClick={() => handleSetPrice(item.id)}
                                disabled={pricingItemId === item.id}
                                className="rounded bg-hatly-orange px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                              >
                                {pricingItemId === item.id ? 'Saving...' : 'Set Price'}
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
                        Requested:{' '}
                        {item.requestedWeightGrams != null ? `${(item.requestedWeightGrams / 1000).toFixed(2)} kg` : '—'}
                      </p>
                      {alreadyRecorded ? (
                        <p className="text-green-700">
                          Actual weight recorded: {(item.actualWeightGrams! / 1000).toFixed(2)} kg
                        </p>
                      ) : (
                        <div className="mt-1 flex gap-2">
                          <input
                            type="number"
                            placeholder="Actual weight (grams)"
                            value={weightInputs[item.id] ?? ''}
                            onChange={(e) => setWeightInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            className="w-40 rounded border px-2 py-1 text-sm"
                          />
                          <button
                            onClick={() => handleRecordWeight(item.id)}
                            disabled={recordingWeightItemId === item.id}
                            className="rounded bg-hatly-orange px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {recordingWeightItemId === item.id ? 'Saving...' : 'Record Weight'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex gap-2">
            {segmentActions(segment.status).map((action) => (
              <button
                key={action.to}
                onClick={() => handleSegmentAction(segment.id, action.to)}
                disabled={pendingSegmentId === segment.id}
                className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                  action.to === 'CANCELLED' ? 'bg-gray-200 text-gray-700' : 'bg-hatly-orange text-white'
                }`}
              >
                {pendingSegmentId === segment.id ? 'Saving...' : action.label}
              </button>
            ))}
            {segmentActions(segment.status).length === 0 && (
              <span className="text-sm text-gray-500">No further action available.</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
