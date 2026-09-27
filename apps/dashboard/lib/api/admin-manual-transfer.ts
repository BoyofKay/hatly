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
