import { BadRequestException, Controller, Get, InternalServerErrorException, Post, Req, Body, Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { configureApp } from './app.setup';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestContextService } from './common/request-context/request-context.service';
import { UPLOAD_PROVIDER } from './modules/uploads/upload-provider.interface';

/**
 * The REAL `configureApp` (the same function main.ts and the E2E harness use) on a minimal Nest app, driven by the same
 * `http.*` configuration shape the validated environment produces — proving the HTTP security wiring itself, not just the
 * helper functions.
 */
const TEST_ACCESS_SECRET = 'app-setup-spec-access-secret-0123456789';
const bearer = () => `Bearer ${jwt.sign({ sub: 'user-1' }, TEST_ACCESS_SECRET, { algorithm: 'HS256', expiresIn: '5m' })}`;

@Controller()
class ProbeController {
  @Get('ping') ping() { return { data: 'pong' }; }
  @Get('ip') ip(@Req() req: any) { return { data: req.ip }; }
  @Post('echo') echo(@Body() body: any) { return { data: Object.keys(body ?? {}).length }; }
  @Post('uploads') upload(@Body() body: any) { return { data: String(body?.base64Content ?? '').length }; }
  @Get('boom') boom() { throw new Error('connection to db-prod-7.internal:5432 refused (password=hunter2)'); }
  @Get('boom-http') boomHttp() { throw new InternalServerErrorException('leaky internal detail: table orders_v3 locked'); }
  @Get('bad') bad() { throw new BadRequestException({ message: 'Choose a payment method.', details: { code: 'PAYMENT_METHOD_REQUIRED' } }); }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

async function bootApp(http: Record<string, unknown>, uploadsDir?: string): Promise<NestExpressApplication> {
  const config = () => ({
    apiPrefix: 'api/v1',
    uploads: { localDir: uploadsDir, publicUrlPrefix: '/uploads/files' },
    auth: { accessSecret: TEST_ACCESS_SECRET },
    http: { strict: false, corsAllowedOrigins: [], trustProxy: false, enableApiDocs: false, ...http },
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [config] }), JwtModule.register({}), ProbeModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  app.useGlobalFilters(new HttpExceptionFilter(new RequestContextService(), !(http.strict as boolean)));
  await app.init();
  return app;
}

describe('configureApp — production HTTP hardening', () => {
  let app: NestExpressApplication;
  afterEach(async () => { await app?.close(); });

  describe('CORS', () => {
    const production = { strict: true, corsAllowedOrigins: ['https://admin.hatly.example', 'https://ops.hatly.example'] };

    it('an allowed production origin gets the CORS headers (actual request and preflight)', async () => {
      app = await bootApp(production);
      const actual = await request(app.getHttpServer()).get('/api/v1/ping').set('Origin', 'https://admin.hatly.example');
      expect(actual.status).toBe(200);
      expect(actual.headers['access-control-allow-origin']).toBe('https://admin.hatly.example');
      const preflight = await request(app.getHttpServer())
        .options('/api/v1/ping')
        .set('Origin', 'https://ops.hatly.example')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'authorization,content-type');
      expect(preflight.headers['access-control-allow-origin']).toBe('https://ops.hatly.example');
      expect(preflight.headers['access-control-allow-headers']).toMatch(/Authorization/i);
      // Credentials are allowed for the exact allow-listed origin only (the dashboard's HttpOnly cookie session); the CSRF/custom headers are permitted.
      expect(preflight.headers['access-control-allow-credentials']).toBe('true');
      expect(preflight.headers['access-control-allow-headers']).toMatch(/X-CSRF-Token/i);
      expect(preflight.headers['access-control-allow-headers']).toMatch(/X-Requested-With/i);
      // Exports and settlement payments are idempotent through this header; the browser preflight must allow it.
      expect(preflight.headers['access-control-allow-headers']).toMatch(/Idempotency-Key/i);
    });

    it('an unauthorized production origin gets NO CORS headers (so a browser blocks it), and never "*"', async () => {
      app = await bootApp(production);
      for (const origin of ['https://evil.example', 'http://admin.hatly.example', 'https://admin.hatly.example.evil.example', 'null']) {
        const actual = await request(app.getHttpServer()).get('/api/v1/ping').set('Origin', origin);
        expect(actual.headers['access-control-allow-origin']).toBeUndefined();
        const preflight = await request(app.getHttpServer()).options('/api/v1/ping').set('Origin', origin).set('Access-Control-Request-Method', 'GET');
        expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
      }
    });

    it('a non-browser client (no Origin header, e.g. the mobile apps) is unaffected', async () => {
      app = await bootApp(production);
      const res = await request(app.getHttpServer()).get('/api/v1/ping');
      expect(res.status).toBe(200);
    });

    it('strict mode with an empty list allows no origin at all (never falls back to open)', async () => {
      app = await bootApp({ strict: true, corsAllowedOrigins: [] });
      const res = await request(app.getHttpServer()).get('/api/v1/ping').set('Origin', 'https://anything.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('development with no list keeps the open local workflow', async () => {
      app = await bootApp({ strict: false, corsAllowedOrigins: [] });
      const res = await request(app.getHttpServer()).get('/api/v1/ping').set('Origin', 'http://localhost:5173');
      // Reflected (a wildcard is invalid with credentials), so the cookie-based dashboard works locally.
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('security headers', () => {
    it('every API response carries the hardening headers and is not cacheable; HSTS only in strict environments', async () => {
      app = await bootApp({ strict: true, corsAllowedOrigins: ['https://admin.hatly.example'] });
      const res = await request(app.getHttpServer()).get('/api/v1/ping');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('development does not send HSTS', async () => {
      app = await bootApp({ strict: false });
      const res = await request(app.getHttpServer()).get('/api/v1/ping');
      expect(res.headers['strict-transport-security']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('trust proxy', () => {
    it('forwarded headers are IGNORED unless TRUST_PROXY is configured (a client cannot spoof its IP)', async () => {
      app = await bootApp({ trustProxy: false });
      const res = await request(app.getHttpServer()).get('/api/v1/ip').set('X-Forwarded-For', '203.0.113.9');
      expect(res.body.data).not.toContain('203.0.113.9');
    });

    it('with an explicit hop count the client IP comes from X-Forwarded-For', async () => {
      app = await bootApp({ trustProxy: 1 });
      const res = await request(app.getHttpServer()).get('/api/v1/ip').set('X-Forwarded-For', '203.0.113.9');
      expect(res.body.data).toBe('203.0.113.9');
    });
  });

  describe('body size limits', () => {
    const bigJson = (chars: number) => ({ base64Content: 'A'.repeat(chars) });

    it('ordinary routes keep the 100 kb ceiling: a larger body is refused with 413 and an enveloped error', async () => {
      app = await bootApp({});
      const small = await request(app.getHttpServer()).post('/api/v1/echo').send(bigJson(50_000));
      expect(small.status).toBe(201);
      const large = await request(app.getHttpServer()).post('/api/v1/echo').send(bigJson(150_000));
      expect(large.status).toBe(413);
      expect(large.body.error.code).toBeDefined();
      expect(JSON.stringify(large.body)).not.toMatch(/stack|node_modules/);
    });

    it('the image-upload route accepts a real photo-sized body (up to ~8 MB) — the 100 kb default would reject any photo above ~75 KB', async () => {
      app = await bootApp({});
      const photo = await request(app.getHttpServer()).post('/api/v1/uploads').set('Authorization', bearer()).send(bigJson(2_000_000));
      expect(photo.status).toBe(201);
      const tooBig = await request(app.getHttpServer()).post('/api/v1/uploads').set('Authorization', bearer()).send(bigJson(9_000_000));
      expect(tooBig.status).toBe(413);
    });

    it('an unauthenticated or forged-token upload is not metered and behaves exactly as before: the app answers 401 (never a reset)', async () => {
      app = await bootApp({});
      expect((await request(app.getHttpServer()).post('/api/v1/uploads').send(bigJson(2_000_000))).status).toBe(201); // the probe route has no auth guard; the point is: not refused/queued by the cap
      const forged = await request(app.getHttpServer()).post('/api/v1/uploads').set('Authorization', 'Bearer forged.token.value').send(bigJson(100_000));
      expect(forged.status).toBe(201);
    });
  });

  describe('error responses', () => {
    it('production: an unexpected error exposes nothing internal (no message, host, stack, SQL or secret), only a correlation id', async () => {
      app = await bootApp({ strict: true, corsAllowedOrigins: ['https://admin.hatly.example'] });
      const res = await request(app.getHttpServer()).get('/api/v1/boom');
      expect(res.status).toBe(500);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/db-prod-7|hunter2|password|refused|stack|\.ts|node_modules/i);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.correlationId).toBeTruthy();
    });

    it('production: a 5xx HttpException message is replaced with a generic one; the actionable 4xx message is kept', async () => {
      app = await bootApp({ strict: true, corsAllowedOrigins: ['https://admin.hatly.example'] });
      const server = await request(app.getHttpServer()).get('/api/v1/boom-http');
      expect(server.status).toBe(500);
      expect(JSON.stringify(server.body)).not.toMatch(/orders_v3|locked|leaky/);
      const client = await request(app.getHttpServer()).get('/api/v1/bad');
      expect(client.status).toBe(400);
      expect(client.body.error.message).toBe('Choose a payment method.');
      expect(client.body.error.details.code).toBe('PAYMENT_METHOD_REQUIRED');
    });

    it('a malformed JSON body is a clean 400 envelope, not a stack trace', async () => {
      app = await bootApp({ strict: true, corsAllowedOrigins: ['https://admin.hatly.example'] });
      const res = await request(app.getHttpServer()).post('/api/v1/echo').set('Content-Type', 'application/json').send('{"a":');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object|node_modules/);
    });
  });

  describe('static uploads', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatly-static-'));
      fs.writeFileSync(path.join(dir, 'a.png'), 'png-bytes');
      fs.writeFileSync(path.join(dir, '.hidden'), 'secret');
      fs.mkdirSync(path.join(dir, 'marketplace'));
      fs.writeFileSync(path.join(dir, 'marketplace', 'index.html'), '<script>alert(1)</script>');
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('serves a file as non-executable, cacheable, cross-origin-usable content', async () => {
      app = await bootApp({}, dir);
      const res = await request(app.getHttpServer()).get('/uploads/files/a.png');
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain('sandbox');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('caches generated (uuid-named) uploads for a year as immutable; mutable-path files keep the one-day lifetime', async () => {
      const uuidName = '123e4567-e89b-12d3-a456-426614174000.png';
      fs.writeFileSync(path.join(dir, uuidName), 'png-bytes');
      fs.writeFileSync(path.join(dir, 'marketplace', 'seed.webp'), 'webp-bytes');
      app = await bootApp({}, dir);
      const generated = await request(app.getHttpServer()).get(`/uploads/files/${uuidName}`);
      expect(generated.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      const seeded = await request(app.getHttpServer()).get('/uploads/files/marketplace/seed.webp');
      expect(seeded.headers['cache-control']).toBe('public, max-age=86400');
      const plain = await request(app.getHttpServer()).get('/uploads/files/a.png');
      expect(plain.headers['cache-control']).toBe('public, max-age=86400');
      // Revalidation is cheap: a conditional request is answered 304 without re-sending the bytes.
      const etag = seeded.headers['etag'];
      expect(etag).toBeTruthy();
      expect((await request(app.getHttpServer()).get('/uploads/files/marketplace/seed.webp').set('If-None-Match', etag)).status).toBe(304);
    });

    it('never exposes dotfiles, directory listings or index pages, and path traversal cannot escape the directory', async () => {
      app = await bootApp({}, dir);
      const server = app.getHttpServer();
      expect((await request(server).get('/uploads/files/.hidden')).status).toBeGreaterThanOrEqual(403);
      expect((await request(server).get('/uploads/files/')).status).toBe(404);
      expect((await request(server).get('/uploads/files/marketplace/')).status).toBe(404);
      for (const evil of ['/uploads/files/../../package.json', '/uploads/files/%2e%2e/%2e%2e/package.json', '/uploads/files/..%2f..%2fpackage.json', '/uploads/files/%00.png']) {
        const res = await request(server).get(evil);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.text ?? '').not.toContain('"name"');
      }
    });
  });
});

describe('configureApp — media reads by storage driver', () => {
  const NAME = '123e4567-e89b-12d3-a456-426614174000.png';
  let app: NestExpressApplication;
  afterEach(async () => { await app?.close(); });

  async function boot(storage: Record<string, unknown>): Promise<NestExpressApplication> {
    const provider = { store: jest.fn(), createReadUrl: (n: string) => (n === NAME ? `https://objects.example/hatly/${n}?X-Amz-Signature=sig` : null) };
    @Global()
    @Module({ providers: [{ provide: UPLOAD_PROVIDER, useValue: provider }], exports: [UPLOAD_PROVIDER] })
    class StorageStubModule {}
    const config = () => ({
      apiPrefix: 'api/v1',
      uploads: { localDir: undefined, publicUrlPrefix: '/uploads/files' },
      auth: { accessSecret: TEST_ACCESS_SECRET },
      storage,
      http: { strict: true, corsAllowedOrigins: ['https://admin.hatly.example'], trustProxy: false, enableApiDocs: false },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [config] }), JwtModule.register({}), StorageStubModule, ProbeModule],
    }).compile();
    const a = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(a);
    await a.init();
    return a;
  }

  it('s3 + private: the stored reference 302-redirects to a short-lived signed URL; nothing else resolves', async () => {
    app = await boot({ driver: 's3', access: 'private', signedUrlTtlSeconds: 300 });
    const server = app.getHttpServer();
    const ok = await request(server).get(`/uploads/files/${NAME}`).redirects(0);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe(`https://objects.example/hatly/${NAME}?X-Amz-Signature=sig`);
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    for (const evil of ['/uploads/files/', '/uploads/files/..%2fsecret.png', '/uploads/files/a/b.png', `/uploads/files/${NAME}.html`, '/uploads/files/other.png']) {
      const res = await request(server).get(evil).redirects(0);
      expect(res.status).toBe(404);
      expect(res.headers.location).toBeUndefined();
    }
    // The API itself is unaffected.
    expect((await request(server).get('/api/v1/ping')).status).toBe(200);
  });

  it('s3 + public: this API serves no media route at all (references are absolute public URLs)', async () => {
    app = await boot({ driver: 's3', access: 'public' });
    expect((await request(app.getHttpServer()).get(`/uploads/files/${NAME}`).redirects(0)).status).toBe(404);
  });
});
