import { randomUUID } from 'crypto';

/**
 * An inbound `x-correlation-id` is untrusted client input. Only a
 * narrow, safe character set is ever echoed back or logged — anything
 * else (control characters, `\r`/`\n`, excessive length, multiple
 * header values, non-string values) is treated as invalid and replaced
 * with a freshly generated one. This is the ONLY policy decision that
 * matters here: `randomUUID()` (Node's built-in CSPRNG-backed UUID v4,
 * already the established convention in this codebase — see
 * RefreshTokenStore.issue() / the previous LoggingInterceptor) is never
 * predictable/sequential.
 *
 * Rejecting anything outside this pattern also protects
 * `response.setHeader('x-correlation-id', value)` itself: Node's HTTP
 * implementation throws on header values containing `\r`/`\n`, so a
 * malicious raw value echoed back unvalidated could crash the request
 * handling, not just pollute logs.
 */
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function normalizeCorrelationId(raw: unknown): string {
  if (typeof raw === 'string' && CORRELATION_ID_PATTERN.test(raw)) {
    return raw;
  }
  return randomUUID();
}
