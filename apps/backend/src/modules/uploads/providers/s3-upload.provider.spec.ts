import * as http from 'http';
import { FAKE_S3_CREDENTIALS, FakeS3, startFakeS3 } from './fake-s3-server';
import { S3UploadProvider, S3UploadSettings } from './s3-upload.provider';
import { PNG_1X1_BASE64 } from '../image-test-fixtures';

const BUCKET = 'hatly-test';
const baseSettings = (endpoint: string, over: Partial<S3UploadSettings> = {}): S3UploadSettings => ({
  endpoint,
  bucket: BUCKET,
  forcePathStyle: true,
  access: 'private',
  signedUrlTtlSeconds: 300,
  keyPrefix: '',
  publicUrlPrefix: '/uploads/files',
  ...FAKE_S3_CREDENTIALS,
  ...over,
});

const get = (url: string) =>
  new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks), headers: res.headers }));
    }).on('error', reject);
  });

describe('S3UploadProvider (against an in-process, signature-verifying S3-compatible server)', () => {
  let s3: FakeS3;
  beforeEach(async () => { s3 = await startFakeS3(BUCKET); });
  afterEach(async () => { await s3.close(); });

  it('PUTs the bytes with a valid SigV4 signature and returns a stable, server-generated reference (private mode)', async () => {
    const provider = new S3UploadProvider(baseSettings(s3.endpoint));
    const { url } = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'ignored-client-name.png' });

    expect(url).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.png$/);
    const key = url.split('/').pop()!;
    const stored = s3.objects.get(key)!;
    expect(stored.body.toString('base64')).toBe(PNG_1X1_BASE64);
    expect(stored.contentType).toBe('image/png');
    const put = s3.requests.find((r) => r.method === 'PUT')!;
    expect(put.path).toBe(`/${BUCKET}/${key}`);
    expect(String(put.headers.authorization)).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAFAKEFORTESTS\/\d{8}\/eu-test-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    // The secret key is never sent anywhere.
    expect(JSON.stringify(s3.requests)).not.toContain(FAKE_S3_CREDENTIALS.secretKey);
  });

  it('stores objects as immutable for a year: private in private mode, public in public mode (so a CDN in front of a public bucket can cache them)', async () => {
    for (const [access, expected] of [['private', 'private, max-age=31536000, immutable'], ['public', 'public, max-age=31536000, immutable']] as const) {
      const provider = new S3UploadProvider(baseSettings(s3.endpoint, { access, publicBaseUrl: access === 'public' ? 'https://cdn.hatly.example' : undefined }));
      await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' });
      const put = s3.requests.filter((r) => r.method === 'PUT').pop()!;
      expect(put.headers['cache-control']).toBe(expected);
    }
  });

  it('applies the optional key prefix inside the bucket, without changing the stored reference', async () => {
    const provider = new S3UploadProvider(baseSettings(s3.endpoint, { keyPrefix: 'hatly/media/' }));
    const { url } = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' });
    const file = url.split('/').pop()!;
    expect(url).toBe(`/uploads/files/${file}`);
    expect(s3.objects.has(`hatly/media/${file}`)).toBe(true);
  });

  it('public mode returns an absolute public URL (no signing/redirect needed)', async () => {
    const provider = new S3UploadProvider(baseSettings(s3.endpoint, { access: 'public', publicBaseUrl: 'https://cdn.hatly.example/', keyPrefix: 'hatly' }));
    const { url } = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.webp' });
    expect(url).toMatch(/^https:\/\/cdn\.hatly\.example\/hatly\/[0-9a-f-]{36}\.webp$/);
  });

  it('hostile filenames can neither choose the object key nor traverse: only <uuid>.<allowed ext> objects are ever written', async () => {
    const provider = new S3UploadProvider(baseSettings(s3.endpoint));
    for (const filename of ['../../etc/passwd.png', 'a/b/c.png', '..\\..\\x.jpg', 'x.html\0.png']) {
      const { url } = await provider.store({ base64Content: PNG_1X1_BASE64, filename });
      expect(url).toMatch(/^\/uploads\/files\/[0-9a-f-]{36}\.(png|jpg)$/);
    }
    for (const key of s3.objects.keys()) expect(key).toMatch(/^[0-9a-f-]{36}\.(png|jpg)$/);
    await expect(provider.store({ base64Content: PNG_1X1_BASE64, filename: 'noextension' })).rejects.toThrow(/allowed image extension/);
    await expect(provider.store({ base64Content: PNG_1X1_BASE64, filename: 'evil.html' })).rejects.toThrow(/allowed image extension/);
    await expect(provider.store({ base64Content: PNG_1X1_BASE64, filename: 'x.png\0.html' })).rejects.toThrow(/allowed image extension/);
  });

  describe('private reads: short-lived signed GET URLs', () => {
    it('createReadUrl signs a GET for exactly that object; the verifying server serves it, and a tampered/expired URL is refused', async () => {
      const provider = new S3UploadProvider(baseSettings(s3.endpoint, { signedUrlTtlSeconds: 120 }));
      const { url } = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' });
      const file = url.split('/').pop()!;

      const signed = provider.createReadUrl(file)!;
      const parsed = new URL(signed);
      expect(parsed.searchParams.get('X-Amz-Expires')).toBe('120');
      expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
      expect(signed).not.toContain(FAKE_S3_CREDENTIALS.secretKey);

      const ok = await get(signed);
      expect(ok.status).toBe(200);
      expect(ok.body.toString('base64')).toBe(PNG_1X1_BASE64);

      const tampered = await get(signed.replace(file, `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.png`));
      expect(tampered.status).toBeGreaterThanOrEqual(403);
      const expired = new S3UploadProvider(baseSettings(s3.endpoint, { signedUrlTtlSeconds: 1 }));
      const short = expired.createReadUrl(file)!;
      await new Promise((r) => setTimeout(r, 2100));
      expect((await get(short)).status).toBe(403);
    });

    it('only exact <uuid>.<ext> names resolve — traversal, subpaths, odd extensions and junk give null', () => {
      const provider = new S3UploadProvider(baseSettings('http://127.0.0.1:1'));
      const good = '123e4567-e89b-12d3-a456-426614174000.png';
      expect(provider.createReadUrl(good)).toContain(`/${BUCKET}/${good}?`);
      for (const bad of ['', '..', '../x.png', 'a/b.png', `${good}/..`, `${good}.html`, '123e4567-e89b-12d3-a456-426614174000', 'ABCDEF.png', `%2e%2e%2f${good}`, `${good}\0`, `x/${good}`]) {
        expect(provider.createReadUrl(bad)).toBeNull();
      }
    });
  });

  describe('addressing', () => {
    const originOf = (settings: Partial<S3UploadSettings>) => (new S3UploadProvider({ ...baseSettings('https://placeholder'), ...settings }) as any).host;

    it('AWS default (no endpoint): virtual-hosted style on the regional endpoint', () => {
      const host = originOf({ endpoint: undefined, region: 'eu-west-1', forcePathStyle: false, bucket: 'my-bucket' });
      expect(host.origin).toBe('https://my-bucket.s3.eu-west-1.amazonaws.com');
      expect(host.pathPrefix).toEqual([]);
    });
    it('custom endpoint with path-style addressing puts the bucket in the path', () => {
      const host = originOf({ endpoint: 'https://objects.example.com', forcePathStyle: true, bucket: 'b' });
      expect(host.origin).toBe('https://objects.example.com');
      expect(host.pathPrefix).toEqual(['b']);
    });
    it('custom endpoint without path-style uses a bucket subdomain', () => {
      const host = originOf({ endpoint: 'https://objects.example.com', forcePathStyle: false, bucket: 'b' });
      expect(host.origin).toBe('https://b.objects.example.com');
    });
  });

  describe('failure handling', () => {
    it('a storage error is surfaced generically — no response body, bucket, key or credential in the error', async () => {
      const provider = new S3UploadProvider(baseSettings(s3.endpoint));
      s3.failNextWith = 403;
      const error = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' }).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Object storage upload failed.');
      expect(JSON.stringify(error.message)).not.toMatch(/SECRET-DETAIL|AKIA|hatly-test/);
    });

    it('an unreachable endpoint fails with a clear error and never hangs', async () => {
      const provider = new S3UploadProvider(baseSettings('http://127.0.0.1:1'));
      await expect(provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' })).rejects.toThrow(/Object storage request failed/);
    });

    it('wrong credentials are rejected by a verifying store (and nothing is stored)', async () => {
      const provider = new S3UploadProvider(baseSettings(s3.endpoint, { secretKey: 'not-the-right-secret' }));
      await expect(provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' })).rejects.toThrow('Object storage upload failed.');
      expect(s3.objects.size).toBe(0);
    });
  });
});
