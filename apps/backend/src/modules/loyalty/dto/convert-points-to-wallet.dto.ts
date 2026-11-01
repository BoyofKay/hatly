import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

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

  // Bounded: the namespaced ledger key (`loyalty-convert:<customer uuid>:<key>`) must fit the 255-char column — an over-long key
  // used to reach PostgreSQL and answer 500.
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  idempotencyKey: string;
}
