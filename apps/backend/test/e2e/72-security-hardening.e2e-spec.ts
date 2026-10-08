/**
 * M5 Batch 1 — runtime security over real HTTP, against the REAL fully-wired application (real configureApp, real
 * guards/filter/interceptor, real upload pipeline writing to a real directory). The configuration-level rules (production
 * CORS allow-list, trust-proxy, error masking) are proven in src/app.setup.spec.ts and src/config/env.validation.spec.ts;
 * this proves the hardening is actually in effect end to end and that legitimate image workflows still work.
 */
import * as http from 'http';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, PNG_1X1_BASE64 } from './support/actors';

const raw = (world: World, opts: { method: string; path: string; headers?: Record<string, string>; body?: string }) =>
  new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const u = new URL(world.baseUrl);
    const req = http.request({ host: u.hostname, port: u.port, method: opts.method, path: opts.path, headers: opts.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });

/** A signature-valid JPEG of an arbitrary size (realistic photo-sized payloads exercise the body-limit path). */
const jpegOfSize = (bytes: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), Buffer.alloc(Math.max(0, bytes - 22), 0x42), Buffer.from([0xff, 0xd9])]);

describe('E2E — runtime security hardening (M5 Batch 1)', () => {
  let world: World;
  let s: Scenario;
  let customer: Actor;

  beforeAll(async () => {
    world = await bootWorld();
    s = new Scenario(world);
    customer = await s.customer('Security Hardening Customer');
  });
  afterAll(async () => {
    await world.close();
  });

  const upload = (base64Content: string, filename = 'photo.jpg') => world.api('post', '/uploads', { token: customer.accessToken, body: { base64Content, filename } });

  describe('response headers', () => {
    it('API responses carry the security headers, are not cacheable and reveal no framework', async () => {
      const res = await raw(world, { method: 'GET', path: '/api/v1/health' });
      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(String(res.headers['content-security-policy'])).toContain("default-src 'none'");
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-correlation-id']).toBeTruthy();
    });

    it('an ordinary route still rejects an oversized body (413) with the standard error envelope and a correlation id', async () => {
      const res = await world.api('post', '/auth/refresh', { body: { refreshToken: 'x'.repeat(200_000) } });
      expect(res.status).toBe(413);
      expect(res.body.error.correlationId).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules/);
    });
  });

  describe('image uploads', () => {
    it('a real image uploads (201), is stored under a server-generated name with the DETECTED extension, and is served non-executable', async () => {
      const res = await upload(PNG_1X1_BASE64, 'anything.jpg'); // client name/extension is ignored — the bytes decide
      expect(res.status).toBe(201);
      const url: string = res.body.data.url;
      expect(url).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.png$/);

      const served = await raw(world, { method: 'GET', path: url });
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(String(served.headers['content-security-policy'])).toContain('sandbox');
      expect(served.body.toString('base64')).toBe(PNG_1X1_BASE64);
    });

    it('a realistic photo-sized upload (~1 MB) works — the previous 100 kb body ceiling would have refused any photo above ~75 KB', async () => {
      const res = await upload(jpegOfSize(1_000_000).toString('base64'));
      expect(res.status).toBe(201);
      expect(res.body.data.url).toMatch(/\.jpg$/);
    });

    it('rejects non-image content (HTML, SVG, PDF, text) with UNSUPPORTED_IMAGE_TYPE and stores nothing', async () => {
      const before = await world.ds.query('SELECT count(*)::int AS n FROM uploads');
      for (const content of ['<html><script>alert(1)</script></html>............', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', '%PDF-1.7 fake pdf content here', 'just some text content that is not an image']) {
        const res = await upload(Buffer.from(content).toString('base64'), 'harmless.png');
        expect(res.status).toBe(400);
        expect(res.body.error.details.code).toBe('UNSUPPORTED_IMAGE_TYPE');
      }
      const after = await world.ds.query('SELECT count(*)::int AS n FROM uploads');
      expect(after[0].n).toBe(before[0].n);
    });

    it('rejects an oversized image (UPLOAD_TOO_LARGE) and content that is not base64 (UPLOAD_NOT_BASE64)', async () => {
      const big = await upload(jpegOfSize(5 * 1024 * 1024 + 1024).toString('base64'));
      expect(big.status).toBe(400);
      expect(big.body.error.details.code).toBe('UPLOAD_TOO_LARGE');
      const notBase64 = await upload('data:image/png;base64,' + PNG_1X1_BASE64);
      expect(notBase64.status).toBe(400);
      expect(notBase64.body.error.details.code).toBe('UPLOAD_NOT_BASE64');
    });

    it('a hostile filename cannot choose where or how the file is stored', async () => {
      const res = await upload(PNG_1X1_BASE64, '../../../../etc/cron.d/evil.html');
      expect(res.status).toBe(201);
      expect(res.body.data.url).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.png$/);
    });

    it('requires authentication, and the stored file cannot be reached through path traversal', async () => {
      const anon = await world.api('post', '/uploads', { body: { base64Content: PNG_1X1_BASE64, filename: 'a.png' } });
      expect(anon.status).toBe(401);
      for (const evil of ['/uploads/files/../../package.json', '/uploads/files/%2e%2e/%2e%2e/package.json', '/uploads/files/', '/uploads/files/.env']) {
        const res = await raw(world, { method: 'GET', path: evil });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.body.toString()).not.toContain('"name"');
      }
    });
  });

  describe('existing Hatly image workflows keep working', () => {
    it('the Proof-of-Delivery / custom-item flow still gets a real, owned upload URL back from POST /uploads', async () => {
      const url = await s.uploadFakePhoto(customer.accessToken);
      expect(url).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.png$/);
    });
  });
});
