import { apiClient } from './client';

/** Mirrors the real backend `DriverCashRemainder` entity exactly (driver-cash-remainder/entities/driver-cash-remainder.entity.ts). */
export interface DriverCashRemainder {
  id: string;
  orderId: string;
  deliveryId: string;
  driverId: string;
  customerId: string;
  remainderAmountMinor: number;
  status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  submittedAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  rejectionReason: string | null;
}

/** M3a (Launch-Readiness Gap Audit, G-09). Reuses the existing, unchanged `admin/cash-remainders` endpoints exactly. */
export async function listPendingCashRemainders(): Promise<DriverCashRemainder[]> {
  const res = await apiClient.get('/admin/cash-remainders');
  return res.data.data;
}

export async function approveCashRemainder(id: string): Promise<DriverCashRemainder> {
  const res = await apiClient.patch(`/admin/cash-remainders/${id}/approve`);
  return res.data.data;
}

/** `reason` is REQUIRED by the backend's own `RejectCashRemainderDto` (MinLength(1)) — never optional here either. */
export async function rejectCashRemainder(id: string, reason: string): Promise<DriverCashRemainder> {
  const res = await apiClient.patch(`/admin/cash-remainders/${id}/reject`, { reason });
  return res.data.data;
}
