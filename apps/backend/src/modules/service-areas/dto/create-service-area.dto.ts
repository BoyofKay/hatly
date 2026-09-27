import { IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateServiceAreaDto {
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameAr?: string;

  @IsLatitude()
  centerLatitude: number;

  @IsLongitude()
  centerLongitude: number;

  @IsInt()
  @Min(1)
  @Max(200000)
  radiusMeters: number;
}
