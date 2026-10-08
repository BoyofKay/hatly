import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Loyalty Balance/History (consolidated customer-commerce milestone).
 * `page` + `limit` only — mirrors `ListWalletTransactionsQueryDto`
 * exactly (same pagination contract already established for Customer
 * Wallet history), no new pagination convention invented.
 */
export class ListLoyaltyTransactionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
