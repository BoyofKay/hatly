import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Customer Wallet (Profile). `page` + `limit` only — mirrors
 * `ListOrdersQueryDto` exactly (same pagination contract already
 * established for Customer Order History), no cursor pagination, no
 * date-range/type filters introduced.
 */
export class ListWalletTransactionsQueryDto {
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
