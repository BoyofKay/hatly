'use client';

import { useEffect, useState } from 'react';
import {
  ManualTransferPayment,
  approvePayment,
  listUnderReviewPayments,
  rejectPayment,
} from '../../../lib/api/admin-manual-transfer';

/**
 * Real Admin Manual Transfer verification — consumes the existing
 * Phase E backend exactly (`admin/manual-transfer-payments`). The
 * system never reads/processes the customer's screenshot — Admin
 * makes this decision entirely by judgment, matching the frozen
 * business rule. Approval/rejection are backend-authoritative: the
 * PaymentStateMachineService's own transition table (PAID/REJECTED
 * have no outgoing rule) is what actually prevents a double-decision,
 * not anything in this page.
 */
export default function ManualTransferPage() {
  const [payments, setPayments] = useState<ManualTransferPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});
  const [actionErrorById, setActionErrorById] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      setPayments(await listUnderReviewPayments());
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to load pending transfers.');
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleApprove(paymentId: string) {
    setSubmittingId(paymentId);
    setActionErrorById((prev) => ({ ...prev, [paymentId]: '' }));
    try {
      await approvePayment(paymentId);
      await refresh();
    } catch (err: any) {
      // Covers the "already PAID/REJECTED by another Admin" conflict —
      // the backend's own terminal-state guard, surfaced plainly.
      setActionErrorById((prev) => ({ ...prev, [paymentId]: err?.response?.data?.message ?? 'Failed to approve.' }));
      await refresh();
    } finally {
      setSubmittingId(null);
    }
  }

  async function handleReject(paymentId: string) {
    setSubmittingId(paymentId);
    setActionErrorById((prev) => ({ ...prev, [paymentId]: '' }));
    try {
      await rejectPayment(paymentId, rejectReasonById[paymentId] || undefined);
      await refresh();
    } catch (err: any) {
      setActionErrorById((prev) => ({ ...prev, [paymentId]: err?.response?.data?.message ?? 'Failed to reject.' }));
      await refresh();
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Manual Transfer Verification</h1>
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

      {!error && payments === null && <p className="mt-4 text-gray-500">Loading...</p>}
      {!error && payments !== null && payments.length === 0 && (
        <p className="mt-4 text-gray-500">No transfers awaiting review.</p>
      )}

      <div className="mt-4 space-y-3">
        {payments?.map((payment) => (
          <div key={payment.id} className="rounded border bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium">Order #{payment.orderId.slice(0, 8)}</span>
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{payment.status}</span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Method: {payment.method} &middot; Amount:{' '}
              {payment.amountMinor != null ? (payment.amountMinor / 100).toFixed(2) : 'not yet available'}
            </p>
            {payment.claimedAt && (
              <p className="text-xs text-gray-500">Customer claimed sent: {new Date(payment.claimedAt).toLocaleString()}</p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              InstaPay/Wallet choice is not recorded on the backend — check the customer&apos;s WhatsApp message for
              which one they used.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleApprove(payment.id)}
                disabled={submittingId === payment.id}
                className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                Approve
              </button>
              <input
                value={rejectReasonById[payment.id] ?? ''}
                onChange={(e) => setRejectReasonById((prev) => ({ ...prev, [payment.id]: e.target.value }))}
                placeholder="Rejection reason (optional)"
                className="rounded border px-2 py-1 text-sm"
              />
              <button
                onClick={() => handleReject(payment.id)}
                disabled={submittingId === payment.id}
                className="rounded bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
            {actionErrorById[payment.id] && (
              <p className="mt-1 text-sm text-red-600">{actionErrorById[payment.id]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
