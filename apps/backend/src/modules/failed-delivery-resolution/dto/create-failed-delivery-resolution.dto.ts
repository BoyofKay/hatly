import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { FailedDeliveryOutcome } from '../failed-delivery-outcome.enum';

/**
 * Failed Delivery Resolution (Chunk 2b). `refundAmountMinor`'s
 * cross-field validation (required iff REFUND_CUSTOMER, forbidden iff
 * RESOLVED_NO_REFUND) cannot be expressed by a single-field validator
 * alone — `@ValidateIf` handles the "required when" direction; the
 * "forbidden otherwise" direction is enforced in the service layer
 * (and, as the final authority, the DB CHECK constraint) — the exact
 * same layered-validation pattern already used elsewhere in this
 * codebase (e.g. AddVendorCustomItemDto's own cross-field rule).
 */
export class CreateFailedDeliveryResolutionDto {
  @IsEnum(FailedDeliveryOutcome)
  outcome: FailedDeliveryOutcome;

  @ValidateIf((dto) => dto.outcome === FailedDeliveryOutcome.REFUND_CUSTOMER)
  @IsInt()
  @Min(1)
  refundAmountMinor?: number;

  @IsOptional()
  @IsBoolean()
  driverReviewNeeded?: boolean;

  @IsOptional()
  @IsString()
  driverReviewNotes?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
