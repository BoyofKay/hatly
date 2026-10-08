'use client';

import { useEffect, useState } from 'react';
import {
  DriverCashRemainder,
  approveCashRemainder,
  listPendingCashRemainders,
  rejectCashRemainder,
} from '../../../lib/api/admin-cash-remainders';
import { apiErrorMessage } from '../../../lib/api/errors';

/**
 * M3a (Launch-Readiness Gap Audit, G-09) — Driver Cash Remainder review.
 * Mirrors the Manual Transfer page's exact conventions (list + inline
 * per-row actions, no separate detail page — the backend's own `getOne`
 * returns nothing beyond what this list already shows, so a detail page
 * would add a route without adding information). Approve/reject are
 * backend-authoritative: the service's own PENDING_REVIEW-only guard is
 * what actually prevents a double-decision, not anything in this page.
 */
export default function CashRemaindersPage() {
  const [remainders, setRemainders] = useState<DriverCashRemainder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});
  const [actionErrorById, setActionErrorById] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setRemainders(await listPendingCashRemainders());
    } catch (err: any) {
      setError(apiErrorMessage(err, 'Failed to load cash remainders.'));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleApprove(remainder: DriverCashRemainder) {
    if (submittingId) return;
    const confirmed = window.confirm(
      `Approve this driver cash remainder of ${(remainder.remainderAmountMinor / 100).toFixed(2)}? ` +
        'This credits the customer wallet immediately and cannot be undone.',
    );
    if (!confirmed) return;

    setSubmittingId(remainder.id);
    setActionErrorById((prev) => ({ ...prev, [remainder.id]: '' }));
    try {
      await approveCashRemainder(remainder.id);
      await refresh();
    } catch (err: any) {
      setActionErrorById((prev) => ({ ...prev, [remainder.id]: apiErrorMessage(err, 'Failed to approve.' )}));
      await refresh();
    } finally {
      setSubmittingId(null);
    }
  }

  async function handleReject(remainder: DriverCashRemainder) {
    if (submittingId) return;
    const reason = rejectReasonById[remainder.id]?.trim();
    if (!reason) {
      setActionErrorById((prev) => ({ ...prev, [remainder.id]: 'A rejection reason is required.' }));
      return;
    }
    const confirmed = window.confirm('Reject this driver cash remainder claim? This cannot be undone.');
    if (!confirmed) return;

    setSubmittingId(remainder.id);
    setActionErrorById((prev) => ({ ...prev, [remainder.id]: '' }));
    try {
      await rejectCashRemainder(remainder.id, reason);
      await refresh();
    } catch (err: any) {
      setActionErrorById((prev) => ({ ...prev, [remainder.id]: apiErrorMessage(err, 'Failed to reject.' )}));
      await refresh();
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Driver Cash Remainders</h1>
        <button onClick={refresh} className="text-sm text-gray-500 underline">
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}{' '}
          <button onClick={refresh} className="underline">
            Retry
          </button>
        </div>
      )}

      {!error && remainders === null && <p className="mt-4 text-gray-500">Loading...</p>}
      {!error && remainders !== null && remainders.length === 0 && (
        <p className="mt-4 text-gray-500">No cash remainders awaiting review.</p>
      )}

      <div className="mt-4 space-y-3">
        {remainders?.map((remainder) => (
          <div key={remainder.id} className="rounded border bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Order #{remainder.orderId.slice(0, 8)}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{remainder.status}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Driver #{remainder.driverId.slice(0, 8)} &middot; Remainder:{' '}
              {(remainder.remainderAmountMinor / 100).toFixed(2)}
            </p>
            <p className="text-xs text-gray-500">Submitted: {new Date(remainder.submittedAt).toLocaleString()}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleApprove(remainder)}
                disabled={submittingId === remainder.id}
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Approve
              </button>
              <input
                value={rejectReasonById[remainder.id] ?? ''}
                onChange={(e) => setRejectReasonById((prev) => ({ ...prev, [remainder.id]: e.target.value }))}
                placeholder="Rejection reason (required to reject)"
                className="rounded border px-2 py-1 text-sm"
              />
              <button
                onClick={() => handleReject(remainder)}
                disabled={submittingId === remainder.id}
                className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
            {actionErrorById[remainder.id] && (
              <p className="mt-1 text-sm text-red-600">{actionErrorById[remainder.id]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
