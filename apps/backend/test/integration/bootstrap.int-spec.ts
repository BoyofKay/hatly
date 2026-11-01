import { NestExpressApplication } from '@nestjs/platform-express';
import { AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import request = require('supertest');
import { createIntegrationApp } from './support/app';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';
import { INTEGRATION_REDIS_DB } from './support/config';

describe('Real Nest application bootstrap (real PostgreSQL + real Redis)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createIntegrationApp({ listen: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('initializes every module, the real DataSource, and the shared Redis provider', async () => {
    const dataSource = app.get(DataSource);
    expect(dataSource.isInitialized).toBe(true);
    expect((await dataSource.query('SELECT current_database() AS db'))[0].db).toBe('hatly_integration_test');

    const redis = app.get<Redis>(REDIS_CLIENT);
    expect(await redis.ping()).toBe('PONG');
    expect(redis.options.db).toBe(INTEGRATION_REDIS_DB);
  });

  it('the APPLICATION\'s DataSource returns bigint as JS numbers (parseInt8) — money arithmetic can never silently concatenate strings', async () => {
    const [row] = await app.get(DataSource).query('SELECT 99999999999::bigint AS n, count(*) AS c FROM migrations');
    expect(row.n).toBe(99_999_999_999);
    expect(typeof row.c).toBe('number');
  });

  it('listens on a real TCP port and serves the real health endpoint over the socket', async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    expect(address.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { status: 'ok' } });
  });

  it('the global prefix, correlation middleware, JWT guard and exception filter are all active on the real pipeline', async () => {
    const http = request(app.getHttpServer());

    // Correlation middleware echoes a valid client id and generates one otherwise.
    const echoed = await http.get('/api/v1/health').set('x-correlation-id', 'int-test-123');
    expect(echoed.headers['x-correlation-id']).toBe('int-test-123');
    const generated = await http.get('/api/v1/health');
    expect(generated.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);

    // A protected route without a token is rejected by the real global JwtAuthGuard, through the real filter envelope.
    const unauth = await http.get('/api/v1/orders').set('x-correlation-id', 'int-test-401');
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.correlationId).toBe('int-test-401');

    // Unknown route -> 404 through the same envelope; the route did not exist so no prefix leak.
    const missing = await http.get('/api/v1/definitely-not-a-route');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('the global ValidationPipe is active (whitelist + forbidNonWhitelisted) on a real public route', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/customer/password/login').send({ unexpected: 'field' });
    expect(res.status).toBe(400);
  });

  it('unconfigured external providers (Unifonic/FCM/Google Maps) neither block startup nor can send anything: the retired OTP registration stub answers 410, creates nothing and stores no code', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ phone: '+201000000001', fullName: 'Integration Test' });
    // The legacy OTP registration route is retired (410, with a stable code older apps can map): it never creates an account,
    // never stores a code and never calls a provider — so an unconfigured Unifonic cannot matter to it.
    expect(res.status).toBe(410);
    expect(res.body.error.details).toMatchObject({ code: 'LEGACY_OTP_REGISTRATION_RETIRED' });
    expect(JSON.stringify(res.body)).not.toMatch(/SMS_PROVIDER|unifonic|appsid/i);
    expect(await app.get<Redis>(REDIS_CLIENT).get('otp:+201000000001')).toBeNull();
    // ...and the OTP-as-login endpoint no longer exists at all.
    const verify = await request(app.getHttpServer()).post('/api/v1/auth/otp/verify').send({ phone: '+201000000001', code: '123456' });
    expect(verify.status).toBe(404);
  });

  it('serves Swagger docs (configureApp ran exactly as in production)', async () => {
    const res = await request(app.getHttpServer()).get('/docs');
    expect([200, 301, 302]).toContain(res.status);
  });

  it('graceful shutdown: app.close() closes the shared Redis client and the DataSource (no leaked connections)', async () => {
    const second = await createIntegrationApp();
    const redis = second.get<Redis>(REDIS_CLIENT);
    const dataSource = second.get(DataSource);
    expect(redis.status).toBe('ready');

    await second.close();

    // QUIT resolves when the server acknowledges; the socket's 'end' state lands a moment later.
    for (let i = 0; i < 50 && redis.status !== 'end'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(redis.status).toBe('end');
    expect(dataSource.isInitialized).toBe(false);
  });
});
