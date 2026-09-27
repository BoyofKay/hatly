import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * `value` is an arbitrary JSON value (boolean, number, string, or object)
 * depending on which key is being set, and the store itself doesn't
 * interpret it — so it carries no TYPE constraint. It still needs a
 * class-validator decorator: the global ValidationPipe (whitelist: true,
 * forbidNonWhitelisted: true — see app.setup.ts) treats a property with
 * NO decorator as unknown and rejects the whole request with
 * "property value should not exist". That is exactly how this endpoint
 * was completely unusable (HTTP 400 on every valid call) until the
 * end-to-end journeys exercised it — unit tests call the controller
 * directly and never run the pipe.
 *
 * `@IsDefined()` (not `@Allow()`): the column is `jsonb NOT NULL`, so a
 * missing/null value must be a 400, not a database error.
 */
export class UpsertBusinessConfigDto {
  @IsDefined()
  value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
