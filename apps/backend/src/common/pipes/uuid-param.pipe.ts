import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

/**
 * Global guard for path identifiers. Every `@Param('id')` / `@Param('xxxId')` in this API is a
 * UUID primary key, but the controllers declare them as plain strings, so a malformed value
 * (`GET /orders/not-a-uuid`) reached PostgreSQL and surfaced as an unhandled
 * `invalid input syntax for type uuid` — an HTTP 500 for what is plainly a client error. Found by
 * the Group 8 journeys (dozens of routes were affected; mocked unit tests never reach the database).
 *
 * Only params named `id` or ending in `Id` are checked, so non-identifier params (`:key`,
 * `:permission`) keep their own handling.
 *
 * Named QUERY values follow the same convention (`@Query('vendorBranchId')` etc. — all UUIDs): a malformed filter used to reach
 * PostgreSQL as well (`GET /admin/products?vendorBranchId=x` → 500, found by the identifier sweep, e2e 93). An absent or empty
 * query value is left alone (it means "no filter"). Whole-object `@Query() dto` values are validated by their DTO instead.
 */
@Injectable()
export class UuidParamPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if ((metadata.type !== 'param' && metadata.type !== 'query') || !metadata.data) return value;
    if (metadata.data !== 'id' && !metadata.data.endsWith('Id')) return value;
    if (metadata.type === 'query' && (value === undefined || value === '')) return value;
    if (typeof value !== 'string' || !isUUID(value)) {
      throw new BadRequestException({
        message: `Invalid identifier for "${metadata.data}".`,
        details: { code: 'INVALID_IDENTIFIER', param: metadata.data },
      });
    }
    return value;
  }
}
