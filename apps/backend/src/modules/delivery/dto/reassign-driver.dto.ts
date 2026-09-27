import { IsUUID } from 'class-validator';

export class ReassignDriverDto {
  @IsUUID()
  driverId: string;
}
