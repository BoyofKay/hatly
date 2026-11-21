import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** The fields an existing offer may change (see AdminOffersService.update). `null` is not accepted: omit a field to keep it. */
export class UpdateOfferDto {
  @IsOptional() @IsString() @MaxLength(150) name?: string;
  @IsOptional() @IsInt() @Min(1) discountValue?: number;
  @IsOptional() @IsInt() @Min(1) minimumEligibleSubtotalMinor?: number;
  @IsOptional() @IsInt() @Min(1) maximumDiscountMinor?: number;
  @IsOptional() @IsInt() @Min(1) specialPriceMinor?: number;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsInt() @Min(1) perOrderLimit?: number;
  @IsOptional() @IsInt() @Min(1) perCustomerLifetimeLimit?: number;
  @IsOptional() @IsInt() @Min(1) totalAllocationLimit?: number;
  @IsOptional() @IsInt() @Min(1) budgetCapMinor?: number;
}
