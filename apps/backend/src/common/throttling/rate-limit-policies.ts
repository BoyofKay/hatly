import { Throttle } from '@nestjs/throttler';

/**
 * Rate-limit policies by endpoint risk (M5 Batch 4). Every limit that is not the app-wide default lives here, so the whole
 * picture is reviewable in one place (docs/security/rate-limiting.md has the full table).
 *
 * How limits combine (see HatlyThrottlerGuard / app.module.ts):
 *  - `default` — per ROUTE per client. Routes can replace it with one of the policies below via `@Throttled(...)`.
 *  - `aggregate` — across ALL routes per client, so spreading requests over many different routes cannot dodge the per-route limit.
 *  "Client" = the authenticated user id when there is one, else the socket IP address.
 *
 * Auth-sensitive routes (login, OTP, register, refresh) keep their own, stricter `@Throttle` limits in auth.controller.ts.
 */
export interface RateLimitPolicy {
  limit: number;
  ttl: number;
}

const MINUTE = 60_000;

export const RateLimitPolicies = {
  /** Trigram search: the most expensive public read. The app debounces at 400 ms, so a real user stays far below this. */
  search: { limit: 60, ttl: MINUTE },
  /** Server-side price/fee/offer recomputation (REPEATABLE READ transaction); recomputed when the cart or address changes. */
  checkoutQuote: { limit: 30, ttl: MINUTE },
  /** Creates an order (cart lock, inventory decrement, snapshots). A person places a handful per hour, not per minute. */
  orderCreate: { limit: 10, ttl: MINUTE },
  /** Base64 image upload through the API (also the proof-of-delivery / custom-item photo path). */
  mediaUpload: { limit: 30, ttl: MINUTE },
  /** Vendor/admin product-image multipart upload (buffered in memory, then stored). */
  productImageUpload: { limit: 20, ttl: MINUTE },
  /** Excel import: parses a spreadsheet and runs an all-or-nothing transaction. */
  fileImport: { limit: 10, ttl: MINUTE },
} satisfies Record<string, RateLimitPolicy>;

/** Replaces the per-route default limit with a named policy. */
export const Throttled = (policy: RateLimitPolicy) => Throttle({ default: { limit: policy.limit, ttl: policy.ttl } });

/** Defaults for the two guard-wide limits. Overridable per environment (see config/configuration.ts). */
export const DEFAULT_ROUTE_LIMIT_PER_MINUTE = 100;
export const DEFAULT_CLIENT_LIMIT_PER_MINUTE = 600;
