import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { OrderStatus } from '../order-status.enum';

/**
 * CONFIRMED business decisions (Customer Order History, decision C):
 * page + limit only — no cursor pagination. `status` is the one
 * approved optional filter, using the existing OrderStatus values
 * directly — no new status system. No date-range, amount, or
 * payment-method filters introduced.
 */
export class ListOrdersQueryDto {
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

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** The order-list tab: ongoing · completed · cancelled (see ORDER_LIST_TAB_STATUSES). Ignored when `status` is given. */
  @IsOptional()
  @IsIn(['active', 'completed', 'cancelled'])
  tab?: 'active' | 'completed' | 'cancelled';
}
