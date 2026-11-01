import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { HomeBannerActionType } from '../home-banner-action.enum';

/** A new banner is always created INACTIVE (a draft) and without an image — the image goes through `POST :id/image`, activation through `PATCH :id/activate`. */
export class CreateHomeBannerDto {
  /** The banner's accessible description and the admin's label. Required. */
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  titleAr?: string;

  @IsOptional()
  @IsEnum(HomeBannerActionType)
  actionType?: HomeBannerActionType;

  /** Product id, vendor-branch id or sector id depending on `actionType`; required for any action other than NONE, forbidden for NONE. */
  @IsOptional()
  @IsUUID()
  actionTargetId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  startsAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;
}
