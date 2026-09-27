import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateProductRatingDto {
  @IsUUID()
  orderItemId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
