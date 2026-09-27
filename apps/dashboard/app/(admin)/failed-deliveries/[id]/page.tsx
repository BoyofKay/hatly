'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  AdminOrderDetail,
  CreateFailedDeliveryResolutionInput,
  FailedDeliveryResolutionRecord,
  createFailedDeliveryResolution,
  executeFailedDeliveryRefund,
  getAdminOrderDetail,
} from '../../../../lib/api/admin-failed-deliveries';

/**
 * Failed Delivery case detail, resolution, and refund execution
 * (Chunk 2d). Reuses the existing, unchanged `GET admin/orders/:id`
 * (Chunk 2a) for the full case view, `POST .../failed-delivery-
 * resolution` (Chunk 2b, terminal — no edit/delete), and
 * `POST .../failed-delivery-refund` (Chunk 2c, deliberately a
 * separate call, never combined with resolution creation).
 *
 * KNOWN LIMITATION (backend boundary respected, not fixed here): the
 * existing Admin Order Detail response does not include the
 * FailedDeliveryResolution record itself (it was built before that
 * entity existed) — so on a fresh page load for an ALREADY-resolved
 * order (reached by direct URL rather than from the queue, which
 * only ever lists genuinely unresolved cases), this page cannot know
 * in advance that a resolution already exists. It relies on: (a) the
 * queue itself only surfacing unresolved cases in the normal flow,
 * (b) the existing Financial Events list (already returned by the
 * unchanged detail endpoint) to show an already-executed refund
 * regardless, and (c) the backend's own existing terminal-resolution
 * guard surfacing a clear 409 if a second resolution is attempted.
 */
export default function FailedDeliveryDetailPage() {
  const params = useParams();
  const orderId = params.id as string;

  const [detail, setDetail] = useState<AdminOrderDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<FailedDeliveryResolutionRecord | null>(null);

  const [outcome, setOutcome] = useState<'RESOLVED_NO_REFUND' | 'REFUND_CUSTOMER'>('RESOLVED_NO_REFUND');
  const [refundAmount, setRefundAmount] = useState('');
  const [driverReviewNeeded, setDriverReviewNeeded] = useState(false);
  const [driverReviewNotes, setDriverReviewNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [refundResult, setRefundResult] = useState<'REFUNDED' | 'ALREADY_REFUNDED' | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [executingRefund, setExecutingRefund] = useState(false);

  async function refresh() {
    setDetailError(null);
    try {
      setDetail(await getAdminOrderDetail(orderId));
    } catch (err: any) {
      setDetailError(err?.response?.data?.message ?? 'Failed to load order.');
    }
  }

  useEffect(() => {
    if (orderId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const existingRefundEvent = detail?.financialEvents.find((e) => e.type === 'MANUAL_TRANSFER_REFUND_RECORDED');

  async function handleSubmitResolution() {
    setFormError(null);
    if (outcome === 'REFUND_CUSTOMER') {
      const amount = Number(refundAmount);
      if (!refundAmount || !Number.isInteger(amount) || amount <= 0) {
        setFormError('Refund amount is required and must be a positive integer (minor units).');
        return;
      }
    }
    setSubmitting(true);
    try {
      const input: CreateFailedDeliveryResolutionInput = {
        outcome,
        refundAmountMinor: outcome === 'REFUND_CUSTOMER' ? Number(refundAmount) : undefined,
        driverReviewNeeded,
        driverReviewNotes: driverReviewNotes || undefined,
        notes: notes || undefined,
      };
      const created = await createFailedDeliveryResolution(orderId, input);
      setResolution(created);
      await refresh();
    } catch (err: any) {
      setFormError(err?.response?.data?.message ?? 'Failed to record resolution.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExecuteRefund() {
    setRefundError(null);
    setExecutingRefund(true);
    try {
      const result = await executeFailedDeliveryRefund(orderId);
      setRefundResult(result.status);
      await refresh();
    } catch (err: any) {
      setRefundError(err?.response?.data?.message ?? 'Failed to execute refund.');
    } finally {
      setExecutingRefund(false);
    }
  }

  if (detailError) {
    return (
      <div className="mx-auto max-w-3xl rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {detailError}{' '}
        <button onClick={refresh} className="underline">
          Retry
        </button>
      </div>
    );
  }
  if (!detail) return <p className="mx-auto max-w-3xl text-gray-500">Loading...</p>;

  const alreadyRefunded = refundResult === 'ALREADY_REFUNDED' || refundResult === 'REFUNDED' || !!existingRefundEvent;
  const showRefundButton = (resolution?.outcome === 'REFUND_CUSTOMER') && !alreadyRefunded;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Failed Delivery — Order {detail.id.slice(0, 8)}</h1>

      <div className="rounded border bg-white p-4 text-sm">
        <p><span className="text-gray-500">Status:</span> {detail.status}</p>
        <p><span className="text-gray-500">Failed at:</span> {detail.failedAt ? new Date(detail.failedAt).toLocaleString() : '—'}</p>
        <p><span className="text-gray-500">Failure reason:</span> {detail.failureReason ?? '—'}</p>
        <p><span className="text-gray-500">Customer:</span> {detail.customer?.fullName ?? detail.customerId} {detail.customer?.phone ? `(${detail.customer.phone})` : ''}</p>
        <p><span className="text-gray-500">Driver:</span> {detail.driver?.fullName ?? '—'} {detail.driver?.phone ? `(${detail.driver.phone})` : ''}</p>
        <p><span className="text-gray-500">Total:</span> {detail.totalMinor != null ? (detail.totalMinor / 100).toFixed(2) : '—'}</p>
        <p><span className="text-gray-500">Payment:</span> {detail.paymentMethod}{detail.payment ? ` — ${detail.payment.status} (${(detail.payment.amountMinor ?? 0) / 100})` : ''}</p>
      </div>

      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="font-medium">Items</h2>
        {detail.segments.map((segment) => (
          <div key={segment.id} className="mt-2 border-t pt-2">
            <p className="text-xs text-gray-500">Segment {segment.id.slice(0, 8)} — {segment.groupType} — {segment.status}</p>
            {segment.items.map((item) => (
              <div key={item.id} className="mt-1">
                <p>
                  {item.productNameSnapshot ?? item.freeTextDescription ?? 'Custom item'} &times; {item.quantity}
                  {item.productId === null && (
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Custom Request</span>
                  )}
                </p>
                {item.productId === null && (
                  <p className="text-xs text-gray-500">
                    {item.unitPriceMinor == null && item.actualAmountMinor == null
                      ? 'Price pending'
                      : `Final amount: ${((item.actualAmountMinor ?? 0) / 100).toFixed(2)}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {(detail.driverCashRemainders.length > 0 || detail.adHocPurchaseRecords.length > 0) && (
        <div className="rounded border bg-white p-4 text-sm">
          {detail.driverCashRemainders.map((r) => (
            <p key={r.id}>Driver cash remainder: {(r.remainderAmountMinor / 100).toFixed(2)} — {r.status}</p>
          ))}
          {detail.adHocPurchaseRecords.map((r) => (
            <p key={r.id}>Custom item purchase: {(r.amountMinor / 100).toFixed(2)} — recorded by {r.recordedByRole}</p>
          ))}
        </div>
      )}

      <div className="rounded border bg-white p-4 text-sm">
        <h2 className="font-medium">Financial events</h2>
        {detail.financialEvents.length === 0 && <p className="text-gray-500">None.</p>}
        {detail.financialEvents.map((e) => (
          <p key={e.id}>
            {e.type} — {e.amountMinor != null ? (e.amountMinor / 100).toFixed(2) : '—'} ({e.direction})
          </p>
        ))}
      </div>

      {!resolution ? (
        <div className="rounded border bg-white p-4 text-sm">
          <h2 className="font-medium">Record resolution</h2>
          <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={outcome === 'RESOLVED_NO_REFUND'}
                onChange={() => setOutcome('RESOLVED_NO_REFUND')}
              />
              No refund
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={outcome === 'REFUND_CUSTOMER'}
                onChange={() => setOutcome('REFUND_CUSTOMER')}
              />
              Refund customer
            </label>
            {outcome === 'REFUND_CUSTOMER' && (
              <input
                type="number"
                min={1}
                step={1}
                placeholder="Refund amount (minor units)"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                className="rounded border px-2 py-1"
              />
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={driverReviewNeeded} onChange={(e) => setDriverReviewNeeded(e.target.checked)} />
              Driver review needed
            </label>
            {driverReviewNeeded && (
              <textarea
                placeholder="Driver review notes"
                value={driverReviewNotes}
                onChange={(e) => setDriverReviewNotes(e.target.value)}
                className="w-full rounded border px-2 py-1"
              />
            )}
            <textarea
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded border px-2 py-1"
            />
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <button
              onClick={handleSubmitResolution}
              disabled={submitting}
              className="rounded bg-hatly-orange px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Record resolution'}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded border bg-white p-4 text-sm">
          <h2 className="font-medium">Resolution recorded</h2>
          <p>Outcome: {resolution.outcome}</p>
          {resolution.refundAmountMinor != null && <p>Refund amount: {(resolution.refundAmountMinor / 100).toFixed(2)}</p>}
          {resolution.driverReviewNeeded && <p>Driver review needed{resolution.driverReviewNotes ? `: ${resolution.driverReviewNotes}` : ''}</p>}
          {resolution.notes && <p>Notes: {resolution.notes}</p>}

          {showRefundButton && (
            <div className="mt-3">
              <button
                onClick={handleExecuteRefund}
                disabled={executingRefund}
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {executingRefund ? 'Executing...' : 'Execute Refund'}
              </button>
              {refundError && <p className="mt-1 text-sm text-red-600">{refundError}</p>}
            </div>
          )}
          {alreadyRefunded && (
            <p className="mt-2 rounded bg-green-50 px-2 py-1 text-sm text-green-700">
              Refund {refundResult === 'ALREADY_REFUNDED' ? 'already recorded' : 'recorded'} successfully.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
