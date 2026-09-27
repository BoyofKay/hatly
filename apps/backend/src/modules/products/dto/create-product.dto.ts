import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, IsUrl, Min, MaxLength } from 'class-validator';
import { PricingUnit } from '../pricing-unit.enum';
import { InventoryMode } from '../inventory-mode.enum';

/**
 * CONFIRMED (Phase I-A, Chunk 2): `categoryId` must belong to the
 * SAME `vendorBranchId` — validated server-side in
 * AdminProductsService, never trusted from the client (critical
 * branch-isolation rule). Rating/Best-Selling cache fields are
 * deliberately NOT here — those remain entirely system-maintained
 * (see the Product entity's own comments); Admin/client CRUD can
 * never set them, at creation or otherwise.
 *
 * CHUNK 12A addition: `inventoryMode`/`quantity` are both optional —
 * omitted entirely defaults to OPEN + null quantity (CONFIRMED,
 * preserves every prior product-creation call exactly). The
 * OPEN/TRACKED cross-field validation (quantity required + >=0 when
 * TRACKED) is enforced in AdminProductsService, not here — matches
 * this DTO's own existing convention of pure shape/type validation
 * only, with business rules in the service layer.
 */
export class CreateProductDto {
  @IsUUID()
  vendorBranchId: string;

  @IsUUID()
  categoryId: string;

  @IsString()
  @MaxLength(150)
  name: string;

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

  @IsInt()
  @Min(1)
  priceMinor: number;

  @IsEnum(PricingUnit)
  pricingUnit: PricingUnit;

  @IsOptional()
  @IsEnum(InventoryMode)
  inventoryMode?: InventoryMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  /**
   * CHUNK 12B-2 addition. Optional — omitted preserves the exact
   * existing behavior (the entity column's own default, `true`).
   * Does not touch or replace the existing dedicated activate/
   * deactivate endpoints; this only lets a caller choose the INITIAL
   * value at creation instead of always starting available and
   * needing a follow-up deactivate call.
   */
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
