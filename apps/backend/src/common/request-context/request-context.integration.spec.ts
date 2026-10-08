import { BadRequestException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { RequestContextService } from './request-context.service';
import { RequestContextMiddleware } from './request-context.middleware';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';

/**
 * End-to-end style test: exercises the REAL RequestContextService (not
 * a mock of it) across the middleware, a deep "service" with no HTTP
 * awareness, the interceptor, and the exception filter together — the
 * actual observable contract this group exists to deliver, not just
 * each piece in isolation with everything else mocked away.
 */
function buildReqRes(headers: Record<string, unknown> = {}) {
  const req: any = { method: 'POST', originalUrl: '/orders', url: '/orders', headers };
  const res: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(), statusCode: 200 };
  return { req, res };
}

class DeepOrderService {
  constructor(private readonly requestContextService: RequestContextService) {}

  async createOrder(): Promise<string> {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 1));
    return this.requestContextService.getCorrelationId();
  }
}

describe('Request context — end-to-end', () => {
  it('the same correlation id flows from the middleware, through a deep service, into a successful response', async () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const deepService = new DeepOrderService(service);
    const { req, res } = buildReqRes({ 'x-correlation-id': 'e2e-success' });

    let observedByDeepService: string | undefined;
    const next = jest.fn(async () => {
      observedByDeepService = await deepService.createOrder();
    });

    middleware.use(req, res, next);
    // middleware.use starts the async next() chain and returns; wait for THAT chain to finish (not a wall-clock delay,
    // which a loaded machine can outrun — the assertion then saw the not-yet-written value).
    await next.mock.results[0].value;

    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'e2e-success');
    expect(observedByDeepService).toBe('e2e-success');
  });

  it('the same correlation id appears in the response header AND the error body when a request fails', async () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const filter = new HttpExceptionFilter(service);
    const { req, res } = buildReqRes({ 'x-correlation-id': 'e2e-failure' });

    // In the real pipeline, guards/pipes/the handler/the exception
    // filter all execute as part of the SAME continuation next()
    // starts — not after middleware.use() has already returned. The
    // filter must therefore be invoked from *inside* next(), exactly
    // as it is here, to accurately exercise the AsyncLocalStorage scope
    // established by the middleware.
    const next = jest.fn(() => {
      try {
        throw new BadRequestException('Cannot create order.');
      } catch (err) {
        filter.catch(err, {
          switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
        } as any);
      }
    });

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'e2e-failure');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ correlationId: 'e2e-failure' }) }),
    );
  });

  it('concurrent end-to-end requests through the middleware never cross-contaminate their correlation ids', async () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const deepService = new DeepOrderService(service);

    async function simulateRequest(correlationId: string): Promise<string> {
      const { req, res } = buildReqRes({ 'x-correlation-id': correlationId });
      let observed = '';
      const next = jest.fn(async () => {
        observed = await deepService.createOrder();
      });
      middleware.use(req, res, next);
      await next.mock.results[0].value; // this request's own chain, however long the machine takes
      return observed;
    }

    const [a, b, c] = await Promise.all([
      simulateRequest('concurrent-1'),
      simulateRequest('concurrent-2'),
      simulateRequest('concurrent-3'),
    ]);

    expect(a).toBe('concurrent-1');
    expect(b).toBe('concurrent-2');
    expect(c).toBe('concurrent-3');
  });

  it('the interceptor reads the same id the middleware established, with no second id generated', async () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const interceptor = new LoggingInterceptor(service);
    const { req, res } = buildReqRes({ 'x-correlation-id': 'e2e-interceptor' });
    const logSpy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);

    const next = jest.fn(async () => {
      const context: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
      const handler = { handle: () => of('ok') };
      await lastValueFrom(interceptor.intercept(context, handler));
    });

    middleware.use(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged.correlationId).toBe('e2e-interceptor');
    // Header was set exactly once (by the middleware) — the
    // interceptor did not add a second, competing id.
    expect(res.setHeader).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });

  it('a failed request still logs via the interceptor and still reaches the filter with the correct correlation id', async () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const interceptor = new LoggingInterceptor(service);
    const filter = new HttpExceptionFilter(service);
    const { req, res } = buildReqRes({ 'x-correlation-id': 'e2e-failed-pipeline' });
    const logSpy = jest.spyOn((interceptor as any).logger, 'log').mockImplementation(() => undefined);

    const next = jest.fn(async () => {
      const context: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
      const handler = { handle: () => throwError(() => new BadRequestException('nope')) };
      try {
        await lastValueFrom(interceptor.intercept(context, handler));
      } catch (err) {
        filter.catch(err, { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any);
      }
    });

    middleware.use(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const logged = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ correlationId: 'e2e-failed-pipeline', failed: true, statusCode: 400 });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ correlationId: 'e2e-failed-pipeline' }) }),
    );
    logSpy.mockRestore();
  });
});
