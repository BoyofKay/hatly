import { apiClient } from './client';

/** Permissions the operations screens are gated on (display only — the backend enforces every endpoint). */
export const MANAGE_ORDER_FULFILMENT = 'MANAGE_ORDER_FULFILMENT';
export const MANAGE_VENDOR_COMMISSION = 'MANAGE_VENDOR_COMMISSION';
export const VERIFY_MANUAL_PAYMENTS = 'VERIFY_MANUAL_PAYMENTS';

export type SegmentTarget = 'CONFIRMED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'CANCELLED';

/** The transitions the backend's segment state machine allows, in the order they are offered. */
export const SEGMENT_NEXT_ACTIONS: Record<string, SegmentTarget[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['CANCELLED'],
};

/**
 * Hatly operations act on a vendor's behalf (`PATCH admin/orders/segments/:id/status`). The backend runs the SAME transition as the vendor
 * endpoint and records the actor and the on-behalf flag; a rejection (CANCELLED) needs a reason. The new state is always re-read afterwards.
 */
export async function updateSegmentOnBehalf(
  segmentId: string,
  body: { status: SegmentTarget; reason?: string; expectedReadyAt?: string },
): Promise<void> {
  await apiClient.patch(`/admin/orders/segments/${segmentId}/status`, body);
}

/** `PATCH admin/vendor-branches/:id/auto-accept` — the branch's acceptance mode (true = automatic). */
export async function setBranchAutoAccept(branchId: string, autoAcceptEnabled: boolean): Promise<void> {
  await apiClient.patch(`/admin/vendor-branches/${branchId}/auto-accept`, { autoAcceptEnabled });
}

export interface RefundToSend {
  eventId: string;
  orderId: string | null;
  orderNumber: string | null;
  paymentId: string | null;
  amountMinor: number;
  recordedAt: string;
  sentAt: string | null;
  sentByUserId: string | null;
  note: string | null;
}

export async function listManualTransferRefunds(sent?: boolean): Promise<RefundToSend[]> {
  const res = await apiClient.get('/admin/manual-transfer-payments/refunds', { params: sent === undefined ? {} : { sent } });
  return res.data.data;
}

/** Operations confirm the refund money was really sent. Once only (a repeat is a 409 REFUND_ALREADY_SENT). */
export async function markRefundSent(eventId: string, note?: string): Promise<void> {
  await apiClient.post(`/admin/manual-transfer-payments/refunds/${eventId}/mark-sent`, note ? { note } : {});
}
