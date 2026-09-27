import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * PHASE G addition (Weighted Products). Exactly one of
 * `quantity`/`requestedWeightGrams` is expected per request —
 * CartService picks the right update path based on which is present
 * and validates it against the item's actual product pricingUnit
 * (enforced in CartService, matching this project's existing
 * "nullable XOR" convention — see CartItem's own comment).
 */
export class UpdateCartItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  requestedWeightGrams?: number;
}
