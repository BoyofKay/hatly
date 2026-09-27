import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/**
 * CONFIRMED (decision 10, "update safe configuration"): `slug` is
 * deliberately NOT updatable here — it's the stable identifier a
 * future Flutter deep-link or cached client state could reference;
 * `name`/`nameAr`/`sortOrder` are the safe, purely-presentational
 * fields. Activation state is handled by the dedicated
 * activate/deactivate endpoints, not this generic update, matching
 * the "no arbitrary unrestricted PATCH" instruction.
 */
export class UpdateSectorDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
