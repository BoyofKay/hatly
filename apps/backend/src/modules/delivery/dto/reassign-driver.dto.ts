import { IsOptional, IsUUID } from 'class-validator';

export class ReassignDriverDto {
  @IsUUID()
  driverId: string;

  /**
   * Optional stale-view protection: the driver the admin saw assigned when they chose to reassign. If the assignment has
   * changed since (another admin, the timeout sweep, the driver's own release), the request is refused with
   * `ASSIGNMENT_CHANGED` instead of silently overriding a decision the admin never saw.
   */
  @IsOptional()
  @IsUUID()
  expectedCurrentDriverId?: string;
}
