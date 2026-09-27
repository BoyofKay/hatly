import { Allow, IsBoolean, IsOptional } from 'class-validator';

/**
 * `config` is intentionally untyped/uninterpreted — see the entity's
 * own doc comment. This DTO exists only so the endpoint has a
 * declared, whitelisted shape (per main.ts's ValidationPipe), not
 * because the contents are validated. `@Allow()` is what actually
 * whitelists it: the global ValidationPipe (whitelist +
 * forbidNonWhitelisted) rejects any property that has no class-validator
 * decorator, so an undecorated `config` made this endpoint reject every
 * request that carried one.
 */
export class UpsertHatlyServicePricingConfigDto {
  @Allow()
  config?: unknown;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
