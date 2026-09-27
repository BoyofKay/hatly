import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateDriverRatingDto {
  @IsUUID()
  deliveryId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
