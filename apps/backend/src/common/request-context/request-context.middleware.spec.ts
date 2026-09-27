import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from './request-context.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildReqRes(overrides: { headers?: Record<string, unknown>; method?: string; originalUrl?: string } = {}) {
  const req: any = {
    headers: overrides.headers ?? {},
    method: overrides.method ?? 'GET',
    originalUrl: overrides.originalUrl ?? '/orders/123',
    // Sensitive fields a real Express request would carry — the context
    // built from this request must never include these.
    body: { password: 'hunter2', otp: '123456', cardNumber: '4111111111111111' },
    cookies: { session: 'sess-abc-secret' },
  };
  req.headers.authorization = 'Bearer super-secret-jwt';
  const res: any = { setHeader: jest.fn() };
  const next = jest.fn();
  return { req, res, next };
}

describe('RequestContextMiddleware', () => {
  it('sets the x-correlation-id response header and calls next()', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const { req, res, next } = buildReqRes({ headers: { 'x-correlation-id': 'client-supplied-id' } });

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'client-supplied-id');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a fresh correlation id when none is supplied by the client', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const { req, res, next } = buildReqRes();

    middleware.use(req, res, next);

    const headerValue = res.setHeader.mock.calls[0][1];
    expect(headerValue).toMatch(UUID_PATTERN);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('CRITICAL: an unsafe client-supplied id (newline injection) never reaches the response header', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const { req, res, next } = buildReqRes({
      headers: { 'x-correlation-id': 'abc\nX-Injected: evil' },
    });

    middleware.use(req, res, next);

    const headerValue = res.setHeader.mock.calls[0][1];
    expect(headerValue).toMatch(UUID_PATTERN);
    expect(headerValue).not.toContain('\n');
  });

  it('establishes a request context that is readable from inside next(), containing only correlationId/method/path', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const { req, res } = buildReqRes({ method: 'POST', originalUrl: '/orders', headers: { 'x-correlation-id': 'corr-xyz' } });

    let observed: unknown;
    const next = jest.fn(() => {
      observed = service.get();
    });

    middleware.use(req, res, next);

    expect(observed).toEqual({ correlationId: 'corr-xyz', method: 'POST', path: '/orders' });
  });

  it('CRITICAL: the established context never contains the Authorization header, cookies, or request body (passwords/OTP/payment data)', () => {
    const service = new RequestContextService();
    const middleware = new RequestContextMiddleware(service);
    const { req, res } = buildReqRes({ headers: { 'x-correlation-id': 'corr-privacy' } });

    let observed: unknown;
    const next = jest.fn(() => {
      observed = service.get();
    });

    middleware.use(req, res, next);

    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain('super-secret-jwt');
    expect(serialized).not.toContain('sess-abc-secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain('4111111111111111');
  });
});
