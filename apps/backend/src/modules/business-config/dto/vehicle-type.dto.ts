import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateVehicleTypeDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsInt()
  @Min(1)
  maxActiveDeliveries: number;

  @IsOptional()
  @IsBoolean()
  isBicycle?: boolean;
}

export class UpdateVehicleTypeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  nameAr?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveDeliveries?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isBicycle?: boolean;
}
