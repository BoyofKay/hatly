import { Logger } from '@nestjs/common';
import { BusinessEventName } from './business-events';

export type BusinessEventLevel = 'debug' | 'log' | 'warn' | 'error';

/**
 * A single field value safe to embed in a structured log line. No
 * objects/arrays — a business event log is a flat, small, greppable
 * record, never a serialized entity/DTO (Group 4, section 13).
 */
export type BusinessEventFieldValue = string | number | boolean | null | undefined;

/**
 * Emits one structured, single-line JSON business/operational event via
 * the caller's OWN `Logger` instance (so the log source still reads as
 * e.g. `[OrderStateMachineService]`, matching every other log in this
 * codebase) — deliberately NOT a new logging framework, just the
 * existing NestJS `Logger` plus a consistent envelope.
 *
 * MANDATORY (Group 4, section 19 — "logging cannot change business
 * outcomes"): this function can NEVER throw. `JSON.stringify` can
 * fail (a `BigInt` field, a circular reference introduced by a future
 * caller mistake, etc.) — that failure is swallowed here, not
 * propagated, so a logging defect can never fail an order, a payment,
 * or a wallet/loyalty ledger write.
 *
 * `getCorrelationId` is a zero-arg getter — every caller passes
 * `() => this.requestContextService.getCorrelationId()` (sourced
 * exclusively from `RequestContextService`, Group 3) rather than a
 * pre-resolved string. This matters: if it were resolved by the
 * CALLER before this function is invoked, a throwing correlation-id
 * lookup would throw at the call site, outside this function's own
 * try/catch, defeating the whole point of requirement 19 ("logging
 * cannot change business outcomes"). Deferring the call to inside the
 * try/catch below means ANY failure in resolving the correlation id —
 * not just in serializing/emitting the payload — is swallowed the
 * same way. `RequestContextService.getCorrelationId()` itself never
 * throws in practice (it has its own `'no-request-context'` fallback),
 * but this function does not rely on that guarantee.
 */
export function logBusinessEvent(
  logger: Logger,
  level: BusinessEventLevel,
  event: BusinessEventName,
  getCorrelationId: () => string,
  fields: Record<string, BusinessEventFieldValue> = {},
): void {
  try {
    const correlationId = getCorrelationId();
    const payload = JSON.stringify({ event, correlationId, ...fields });
    logger[level](payload);
  } catch {
    // Never rethrow — a logging failure must never break business logic.
  }
}
