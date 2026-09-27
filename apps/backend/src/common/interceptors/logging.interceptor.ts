import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { resolveHttpStatus } from '../utils/http-status.util';
import { RequestContextService } from '../request-context/request-context.service';

/**
 * Logs method/path/status/duration for every request as structured
 * JSON — both successful (tap) and failed (catchError) — tagged with
 * the correlation id established by RequestContextMiddleware (the ONE
 * authoritative source of correlation ids; this interceptor no longer
 * generates its own, which would have created two competing ids for
 * the same request). Deliberately avoids logging request bodies/
 * headers, which may contain tokens, phone numbers, or addresses — see
 * spec section 31 (Observability): "avoid logging sensitive user
 * information".
 *
 * The error-path log is the Group 3 addition: previously a failed
 * request produced no log line at all here (`tap`'s success callback
 * never fires on an rxjs error). The underlying error is always
 * re-thrown unchanged afterward — this only observes it, it never
 * suppresses or alters what HttpExceptionFilter ultimately does with
 * it.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly requestContextService: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const correlationId = this.requestContextService.getCorrelationId();
    const method = request.method;
    const path = request.originalUrl ?? request.url;

    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          JSON.stringify({
            correlationId,
            method,
            path,
            statusCode: response.statusCode,
            durationMs: Date.now() - start,
          }),
        );
      }),
      catchError((error) => {
        this.logger.log(
          JSON.stringify({
            correlationId,
            method,
            path,
            statusCode: resolveHttpStatus(error),
            durationMs: Date.now() - start,
            failed: true,
          }),
        );
        return throwError(() => error);
      }),
    );
  }
}
