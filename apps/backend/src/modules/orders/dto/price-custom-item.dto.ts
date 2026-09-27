import { IsInt, Min } from 'class-validator';

/**
 * Vendor Custom Item Pricing Endpoint (Chunk 4A). Mirrors
 * RecordWeightDto's own exact validation shape — the existing
 * AdHocPurchaseRecordService.recordVendorPrice remains authoritative
 * for everything beyond "is this a positive integer" (item ownership,
 * item state, duplicate-pricing rejection, branch ownership,
 * transaction behavior — none of that is re-implemented here).
 */
export class PriceCustomItemDto {
  @IsInt()
  @Min(1)
  amountMinor: number;
}
