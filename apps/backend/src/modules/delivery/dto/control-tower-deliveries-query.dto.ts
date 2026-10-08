import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CONTROL_TOWER_STAGES, ControlTowerStage } from '../admin-control-tower.service';

export class ControlTowerDeliveriesQueryDto {
  @IsOptional()
  @IsIn(Object.keys(CONTROL_TOWER_STAGES))
  stage?: ControlTowerStage;

  /** An order number (exact) or the customer's phone / name (partial). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** Only orders this driver is currently on. */
  @IsOptional()
  @IsUUID()
  driverId?: string;

  /** Only orders waiting again after their driver was released (`released` set). */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  releasedOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
