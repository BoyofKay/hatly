import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadsService } from './uploads.service';
import { UploadProvider } from './upload-provider.interface';
import { LocalFilesystemUploadProvider } from './providers/local-filesystem-upload.provider';
import { S3UploadProvider } from './providers/s3-upload.provider';
import { FAKE_S3_CREDENTIALS, FakeS3, startFakeS3 } from './providers/fake-s3-server';
import { JPEG_BYTES, PNG_1X1_BASE64, WEBP_BYTES } from './image-test-fixtures';
import { MAX_UPLOAD_IMAGE_BYTES } from './image-validation';

/**
 * M5 Batch 2 — the upload security guarantees must hold identically whichever storage provider is bound. This runs the REAL
 * UploadsService (validation) in front of BOTH the local-filesystem provider and the S3-compatible provider (against an
 * in-process signature-verifying fake) and asserts the same outcomes: what is accepted, how it is named, and that rejected
 * input never reaches storage.
 */
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

interface Harness {
  name: string;
  service: UploadsService;
  stored(): Promise<Array<{ key: string; bytes: Buffer }>>;
  teardown(): Promise<void>;
}

async function localHarness(): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hatly-contract-'));
  const config = { get: (k: string) => ({ 'uploads.localDir': dir, 'uploads.publicUrlPrefix': '/uploads/files' } as Record<string, string>)[k] };
  const provider = new LocalFilesystemUploadProvider(config as unknown as ConfigService);
  return {
    name: 'local filesystem',
    service: makeService(provider),
    stored: async () => Promise.all((await fs.readdir(dir)).map(async (key) => ({ key, bytes: await fs.readFile(path.join(dir, key)) }))),
    teardown: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

async function s3Harness(): Promise<Harness> {
  const fake: FakeS3 = await startFakeS3('hatly-test');
  const provider = new S3UploadProvider({
    endpoint: fake.endpoint, bucket: 'hatly-test', forcePathStyle: true, access: 'private',
    signedUrlTtlSeconds: 300, keyPrefix: '', publicUrlPrefix: '/uploads/files', ...FAKE_S3_CREDENTIALS,
  });
  return {
    name: 'S3-compatible',
    service: makeService(provider),
    stored: async () => [...fake.objects.entries()].map(([key, o]) => ({ key, bytes: o.body })),
    teardown: () => fake.close(),
  };
}

function makeService(provider: UploadProvider): UploadsService {
  const rows: any[] = [];
  const repo = { create: (d: any) => d, save: async (r: any) => { rows.push(r); return r; } };
  return new UploadsService(repo as any, provider);
}

describe.each([['local filesystem', localHarness], ['S3-compatible', s3Harness]] as const)('upload storage boundary — %s provider', (_name, build) => {
  let h: Harness;
  beforeEach(async () => { h = await build(); });
  afterEach(async () => { await h.teardown(); });

  it.each([
    ['PNG', PNG_1X1_BASE64, 'png'],
    ['JPEG', JPEG_BYTES.toString('base64'), 'jpg'],
    ['WebP', WEBP_BYTES.toString('base64'), 'webp'],
  ])('stores a valid %s under a generated <uuid>.%s key, byte-for-byte, returning a stable /uploads/files reference', async (_label, base64, ext) => {
    const upload = await h.service.upload(base64, 'whatever.txt', 'user-1');
    expect(upload.url).toMatch(new RegExp(`^/uploads/files/[0-9a-f-]{36}\\.${ext}$`));
    const files = await h.stored();
    expect(files).toHaveLength(1);
    expect(files[0].key).toMatch(KEY);
    expect(files[0].key.endsWith(`.${ext}`)).toBe(true);
    expect(files[0].bytes.equals(Buffer.from(base64, 'base64'))).toBe(true);
  });

  it('the extension comes from the DETECTED type: a PNG uploaded as "evil.html"/"x.jpg"/"../../x.png" is still stored as <uuid>.png', async () => {
    for (const filename of ['evil.html', 'x.jpg', '../../x.png', 'a\\b.svg', '', 'x.png\0.exe']) {
      await h.service.upload(PNG_1X1_BASE64, filename, 'user-1');
    }
    const files = await h.stored();
    expect(files).toHaveLength(6);
    for (const f of files) expect(f.key).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(new Set(files.map((f) => f.key)).size).toBe(6);
  });

  it('rejects what is not a supported image — and nothing reaches storage', async () => {
    const attempts: Array<[string, string]> = [
      ['HTML', Buffer.from('<html><script>alert(1)</script></html> padding padding').toString('base64')],
      ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>').toString('base64')],
      ['GIF', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]).toString('base64')],
      ['PDF', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20)]).toString('base64')],
      ['PNG signature with no IHDR', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]).toString('base64')],
      ['too short', Buffer.from([0xff, 0xd8, 0xff]).toString('base64')],
      ['empty', ''],
      ['not base64 (illegal chars)', 'not*base64!!'],
      ['data: URL prefix', `data:image/png;base64,${PNG_1X1_BASE64}`],
      ['bad padding length', PNG_1X1_BASE64.slice(0, -1)],
    ];
    for (const [label, content] of attempts) {
      await expect(h.service.upload(content, 'photo.png', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
      expect((await h.stored()).length).toBe(0); // `${label}`
    }
  });

  it('rejects an image over 5 MiB before it is stored, and accepts one at the limit', async () => {
    const png = Buffer.from(PNG_1X1_BASE64, 'base64');
    const over = Buffer.concat([png, Buffer.alloc(MAX_UPLOAD_IMAGE_BYTES - png.length + 1)]);
    await expect(h.service.upload(over.toString('base64'), 'big.png', 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(await h.stored()).toHaveLength(0);

    const exactly = Buffer.concat([png, Buffer.alloc(MAX_UPLOAD_IMAGE_BYTES - png.length)]);
    await h.service.upload(exactly.toString('base64'), 'ok.png', 'user-1');
    expect(await h.stored()).toHaveLength(1);
  });
});
