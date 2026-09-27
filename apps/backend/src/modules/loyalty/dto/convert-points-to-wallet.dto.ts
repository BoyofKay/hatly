import { IsInt, IsString, Min } from 'class-validator';

/**
 * Points -> Wallet Conversion (Chunk D). No `customerId` field —
 * CONFIRMED, identity always comes from the authenticated session
 * (@CurrentUser()), never a client-supplied parameter, matching this
 * codebase's existing convention everywhere else (e.g. Ratings).
 */
export class ConvertPointsToWalletDto {
  @IsInt()
  @Min(1)
  points: number;

  @IsString()
  idempotencyKey: string;
}
