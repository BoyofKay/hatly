import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { normalizeCorrelationId } from './correlation-id';
import { RequestContextService } from './request-context.service';

/**
 * The single point where a request's correlation id is decided and the
 * request context is established — runs before every guard,
 * interceptor, pipe, and controller (Nest/Express middleware executes
 * first in the pipeline), so the context is available even for
 * requests that are rejected by JwtAuthGuard/PermissionsGuard or fail
 * validation. Sets the `x-correlation-id` response header exactly
 * once, here, so every response — success, validation failure, auth
 * failure, or unexpected error — carries it without any downstream
 * code (LoggingInterceptor, HttpExceptionFilter) needing to duplicate
 * that responsibility.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = normalizeCorrelationId(req.headers['x-correlation-id']);
    res.setHeader('x-correlation-id', correlationId);

    const context = {
      correlationId,
      method: req.method,
      path: req.originalUrl ?? req.url,
    };

    this.requestContextService.run(context, () => next());
  }
}
