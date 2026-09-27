import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The single, shared "what HTTP status will this exception ultimately
 * produce" resolver — used by both HttpExceptionFilter (which sets the
 * real response status) and LoggingInterceptor (which needs to log a
 * status for a failed request before the filter runs). Kept as one
 * function so the two can never drift apart on what counts as, say, a
 * 404 vs a 500.
 */
/**
 * Client errors raised by the HTTP layer BELOW Nest's exception layer — chiefly body-parser
 * (`entity.too.large` → 413, `entity.parse.failed` → 400, `encoding.unsupported` → 415): they are
 * plain `http-errors` objects, not `HttpException`s, so they used to fall through to a generic 500
 * ("Something went wrong") for what is plainly the client's fault (Group 8 finding: a 300 KB
 * JSON body answered 500). `expose === true` is http-errors' own marker for "safe to show".
 */
export function httpErrorClientStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const candidate = exception as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = candidate.status ?? candidate.statusCode;
  if (candidate.expose === true && typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
    return status;
  }
  return undefined;
}

/**
 * The shared Redis client gave up: ioredis rejects with `MaxRetriesPerRequestError` once its bounded
 * retries are spent (Group 1 configured fail-fast on purpose) or with "Connection is closed" after a
 * shutdown. That is a dependency OUTAGE, not a bug in the request — it must read as 503 (retryable,
 * alertable) rather than a generic 500 (found by the Group 8 Redis-down journey).
 */
export function isDependencyUnavailable(exception: unknown): boolean {
  if (!(exception instanceof Error)) return false;
  return exception.name === 'MaxRetriesPerRequestError' || /^Connection is closed\.?$/.test(exception.message);
}

export function resolveHttpStatus(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  if (isDependencyUnavailable(exception)) return HttpStatus.SERVICE_UNAVAILABLE;
  return httpErrorClientStatus(exception) ?? HttpStatus.INTERNAL_SERVER_ERROR;
}
