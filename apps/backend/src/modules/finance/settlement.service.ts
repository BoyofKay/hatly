import { Injectable } from '@nestjs/common';
import { SettlementClosingService } from './settlement-closing.service';

/**
 * Closing a courier or vendor settlement. Since 2026-11-13 both are computed by `SettlementClosingService` (order lines for couriers, segment
 * lines dated by handover for vendors, one closing per order/segment enforced by UNIQUE indexes and a per-party lock). Periods closed
 * earlier by the previous event-window formula are kept exactly as stored (method_version = 1) and are never recomputed.
 *
 * The earlier formula is retired because it was wrong for money the courier collects at the door: it netted fee − commission +
 * reimbursements and ignored COD cash, so a cash order showed Hatly owing the courier the delivery fee he had already collected (R25,
 * owner decision 2 of 2026-11-13), and it dated vendor gross sales by order creation rather than by handover (R35).
 */
@Injectable()
export class SettlementService {
  constructor(private readonly closing: SettlementClosingService) {}

  closeVendorPeriod(vendorBranchId: string, closedByUserId: string, opts: { periodEnd?: string; previewToken?: string } = {}) {
    return this.closing.closeVendor(vendorBranchId, closedByUserId, opts);
  }

  closeDriverPeriod(driverId: string, closedByUserId: string, opts: { previewToken?: string } = {}) {
    return this.closing.closeCourier(driverId, closedByUserId, opts);
  }
}
