import { IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Min, MaxLength } from 'class-validator';
import { DiscountType } from '../discount-type.enum';
import { OfferMechanism } from '../offer-mechanism.enum';

/**
 * Offers - Final System. mechanism is now required and discriminates
 * which OTHER fields are relevant - CONFIRMED, replaces the earlier
 * "targeting is required" decision: branch-wide targeting (both
 * productIds and categoryIds omitted) is now an explicitly valid mode
 * for SUBTOTAL_DISCOUNT, per the approved design ("Branch-wide
 * targeting when no product/category targeting is specified").
 *
 * Field-group validation is NOT expressed with class-validator
 * decorators alone here (a cross-field "required if mechanism = X"
 * rule is awkward to express clearly that way) - AdminOffersService
 * validates the mechanism/field combination explicitly and returns a
 * clear structured error, per the existing project convention of
 * preferring service-level business validation with a specific error
 * code over a generic decorator failure message.
 */
export class CreateOfferDto {
  @IsUUID()
  vendorBranchId: string;

  @IsString()
  @MaxLength(150)
  name: string;

  @IsEnum(OfferMechanism)
  mechanism: OfferMechanism;

  /** SUBTOTAL_DISCOUNT only. */
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  /** SUBTOTAL_DISCOUNT only. Basis points (0-10000) for PERCENTAGE; minor units for FIXED. */
  @IsOptional()
  @IsInt()
  @Min(1)
  discountValue?: number;

  /** SUBTOTAL_DISCOUNT only. */
  @IsOptional()
  @IsInt()
  @Min(1)
  minimumEligibleSubtotalMinor?: number;

  /** SUBTOTAL_DISCOUNT only. A cap, never an invalidation condition. */
  @IsOptional()
  @IsInt()
  @Min(1)
  maximumDiscountMinor?: number;

  /** FLASH_SALE only. The fixed replacement selling price. */
  @IsOptional()
  @IsInt()
  @Min(1)
  specialPriceMinor?: number;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  /** Both mechanisms. Omitting both productIds and categoryIds means branch-wide targeting. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  /** FLASH_SALE: per-single-order cap (still clamps). SUBTOTAL_DISCOUNT: unused (no per-item quantity concept). */
  @IsOptional()
  @IsInt()
  @Min(1)
  perOrderLimit?: number;

  /** FLASH_SALE: cumulative physical quantity across ALL orders. SUBTOTAL_DISCOUNT: cumulative USE COUNT across all orders. */
  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerLifetimeLimit?: number;

  /** FLASH_SALE: global cumulative physical quantity. SUBTOTAL_DISCOUNT: global cumulative use count. */
  @IsOptional()
  @IsInt()
  @Min(1)
  totalAllocationLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  budgetCapMinor?: number;

  /**
   * COUPON (SUBTOTAL_DISCOUNT only). When set, the offer is applied ONLY if the customer enters this code at checkout — it
   * is never auto-applied. Stored upper-case; unique (case-insensitive) among live offers.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,50}$/, { message: 'couponCode must be 3-50 letters, digits, "-" or "_".' })
  couponCode?: string;
}
