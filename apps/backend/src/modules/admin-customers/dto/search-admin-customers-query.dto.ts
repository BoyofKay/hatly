import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * M3c (Launch-Readiness Gap Audit, G-10). `page`/`limit` mirror the
 * exact same contract as `SearchAdminOrdersQueryDto`/
 * `CustomerOrdersService.listForCustomer` (DEFAULT_PAGE=1,
 * DEFAULT_LIMIT=20, MAX_LIMIT=50, silently clamped server-side, never
 * a 400 for an over-large value) — no new pagination shape invented.
 *
 * `search` is ONE free-text box, same interpretation style as Admin
 * Order Search: a UUID shape matches `id` exactly, anything else does
 * a partial (ILIKE) match against `phone` OR `fullName`.
 */
export class SearchAdminCustomersQueryDto {
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
  @IsString()
  @MaxLength(100)
  search?: string;

  /**
   * Account status filter — the existing `User.isActive` column, no
   * new state invented. Mirrors `ListCatalogProductsQueryDto`'s own
   * exact `@Transform` — a raw `@Type(() => Boolean)` would be wrong
   * here: `Boolean('false')` is `true` in JS, since any non-empty
   * string is truthy.
   */
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}
