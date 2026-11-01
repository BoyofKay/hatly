import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

/** Upper bound of a single modifier price, in minor units (EGP 100,000). A sanity guard, not a business price. */
export const MAX_OPTION_PRICE_DELTA_MINOR = 10_000_000;
export const MAX_OPTION_GROUPS_PER_PRODUCT = 12;
export const MAX_VALUES_PER_OPTION_GROUP = 30;

export class ProductOptionValueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  /** Signed integer minor units added to the product's base price when selected (negative = a discount). Default 0. */
  @IsOptional()
  @IsInt()
  @Min(-MAX_OPTION_PRICE_DELTA_MINOR)
  @Max(MAX_OPTION_PRICE_DELTA_MINOR)
  priceDeltaMinor?: number;
}

export class UpdateProductOptionValueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsInt()
  @Min(-MAX_OPTION_PRICE_DELTA_MINOR)
  @Max(MAX_OPTION_PRICE_DELTA_MINOR)
  priceDeltaMinor?: number;
}

export class CreateProductOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsMultiple?: boolean;

  /** Multiple-choice only: "choose at least N". */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_VALUES_PER_OPTION_GROUP)
  minSelections?: number;

  /** Multiple-choice only: "choose at most N". Omit for no cap. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VALUES_PER_OPTION_GROUP)
  maxSelections?: number;

  @IsArray()
  @ArrayMaxSize(MAX_VALUES_PER_OPTION_GROUP)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionValueDto)
  values: ProductOptionValueDto[];
}

export class UpdateProductOptionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameAr?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  allowsMultiple?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_VALUES_PER_OPTION_GROUP)
  minSelections?: number;

  /** `null` removes the cap. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VALUES_PER_OPTION_GROUP)
  maxSelections?: number | null;
}
