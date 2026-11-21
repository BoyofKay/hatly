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
 * CONFIRMED (Phase I-A, Chunk 1 / Phase I-B): `vendorId` is
 * deliberately NOT editable — a branch never moves to a different
 * vendor after creation. `isActive`/`isOpen`/`marketplaceSectorId`
 * have their own dedicated endpoints, unchanged, not duplicated here.
 * `serviceAreaId` IS accepted here (Phase I-B addition, per the
 * explicit instruction to extend this existing update flow rather
 * than add a dedicated endpoint) — validated in AdminVendorsService to
 * reference a real, active ServiceArea before being persisted.
 */
export class UpdateVendorBranchDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  /** Arabic name (bilingual app). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

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

  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;

  /** Typical preparation time in minutes — the only source of a preparation ETA. `null` clears it (= no estimate). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  preparationTimeMinutes?: number | null;
}
