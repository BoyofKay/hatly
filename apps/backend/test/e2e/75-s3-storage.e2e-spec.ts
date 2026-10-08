/**
 * M5 Batch 2 — the REAL application booted with STORAGE_DRIVER=s3 against an in-process, signature-verifying S3-compatible
 * server (no cloud account, no credentials beyond fake test values). Proves, over real HTTP: uploads land in object storage
 * under a generated key, the stored reference is unchanged (`/uploads/files/<uuid>.<ext>`), private reads 302 to a short-lived
 * signed URL that the store actually accepts, and nothing local is written or served.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bootWorld, World } from './support/world';
import { Scenario, Actor, PNG_1X1_BASE64 } from './support/actors';
import { FAKE_S3_CREDENTIALS, FakeS3, startFakeS3 } from '../../src/modules/uploads/providers/fake-s3-server';

const raw = (url: string) =>
  new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const u = new URL(url);
    http.get({ host: u.hostname, port: u.port, path: u.pathname + u.search, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks), headers: res.headers }));
    }).on('error', reject);
  });

const KEYS = ['STORAGE_DRIVER', 'STORAGE_ENDPOINT', 'STORAGE_REGION', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'STORAGE_FORCE_PATH_STYLE', 'STORAGE_ACCESS', 'UPLOADS_LOCAL_DIR'];

describe('E2E — S3-compatible media storage (M5 Batch 2)', () => {
  let world: World;
  let fake: FakeS3;
  let customer: Actor;
  let emptyLocalDir: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of KEYS) saved[k] = process.env[k];
    fake = await startFakeS3('hatly-e2e');
    emptyLocalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hatly-e2e-nolocal-'));
    Object.assign(process.env, {
      STORAGE_DRIVER: 's3',
      STORAGE_ENDPOINT: fake.endpoint,
      STORAGE_REGION: FAKE_S3_CREDENTIALS.region,
      STORAGE_BUCKET: 'hatly-e2e',
      STORAGE_ACCESS_KEY: FAKE_S3_CREDENTIALS.accessKey,
      STORAGE_SECRET_KEY: FAKE_S3_CREDENTIALS.secretKey,
      STORAGE_ACCESS: 'private',
      UPLOADS_LOCAL_DIR: emptyLocalDir,
    });
    world = await bootWorld();
    customer = await new Scenario(world).customer('S3 Storage Customer');
  });

  afterAll(async () => {
    try {
      await world?.close();
    } finally {
      await fake.close();
      for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
      fs.rmSync(emptyLocalDir, { recursive: true, force: true });
    }
  });

  const upload = (base64Content: string, filename = 'photo.png') => world.api('post', '/uploads', { token: customer.accessToken, body: { base64Content, filename } });

  it('an upload is written to the object store under a generated key and nothing touches the local directory', async () => {
    const res = await upload(PNG_1X1_BASE64, '../../evil.html');
    expect(res.status).toBe(201);
    const url: string = res.body.data.url;
    expect(url).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.png$/);

    const key = url.split('/').pop()!;
    expect(fake.objects.get(key)?.body.toString('base64')).toBe(PNG_1X1_BASE64);
    expect(fake.objects.get(key)?.contentType).toBe('image/png');
    expect(fs.readdirSync(emptyLocalDir)).toEqual([]);
  });

  it('the stored reference 302-redirects to a short-lived signed URL which the store serves; the redirect carries no credential', async () => {
    const { data } = (await upload(PNG_1X1_BASE64)).body;
    const read = await raw(`${world.baseUrl}${data.url}`);
    expect(read.status).toBe(302);
    const location = String(read.headers.location);
    expect(location.startsWith(fake.endpoint)).toBe(true);
    expect(location).toContain('X-Amz-Signature=');
    expect(location).not.toContain(FAKE_S3_CREDENTIALS.secretKey);
    expect(JSON.stringify(read.headers)).not.toContain(FAKE_S3_CREDENTIALS.secretKey);

    const object = await raw(location);
    expect(object.status).toBe(200);
    expect(object.body.toString('base64')).toBe(PNG_1X1_BASE64);
  });

  it('only exact stored names resolve: traversal, subpaths and unknown names are 404 (no redirect)', async () => {
    for (const evil of ['/uploads/files/', '/uploads/files/..%2f..%2fpackage.json', '/uploads/files/a/b.png', '/uploads/files/marketplace/x.webp', '/uploads/files/.env']) {
      const res = await raw(`${world.baseUrl}${evil}`);
      expect(res.status).toBe(404);
      expect(res.headers.location).toBeUndefined();
    }
  });

  it('validation is unchanged: unsupported content is rejected (400) and never reaches the object store', async () => {
    const before = fake.objects.size;
    const res = await upload(Buffer.from('<html><script>alert(1)</script></html> padding').toString('base64'), 'x.png');
    expect(res.status).toBe(400);
    expect(fake.objects.size).toBe(before);
  });

  it('an object-store outage surfaces as a generic 5xx — no bucket, endpoint, key or credential leaks', async () => {
    fake.failNextWith = 503;
    const res = await upload(PNG_1X1_BASE64);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`${FAKE_S3_CREDENTIALS.accessKey}|${FAKE_S3_CREDENTIALS.secretKey}|hatly-e2e|127\\.0\\.0\\.1:${new URL(fake.endpoint).port}|SECRET-DETAIL`));
  });
});
