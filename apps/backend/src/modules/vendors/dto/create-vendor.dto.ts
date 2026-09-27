import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * CONFIRMED (Phase I-A, Chunk 1): `category`/`commissionPercent` are
 * deliberately NOT here — both are legacy/inert fields on `Vendor`
 * (see that entity's own comments); the real commission mechanism is
 * `VendorBranch.commissionRateBasisPoints`, set at branch creation.
 * `isActive` is deliberately NOT here either — CONFIRMED: every new
 * Vendor starts inactive; only the dedicated activate endpoint can
 * change that.
 */
export class CreateVendorDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsOptional()
  @IsUrl()
  logoUrl?: string;
}
