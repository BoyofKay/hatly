import { IsDefined, IsUUID, ValidateIf } from 'class-validator';

/** Operational Completion milestone: a driver's vehicle type, from the existing `vehicle_types` catalog — `null` clears it. */
export class UpdateDriverVehicleTypeDto {
  @IsDefined()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  vehicleTypeId: string | null;
}
