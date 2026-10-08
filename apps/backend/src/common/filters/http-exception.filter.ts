import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { httpErrorClientStatus, isDependencyUnavailable, resolveHttpStatus } from '../utils/http-status.util';
import { NO_REQUEST_CONTEXT, RequestContextService } from '../request-context/request-context.service';
import { normalizeCorrelationId } from '../request-context/correlation-id';
import { ThrottlerException } from '@nestjs/throttler';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlationId: string;
  };
}

/**
 * Converts every thrown error into the standardized API error envelope:
 *   { error: { code, message, details?, correlationId } }
 *
 * Internal stack traces / raw error messages are logged server-side only
 * and never sent to the client, per the security requirements in the
 * spec ("never expose internal stack traces to users"). `correlationId`
 * is the one addition from Group 3 — always present, never sensitive
 * (an opaque, request-scoped id), so a client/support agent can quote
 * it back for server-side log correlation. The `x-correlation-id`
 * response header itself is already set unconditionally by
 * RequestContextMiddleware before this filter (or anything else) runs,
 * so every response — success or failure — already carries it; this
 * filter does not need to set it again.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * @param exposeServerErrorMessages when false (production/staging) the message of a 5xx HttpException is replaced by a
   *   generic one — an HttpException message is developer-authored text and a 5xx is an internal failure, so it must not
   *   reach a client; the full detail is logged server-side with the correlation id. 4xx messages are unchanged (they are
   *   the actionable validation/business errors the apps display).
   */
  constructor(
    private readonly requestContextService: RequestContextService,
    private readonly exposeServerErrorMessages: boolean = true,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    let correlationId = this.requestContextService.getCorrelationId();
    if (correlationId === NO_REQUEST_CONTEXT) {
      // The failure happened BEFORE RequestContextMiddleware ran (body parsing, a route that matched
      // no middleware scope). Answer with the caller's own valid id or a fresh one — never the
      // literal placeholder — and expose it as the header too, so every response is traceable.
      correlationId = normalizeCorrelationId(request.headers?.['x-correlation-id']);
      if (!response.headersSent && typeof response.setHeader === 'function') response.setHeader('x-correlation-id', correlationId);
    }

    const status = resolveHttpStatus(exception);
    // Path only (no query string — it can carry phone numbers/coordinates/search terms) in every server-side log line.
    const safePath = String(request.originalUrl ?? request.url ?? '').split('?')[0];
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof HttpException) {
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      const response_ = exception.getResponse();
      if (exception instanceof ThrottlerException || (status === HttpStatus.TOO_MANY_REQUESTS && typeof response_ === 'string' && response_.startsWith('ThrottlerException'))) {
        // @nestjs/throttler's own message is the class name ("ThrottlerException: Too Many Requests"). Other 429s (e.g. the
        // per-account failed-login lock) carry their own message and details.
        message = 'Too many requests. Please try again later.';
      } else if (typeof response_ === 'string') {
        message = response_;
      } else if (typeof response_ === 'object' && response_ !== null) {
        const body = response_ as Record<string, unknown>;
        message = (body.message as string) ?? message;
        details = body.details ?? undefined;
      }
      if (status >= 500) {
        // An HttpException that is a server error used to leave NO server-side trace at all (only unknown errors were logged).
        this.logger.error(
          `Server error response [correlationId=${correlationId}] ${request.method} ${safePath} (status ${status}, code ${code}): ${exception.message}`,
          exception.stack,
        );
        if (!this.exposeServerErrorMessages) {
          message = 'Something went wrong. Please try again.';
          details = undefined;
        }
      }
    } else if (isDependencyUnavailable(exception)) {
      code = HttpStatus[status] ?? 'SERVICE_UNAVAILABLE';
      message = 'A required service is temporarily unavailable. Please try again shortly.';
      this.logger.error(
        `Dependency unavailable [correlationId=${correlationId}] on ${request.method} ${safePath}: ${(exception as Error).message}`,
      );
    } else if (httpErrorClientStatus(exception) !== undefined) {
      code = HttpStatus[status] ?? 'HTTP_ERROR';
      message = (exception as Error).message || message;
    } else if (exception instanceof Error) {
      // Unknown/unexpected error: log full detail (including the
      // correlation id, so this line can be found from a client/support
      // report), expose nothing beyond the correlation id to the client.
      this.logger.error(
        `Unhandled exception [correlationId=${correlationId}] on ${request.method} ${safePath} (status ${status}): ${exception.message}`,
        exception.stack,
      );
    }

    const body: ErrorBody = {
      error: { code, message, ...(details ? { details } : {}), correlationId },
    };

    response.status(status).json(body);
  }
}
