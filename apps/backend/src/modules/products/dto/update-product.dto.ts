import { IsInt, IsOptional, IsString, IsUUID, IsUrl, Min, MaxLength, IsEnum } from 'class-validator';
import { InventoryMode } from '../inventory-mode.enum';

/**
 * CONFIRMED (Phase I-A, Chunk 2): `vendorBranchId` is deliberately NOT
 * editable — branch ownership stays immutable after creation (the
 * critical isolation rule). `categoryId` MAY be reassigned — but only
 * validated in AdminProductsService to still belong to the product's
 * own (unchangeable) branch, never a cross-branch move.
 *
 * `pricingUnit` is deliberately NOT here — CONFIRMED CLOSED (Phase
 * I-A, Chunk 3): immutable after creation. (Superseded note: an
 * earlier comment here called this "unresolved" — that was true only
 * until Chunk 3's locked decision; kept immutable regardless, so no
 * behavior change, just correcting a stale comment.)
 *
 * `isAvailable` has its own dedicated activate/deactivate endpoints.
 * Rating/Best-Selling cache fields are never present here — see
 * CreateProductDto's own comment.
 *
 * CHUNK 12A addition: `inventoryMode`/`quantity` — the OPEN/TRACKED
 * transition rules (quantity required+>=0 when moving to/staying
 * TRACKED, normalized to null on TRACKED→OPEN) are enforced in
 * AdminProductsService, not here, matching this DTO's existing
 * shape-only-validation convention.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priceMinor?: number;

  @IsOptional()
  @IsEnum(InventoryMode)
  inventoryMode?: InventoryMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}
