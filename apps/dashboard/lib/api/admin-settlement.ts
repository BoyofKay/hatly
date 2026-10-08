import { apiClient } from './client';

/** Mirrors the real backend `VendorSettlementPeriod` entity exactly (finance/entities/vendor-settlement-period.entity.ts). */
export interface VendorSettlementPeriod {
  id: string;
  vendorBranchId: string;
  frequency: string;
  periodStart: string;
  periodEnd: string;
  status: 'OPEN' | 'CLOSED';
  grossSalesMinor: number;
  totalCommissionOwedMinor: number;
  closedAt: string | null;
  closedByUserId: string | null;
}

/** Mirrors the real backend `DriverSettlementPeriod` entity exactly (finance/entities/driver-settlement-period.entity.ts). */
export interface DriverSettlementPeriod {
  id: string;
  driverId: string;
  frequency: string;
  periodStart: string;
  periodEnd: string;
  status: 'OPEN' | 'CLOSED';
  totalEarningsMinor: number;
  totalCommissionOwedMinor: number;
  totalReimbursementsOwedMinor: number;
  netPayableMinor: number;
  closedAt: string | null;
  closedByUserId: string | null;
}

/**
 * M3a (Launch-Readiness Gap Audit, G-05). Reuses the existing, unchanged
 * `POST admin/settlement/vendor-branches/:branchId/close` /
 * `POST admin/settlement/drivers/:driverId/close` endpoints exactly
 * (built in M2) — SettlementService remains the sole place any of these
 * totals are computed; this file never re-derives grossSalesMinor,
 * totalCommissionOwedMinor, or netPayableMinor itself. Deliberately no
 * "list past periods" function — no such backend endpoint exists (only
 * the two close endpoints — see admin-settlement.controller.ts); adding
 * one would be a settlement backend change, out of scope for M3a.
 */
export async function closeVendorSettlementPeriod(vendorBranchId: string): Promise<VendorSettlementPeriod> {
  const res = await apiClient.post(`/admin/settlement/vendor-branches/${vendorBranchId}/close`);
  return res.data.data;
}

export async function closeDriverSettlementPeriod(driverId: string): Promise<DriverSettlementPeriod> {
  const res = await apiClient.post(`/admin/settlement/drivers/${driverId}/close`);
  return res.data.data;
}
