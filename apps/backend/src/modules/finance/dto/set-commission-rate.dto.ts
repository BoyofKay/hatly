import { IsInt, Max, Min } from 'class-validator';

export class SetCommissionRateDto {
  /** Basis points: 0-10000 (0%-100%). See VendorBranch/Driver.commissionRateBasisPoints's own comment for why this representation. */
  @IsInt()
  @Min(0)
  @Max(10000)
  commissionRateBasisPoints: number;
}
