import { ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * Deliberately has NO price field — this is the structural enforcement
 * of "client-submitted prices must never be trusted" (Phase 2D
 * business rule #5): the client can't submit a price because there's
 * nowhere to put one. The server always computes price from
 * `productId` + `selectedOptionValueIds` against live Product/
 * ProductOptionValue rows — see CartPricingService.
 */
export class AddCartItemDto {
  @IsUUID()
  productId: string;

  @IsInt()
  @Min(1)
  @Max(50) // sanity ceiling — not a business rule, just guards against a garbage/malicious quantity
  quantity: number;

  /**
   * PHASE G addition (Weighted Products). Required (and validated
   * against the product's pricingUnit in CartService) only for a
   * WEIGHT product — integer grams, never floating-point kilograms,
   * never overloaded onto `quantity`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  requestedWeightGrams?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  selectedOptionValueIds?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
