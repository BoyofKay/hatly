import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/**
 * Mirrors `UpdateSectorDto`'s own "safe configuration only" discipline
 * exactly: `sectorId` is deliberately NOT re-parentable here (moving a
 * Subcategory to a different Sector is a bigger, unrequested decision
 * — a real business need for it can get its own dedicated endpoint
 * later); activation state has its own dedicated activate/deactivate
 * endpoints, not this generic update.
 */
export class UpdateSubcategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
