import { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createIntegrationApp } from './support/app';

describe('Health endpoints against real PostgreSQL + Redis (GET /api/v1/health, /api/v1/health/ready)', () => {
  describe('both dependencies available', () => {
    let app: NestExpressApplication;
    beforeAll(async () => {
      app = await createIntegrationApp();
    });
    afterAll(async () => {
      await app?.close();
    });

    it('liveness returns 200 { data: { status: "ok" } } with no authentication', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { status: 'ok' } });
    });

    it('readiness reports database up AND redis up, with HTTP 200', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { status: 'ok', checks: { database: 'up', redis: 'up' } } });
    });

    it('exposes nothing about the infrastructure (no hostnames, ports, URLs, credentials, database names)', async () => {
      const body = JSON.stringify((await request(app.getHttpServer()).get('/api/v1/health/ready')).body);
      for (const secret of ['localhost', '127.0.0.1', '5432', '6379', 'hatly:hatly', 'postgres://', 'redis://', 'hatly_integration_test']) {
        expect(body).not.toContain(secret);
      }
    });
  });

  describe('a dependency is down (controlled, per-app-instance failures — the shared Postgres/Redis servers are never touched)', () => {
    it('Redis unreachable: liveness stays 200 (independent of dependencies); readiness is 503 with redis "down", database "up", within its bounded timeout, and leaks no address', async () => {
      const app = await createIntegrationApp({ redisUrl: 'redis://127.0.0.1:6399/15' });
      try {
        const live = await request(app.getHttpServer()).get('/api/v1/health');
        expect(live.status).toBe(200);

        const t0 = Date.now();
        const ready = await request(app.getHttpServer()).get('/api/v1/health/ready');
        expect(Date.now() - t0).toBeLessThan(4000);
        expect(ready.status).toBe(503);
        expect(ready.body.error.details).toEqual({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
        expect(JSON.stringify(ready.body)).not.toMatch(/6399|127\.0\.0\.1|ECONNREFUSED|redis:\/\//);
      } finally {
        await app.close();
      }
    });

    it('PostgreSQL connection closed: liveness stays 200; readiness is 503 with database "down", redis "up"', async () => {
      const app = await createIntegrationApp();
      try {
        await app.get(DataSource).destroy(); // this app instance loses its own database connections
        const live = await request(app.getHttpServer()).get('/api/v1/health');
        expect(live.status).toBe(200);

        const ready = await request(app.getHttpServer()).get('/api/v1/health/ready');
        expect(ready.status).toBe(503);
        expect(ready.body.error.details).toEqual({ status: 'degraded', checks: { database: 'down', redis: 'up' } });
        expect(JSON.stringify(ready.body)).not.toMatch(/5432|localhost|hatly:hatly|postgres:\/\//);
      } finally {
        await app.close();
      }
    });
  });
});
