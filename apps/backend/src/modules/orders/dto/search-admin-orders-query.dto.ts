import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { OrderStatus } from '../order-status.enum';
import { PaymentStatus } from '../../payments/payment-status.enum';
import { ORDER_PAYMENT_METHODS, OrderPaymentMethod } from '../order-payment-method';
import { FulfillmentType } from '../../cart/fulfillment-type.enum';

/**
 * M3b (Launch-Readiness Gap Audit, G-04). `page`/`limit` mirror the
 * exact same contract already established by
 * `CustomerOrdersService.listForCustomer`/`WalletService.
 * listTransactionsForCustomer` (DEFAULT_PAGE=1, DEFAULT_LIMIT=20,
 * MAX_LIMIT=50 — see AdminOrdersSearchService) — no new pagination
 * shape invented.
 *
 * `search` is ONE free-text box (matches the natural single-search-box
 * UX an Admin actually wants) rather than three separate
 * orderNumber/orderId/customerPhone params — the service interprets it:
 * an `HT-######` shape matches `orderNumber` exactly, a UUID shape
 * matches `id` exactly, anything else does a partial (ILIKE) match
 * against the customer's `phone` OR `fullName`. Every interpretation
 * still only ever touches columns that already exist.
 */
export class SearchAdminOrdersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Clamped server-side to MAX_LIMIT (50) — same silent-clamp convention as CustomerOrdersService/WalletService, never a 400 for an over-large value. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Inclusive lower bound on `createdAt`, ISO-8601. */
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  /** Inclusive upper bound on `createdAt`, ISO-8601. */
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsIn(ORDER_PAYMENT_METHODS)
  paymentMethod?: OrderPaymentMethod;

  /** M3c (Launch-Readiness Gap Audit, G-10) addition — an exact-match filter, distinct from `search`'s partial phone/name matching. Powers Admin Customer Detail's "recent orders" without a duplicate query. */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /**
   * Hatly Service pricing Admin UI — `true` keeps only orders with at least one Hatly Service request whose price is still
   * PENDING (an item of an AD_HOC_SERVICE segment with no confirmed amount); `false` is the same as omitting it. Computed
   * server-side so the list never has to load an unbounded set to find them.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value))
  @IsBoolean()
  hasPendingPricing?: boolean;

  /** Operational Completion milestone — DELIVERY or PICKUP (e.g. the pickup orders ready at a branch, from the Control Tower). */
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;
}
