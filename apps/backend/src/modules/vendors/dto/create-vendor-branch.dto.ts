import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * CONFIRMED (Phase I-A, Chunk 1): Vendor and VendorBranch creation are
 * two explicit operations — `vendorId` here must reference an
 * already-created Vendor (validated server-side, never assumed).
 * `isActive`/`isOpen` are deliberately NOT here — every new branch
 * starts inactive; only the dedicated activate endpoint changes that
 * (matches `isOpen`'s own existing entity default of `false`).
 * `marketplaceSectorId` is deliberately NOT here either — sector
 * assignment stays on its own existing, untouched endpoint
 * (`PATCH admin/vendor-branches/:id/sector`), not duplicated here.
 * `commissionRateBasisPoints` is optional at creation (the entity
 * itself is nullable, fails closed until set — same as before this
 * chunk) but is the REAL commission mechanism; `Vendor.commissionPercent`
 * is never read or written by this DTO.
 */
export class CreateVendorBranchDto {
  @IsUUID()
  vendorId: string;

  @IsString()
  @MaxLength(150)
  name: string;

  @IsString()
  @MaxLength(255)
  address: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;

  @IsOptional()
  @IsObject()
  openingHours?: Record<string, { open: string; close: string }>;

  @IsOptional()
  @IsBoolean()
  deliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionRateBasisPoints?: number;
}
