import { of, throwError, lastValueFrom } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { LoggingInterceptor } from './logging.interceptor';
import { RequestContextService } from '../request-context/request-context.service';

function buildContext(overrides: { method?: string; originalUrl?: string; statusCode?: number } = {}) {
  const request: any = { method: overrides.method ?? 'GET', originalUrl: overrides.originalUrl ?? '/orders/1', headers: {} };
  const response: any = { statusCode: overrides.statusCode ?? 200, setHeader: jest.fn() };
  const context: any = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  };
  return { request, response, context };
}

function buildInterceptor(correlationId = 'corr-abc') {
  const requestContextService = { getCorrelationId: jest.fn(() => correlationId) };
  const interceptor = new LoggingInterceptor(requestContextService as unknown as RequestContextService);
  return { interceptor, requestContextService };
}

describe('LoggingInterceptor', () => {
  it('CRITICAL: never generates its own correlation id — reads it exclusively from RequestContextService', async () => {
    const { interceptor, requestContextService } = buildInterceptor('corr-from-context');
    const { context, response } = buildContext();
    const handler = { handle: () => of('ok') };

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(requestContextService.getCorrelationId).toHaveBeenCalled();
    // No duplicate id source: the interceptor itself never sets the
    // response header (RequestContextMiddleware already did, once).
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('logs method/path/status/duration for a successful request (existing behavior preserved)', async () => {
    const { interceptor } = buildInterceptor('corr-success');
    const { context } = buildContext({ method: 'POST', originalUrl: '/orders', statusCode: 201 });
    const handler = { handle: () => of({ id: 'order-1' }) };
    const logSpy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);

    await lastValueFrom(interceptor.intercept(context, handler));

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ correlationId: 'corr-success', method: 'POST', path: '/orders', statusCode: 201 });
    expect(typeof logged.durationMs).toBe('number');
    logSpy.mockRestore();
  });

  it('CRITICAL: a failed request is also logged (previously silent), and the original error still propagates unchanged', async () => {
    const { interceptor } = buildInterceptor('corr-failed');
    const { context } = buildContext({ method: 'POST', originalUrl: '/orders' });
    const originalError = new BadRequestException('Cannot create order.');
    const handler = { handle: () => throwError(() => originalError) };
    const logSpy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);

    let caught: unknown;
    try {
      await lastValueFrom(interceptor.intercept(context, handler));
    } catch (err) {
      caught = err;
    }

    // Never suppressed/altered — the exact same error object still
    // reaches whatever is downstream (HttpExceptionFilter in the real
    // pipeline).
    expect(caught).toBe(originalError);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ correlationId: 'corr-failed', method: 'POST', path: '/orders', statusCode: 400, failed: true });
    logSpy.mockRestore();
  });

  it('logs a 500 status for a failed request driven by a non-HttpException error', async () => {
    const { interceptor } = buildInterceptor('corr-500');
    const { context } = buildContext();
    const handler = { handle: () => throwError(() => new Error('unexpected')) };
    const logSpy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);

    await expect(lastValueFrom(interceptor.intercept(context, handler))).rejects.toThrow('unexpected');

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.statusCode).toBe(500);
    logSpy.mockRestore();
  });
});
