import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { HomeBannerActionType } from '../home-banner-action.enum';

/** Partial update. `null` clears an optional value (Arabic title, schedule dates, action target). Activation and the image have their own endpoints. */
export class UpdateHomeBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(/\S/)
  title?: string;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(120)
  titleAr?: string | null;

  @IsOptional()
  @IsEnum(HomeBannerActionType)
  actionType?: HomeBannerActionType;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUUID()
  actionTargetId?: string | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsUUID()
  sectorId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsISO8601({ strict: true })
  startsAt?: string | null;

  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsISO8601({ strict: true })
  endsAt?: string | null;
}
