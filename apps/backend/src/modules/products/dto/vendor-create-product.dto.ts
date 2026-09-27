import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { PricingUnit } from '../pricing-unit.enum';
import { InventoryMode } from '../inventory-mode.enum';

/**
 * CHUNK 12B-2. Deliberately a SEPARATE class from the shared
 * `CreateProductDto` — same reasoning as `VendorUpdateProductDto`
 * (Chunk 12B-1): `imageUrl` must be structurally absent, not merely
 * unused, for the app's global `whitelist: true` ValidationPipe to
 * actually strip a client-supplied value rather than accept it.
 * `CreateProductDto` (still used by Admin, now also carrying the new
 * optional `isAvailable` — unchanged otherwise) still declares
 * `imageUrl`; this class never does. Image creation for Vendors is a
 * two-step flow: this endpoint, then the existing, unchanged
 * `POST vendor/products/:id/image` from Chunk 12B-1 — reused exactly,
 * no duplicated upload/storage logic.
 *
 * Every other field matches `CreateProductDto` exactly in name/type,
 * so `VendorProductsService.createForUser` can pass this straight
 * into `ProductsService.adminCreateProduct` unchanged.
 */
export class VendorCreateProductDto {
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

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}
