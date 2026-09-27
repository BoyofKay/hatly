import { Injectable } from '@nestjs/common';
import { AdHocPurchaseRecord } from '../orders/entities/ad-hoc-purchase-record.entity';
import { AdHocPurchaseRecordService } from '../orders/ad-hoc-purchase-record.service';

/**
 * Vendor/Driver Deferred Pricing for Custom CATALOG Items. Thin
 * delegation only — CONFIRMED, the ownership check this wrapper used
 * to perform itself (driver must own the Delivery for this item's
 * Order) now lives inside `AdHocPurchaseRecordService.
 * recordDriverPurchase` itself, since that method needs the exact
 * same check for BOTH the pre-existing AD_HOC_SERVICE case and this
 * chunk's new vendor-scoped Custom Item case — duplicating it here
 * too would be the "duplicated financial/authorization logic" this
 * chunk explicitly avoids. External Hatly Service Driver purchase
 * behavior is unchanged: same method name at this call site's own
 * public surface (`recordPurchase`), same params, same eventual
 * DRIVER_REIMBURSEMENT_OWED side effect (now inside the service
 * itself).
 */
@Injectable()
export class DriverPurchaseService {
  constructor(private readonly adHocPurchaseRecordService: AdHocPurchaseRecordService) {}

  async recordPurchase(params: {
    userId: string;
    orderItemId: string;
    amountMinor: number;
  }): Promise<AdHocPurchaseRecord> {
    return this.adHocPurchaseRecordService.recordDriverPurchase(params.orderItemId, params.amountMinor, params.userId);
  }
}

