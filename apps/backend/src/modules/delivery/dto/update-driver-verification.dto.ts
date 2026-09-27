import { IsEnum } from 'class-validator';

/**
 * Driver Core + Dispatch Foundation milestone. Closes a real, confirmed gap: `Driver.verificationStatus`
 * defaults to `'PENDING'` on creation (see `DriversService.create`) and nothing anywhere ever moved it to
 * `'APPROVED'` — `DriverRankingService.rankCandidates` requires exactly that value, so a newly Admin-created
 * driver could never actually receive an assignment. `REJECTED` is the explicit refusal counterpart (a driver
 * who fails verification), matching the entity's own existing three-value union — no new state invented.
 */
export class UpdateDriverVerificationDto {
  @IsEnum(['APPROVED', 'REJECTED'])
  status: 'APPROVED' | 'REJECTED';
}
