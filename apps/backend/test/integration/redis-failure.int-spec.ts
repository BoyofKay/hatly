import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createIntegrationApp } from './support/app';
import { REDIS_CLIENT } from '../../src/common/redis/redis.constants';

/**
 * Controlled Redis failure, WITHOUT stopping the developer's real Redis
 * server: the application is booted with its shared client (built by the
 * production `createRedisClient` factory) pointed at a port nothing
 * listens on. That is the same client, options and error handling the
 * app has when Redis genuinely goes away, with zero risk to the shared
 * server. Documented scope: connection-refused outage from boot. (A
 * mid-flight server kill is not exercised because it would require
 * stopping the shared local service.)
 */
describe('Application behaviour when Redis is unavailable', () => {
  const DEAD_REDIS = 'redis://:super-secret-password@127.0.0.1:6399/15';
  let app: NestExpressApplication;
  let logged: string[];
  let errorSpy: jest.SpyInstance;

  beforeAll(async () => {
    logged = [];
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
    app = await createIntegrationApp({ redisUrl: DEAD_REDIS });
  });

  afterAll(async () => {
    await app?.close();
    errorSpy.mockRestore();
  });

  it('the process does not crash: the app boots, keeps serving requests, and the client is reconnecting', async () => {
    const redis = app.get<Redis>(REDIS_CLIENT);
    expect(['connecting', 'reconnecting', 'wait']).toContain(redis.status);
    const live = await request(app.getHttpServer()).get('/api/v1/health');
    expect(live.status).toBe(200);
  });

  it('a Redis-dependent request FAILS FAST (bounded retries, not the ~10s ioredis default) with a sanitized 503 envelope and correlation id', async () => {
    const t0 = Date.now();
    const phone = `+2010${String(Date.now()).slice(-8)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/customer/password/register')
      .set('x-correlation-id', 'redis-down-1')
      // OTP is on by default, so registration checks its code in Redis FIRST — before any account row could be written
      .send({ phone, fullName: 'Integration Test', password: 'Integration-Test-1', code: '123456' });
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(4000);
    // 503 (not a generic 500): a Redis outage is a dependency failure the client may retry (Group 8).
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'A required service is temporarily unavailable. Please try again shortly.', correlationId: 'redis-down-1' },
    });
    // ...and nothing was persisted: the failure happened before the account insert, so a retry is a clean retry
    expect(await app.get(DataSource).query('SELECT 1 FROM users WHERE phone = $1', [phone])).toEqual([]);
  });

  it('nothing sensitive leaks: neither the connection password nor URL reaches an HTTP response or a log line', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
    expect(res.status).toBe(503);
    const everything = JSON.stringify(res.body) + logged.join('\n');
    expect(everything).not.toContain('super-secret-password');
    expect(everything).not.toContain('redis://');
    expect(logged.some((l) => l.includes('Redis connection error'))).toBe(true); // the failure IS observable in logs
  });

  it('shutdown does not hang on a dead Redis (the lifecycle hook hard-disconnects a non-ready client)', async () => {
    const second = await createIntegrationApp({ redisUrl: DEAD_REDIS });
    const t0 = Date.now();
    await second.close();
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
