import { apiClient } from './client';

/**
 * Mirrors the real `Payment` entity exactly (payments/entities/payment.entity.ts).
 * CONFIRMED: no InstaPay/Wallet distinction exists on the backend —
 * `method` is only ever `'MANUAL_TRANSFER'` here (this list is already
 * filtered to `UNDER_REVIEW`, all of which are manual transfers); that
 * sub-choice is only visible in the customer's WhatsApp message to
 * Admin, never a backend field. Not fabricated here.
 */
export interface ManualTransferPayment {
  id: string;
  orderId: string;
  method: string;
  status: string;
  amountMinor: number | null;
  claimedAt: string | null;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
}

export async function listUnderReviewPayments(): Promise<ManualTransferPayment[]> {
  const res = await apiClient.get('/admin/manual-transfer-payments');
  return res.data.data;
}

export async function approvePayment(paymentId: string): Promise<void> {
  await apiClient.post(`/admin/manual-transfer-payments/${paymentId}/approve`);
}

/** `reason` is optional on the backend — never required here either. */
export async function rejectPayment(paymentId: string, reason?: string): Promise<void> {
  await apiClient.post(`/admin/manual-transfer-payments/${paymentId}/reject`, reason ? { reason } : {});
}

/**
 * M3a (Launch-Readiness Gap Audit, G-25). Reuses the existing, unchanged
 * `POST admin/manual-transfer-payments/:id/refund` exactly — a manually
 * recorded refund against an already-PAID transfer (distinct from, and
 * never a replacement for, the automatic partial-cancellation refund
 * path or the separate Failed-Delivery refund endpoint). The backend
 * computes/validates everything (PAID-only, idempotent per paymentId);
 * this never recalculates an amount.
 */
export async function recordManualTransferRefund(paymentId: string, amountMinor: number, reason?: string): Promise<void> {
  await apiClient.post(`/admin/manual-transfer-payments/${paymentId}/refund`, reason ? { amountMinor, reason } : { amountMinor });
}
