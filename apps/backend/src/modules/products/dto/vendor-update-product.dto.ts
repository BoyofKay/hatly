import { IsInt, IsOptional, IsString, IsUUID, Min, MaxLength, IsEnum } from 'class-validator';
import { InventoryMode } from '../inventory-mode.enum';

/**
 * CHUNK 12B-1 CORRECTION. Deliberately a SEPARATE class from
 * `UpdateProductDto` — not a subset achieved by omission at the
 * controller level. `imageUrl` is NOT declared here at all: with the
 * app's global `ValidationPipe({ whitelist: true })`, a field must be
 * absent from the DTO class itself to be stripped — merely "not
 * mentioning it" in a shared DTO wouldn't work, since `UpdateProductDto`
 * (still used by Admin, unchanged) does declare it. This is the actual
 * mechanism that prevents a Vendor from injecting an arbitrary
 * external image URL via the normal JSON PATCH — image changes must
 * go through `POST vendor/products/:id/image`.
 *
 * Every other field/exclusion matches `UpdateProductDto` exactly:
 * `vendorBranchId`/`pricingUnit` never appear, rating/Best-Selling
 * cache fields never appear.
 */
export class VendorUpdateProductDto {
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
