import { BadRequestException, ConflictException, HttpException, HttpStatus, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { RequestContextService } from '../request-context/request-context.service';

function buildHost(overrides: { method?: string; url?: string } = {}) {
  const req: any = { method: overrides.method ?? 'GET', url: overrides.url ?? '/orders/1' };
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host: any = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  };
  return { req, res, host };
}

function buildFilter(correlationId = 'test-correlation-id', exposeServerErrorMessages = true) {
  const requestContextService = { getCorrelationId: jest.fn(() => correlationId) };
  const filter = new HttpExceptionFilter(requestContextService as unknown as RequestContextService, exposeServerErrorMessages);
  return { filter, requestContextService };
}

describe('HttpExceptionFilter', () => {
  it('preserves the existing error envelope for a BadRequestException, and adds correlationId', () => {
    const { filter } = buildFilter('corr-1');
    const { res, host } = buildHost();

    filter.catch(new BadRequestException({ message: 'Invalid input.', details: { code: 'FOO' } }), host);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'BAD_REQUEST', message: 'Invalid input.', details: { code: 'FOO' }, correlationId: 'corr-1' },
    });
  });

  it('includes correlationId for a NotFoundException (existing envelope shape unchanged otherwise)', () => {
    const { filter } = buildFilter('corr-404');
    const { res, host } = buildHost();

    filter.catch(new NotFoundException('Order not found.'), host);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Order not found.', correlationId: 'corr-404' },
    });
  });

  it('includes correlationId for an UnauthorizedException (authentication failure)', () => {
    const { filter } = buildFilter('corr-auth');
    const { res, host } = buildHost();

    filter.catch(new UnauthorizedException(), host);

    expect(res.status).toHaveBeenCalledWith(401);
    const body = res.json.mock.calls[0][0];
    expect(body.error.correlationId).toBe('corr-auth');
  });

  it('includes correlationId for a ConflictException (permission/state-conflict-style failure)', () => {
    const { filter } = buildFilter('corr-conflict');
    const { res, host } = buildHost();

    filter.catch(new ConflictException('Already exists.'), host);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].error.correlationId).toBe('corr-conflict');
  });

  it('CRITICAL: an unexpected (non-HttpException) error returns 500 with correlationId, never a raw message/stack', () => {
    const { filter } = buildFilter('corr-500');
    const { res, host } = buildHost();

    filter.catch(new Error('raw internal detail: db password is hunter2'), host);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', correlationId: 'corr-500' },
    });
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('raw internal detail');
  });

  it('CRITICAL: the unhandled-exception log line contains the correlation id, method, and path', () => {
    const { filter } = buildFilter('corr-log');
    const { host } = buildHost({ method: 'POST', url: '/orders' });
    const errorSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);

    filter.catch(new Error('boom'), host);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [logMessage] = errorSpy.mock.calls[0];
    expect(logMessage).toContain('corr-log');
    expect(logMessage).toContain('POST');
    expect(logMessage).toContain('/orders');
    errorSpy.mockRestore();
  });

  it('does not log anything for an ordinary HttpException (expected business rejection)', () => {
    const { filter } = buildFilter();
    const { host } = buildHost();
    const errorSpy = jest.spyOn((filter as any).logger, 'error').mockImplementation(() => undefined);

    filter.catch(new BadRequestException('Nope.'), host);

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a 429 never exposes the throttler class name (Group 8): stable code and a plain message', () => {
    const { filter } = buildFilter('corr-429');
    const { res, host } = buildHost();
    filter.catch(new HttpException('ThrottlerException: Too Many Requests', HttpStatus.TOO_MANY_REQUESTS), host);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Please try again later.', correlationId: 'corr-429' },
    });
  });

  describe('dependency outage (Group 8 regression)', () => {
    it.each([
      ['ioredis gave up retrying', Object.assign(new Error('Reached the max retries per request limit (which is 3).'), { name: 'MaxRetriesPerRequestError' })],
      ['ioredis connection closed', new Error('Connection is closed.')],
    ])('%s → 503 SERVICE_UNAVAILABLE with a generic message and no internals', (_label, error) => {
      const { filter } = buildFilter('corr-503');
      const { res, host } = buildHost();
      filter.catch(error, host);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'A required service is temporarily unavailable. Please try again shortly.', correlationId: 'corr-503' },
      });
    });

    it('an ordinary programming error stays a generic 500', () => {
      const { filter } = buildFilter();
      const { res, host } = buildHost();
      filter.catch(new TypeError('Cannot read properties of undefined'), host);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('errors raised below Nest (body-parser / http-errors) — Group 8 regression', () => {
    const httpError = (status: number, message: string, expose = true) => Object.assign(new Error(message), { status, statusCode: status, expose });

    it('answers a body that is too large with 413 and the safe message — not a generic 500', () => {
      const { filter } = buildFilter('corr-413');
      const { res, host } = buildHost();
      filter.catch(httpError(413, 'request entity too large'), host);
      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large', correlationId: 'corr-413' },
      });
    });

    it('a client-side http-error keeps its own 4xx (400 parse failure, 415 unsupported encoding)', () => {
      for (const [status, name] of [[400, 'BAD_REQUEST'], [415, 'UNSUPPORTED_MEDIA_TYPE']] as const) {
        const { filter } = buildFilter();
        const { res, host } = buildHost();
        filter.catch(httpError(status, 'x'), host);
        expect(res.status).toHaveBeenCalledWith(status);
        expect(res.json.mock.calls[0][0].error.code).toBe(name);
      }
    });

    it('an error that is NOT marked expose, a 5xx, or a plain Error is still a generic 500 with no internals', () => {
      for (const err of [httpError(413, 'secret detail', false), httpError(500, 'boom'), new Error('database password is hunter2')]) {
        const { filter } = buildFilter();
        const { res, host } = buildHost();
        filter.catch(err, host);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/secret detail|hunter2|boom/);
      }
    });
  });

  describe('correlation id for failures that happen before the request-context middleware', () => {
    it('uses the caller\'s valid x-correlation-id (and echoes it as a header) instead of the "no-request-context" placeholder', () => {
      const { filter } = buildFilter('no-request-context');
      const { req, res, host } = buildHost();
      req.headers = { 'x-correlation-id': 'client-trace-1' };
      res.setHeader = jest.fn();
      filter.catch(new NotFoundException('nope'), host);
      expect(res.json.mock.calls[0][0].error.correlationId).toBe('client-trace-1');
      expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'client-trace-1');
    });

    it('generates a fresh id when the caller sent none or an invalid one', () => {
      for (const headers of [{}, { 'x-correlation-id': 'bad id!' }] as Array<Record<string, string>>) {
        const { filter } = buildFilter('no-request-context');
        const { req, res, host } = buildHost();
        req.headers = headers;
        res.setHeader = jest.fn();
        filter.catch(new NotFoundException('nope'), host);
        const id = res.json.mock.calls[0][0].error.correlationId;
        expect(id).not.toBe('no-request-context');
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', id);
      }
    });
  });

  describe('M5 Batch 1 — server-error observability and production safety', () => {
    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => errorSpy.mockRestore());

    it('a 5xx HttpException now leaves a server-side log line with the correlation id and the full detail (it used to log nothing)', () => {
      const { filter } = buildFilter('corr-500');
      const { host } = buildHost({ url: '/orders?phone=%2B201000000000&q=secret' });

      filter.catch(new ServiceUnavailableException('read replica lag exceeded'), host);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const line = String(errorSpy.mock.calls[0][0]);
      expect(line).toContain('corr-500');
      expect(line).toContain('read replica lag exceeded');
      expect(line).toContain('/orders');
    });

    it('server-side logs carry the PATH only — never the query string (phone numbers, coordinates, search terms)', () => {
      const { filter } = buildFilter('corr-q');
      const { host } = buildHost({ url: '/vendors?lat=30.1&lng=31.2&phone=%2B20100&q=x' });
      filter.catch(new Error('boom'), host);
      filter.catch(new InternalServerErrorException('x'), host);
      for (const call of errorSpy.mock.calls) {
        expect(String(call[0])).not.toMatch(/phone|lat=|lng=|q=x|%2B20100/);
      }
    });

    it('4xx responses are not logged as server errors', () => {
      const { filter } = buildFilter();
      filter.catch(new BadRequestException('nope'), buildHost().host);
      filter.catch(new NotFoundException('nope'), buildHost().host);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('production mode: a 5xx HttpException message and details are replaced by a generic message; the correlation id stays', () => {
      const { filter } = buildFilter('corr-prod', false);
      const { res, host } = buildHost();
      filter.catch(new InternalServerErrorException({ message: 'column "ssn" of relation "users" does not exist', details: { sql: 'select ...' } }), host);
      const body = res.json.mock.calls[0][0];
      expect(body.error.message).toBe('Something went wrong. Please try again.');
      expect(body.error.details).toBeUndefined();
      expect(body.error.correlationId).toBe('corr-prod');
      expect(JSON.stringify(body)).not.toMatch(/ssn|users|select/);
    });

    it('production mode keeps the actionable 4xx message and details untouched', () => {
      const { filter } = buildFilter('c', false);
      const { res, host } = buildHost();
      filter.catch(new BadRequestException({ message: 'Choose a payment method.', details: { code: 'PAYMENT_METHOD_REQUIRED' } }), host);
      expect(res.json.mock.calls[0][0].error).toMatchObject({ message: 'Choose a payment method.', details: { code: 'PAYMENT_METHOD_REQUIRED' } });
    });

    it('an unknown error never reaches the client in any mode — only the generic message', () => {
      for (const expose of [true, false]) {
        const { filter } = buildFilter('c', expose);
        const { res, host } = buildHost();
        filter.catch(new Error('password authentication failed for user "hatly" at 10.0.3.7:5432'), host);
        const body = res.json.mock.calls[0][0];
        expect(body.error.message).toBe('Something went wrong. Please try again.');
        expect(JSON.stringify(body)).not.toMatch(/hatly|10\.0\.3\.7|password/);
      }
    });
  });
});
