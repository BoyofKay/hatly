import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { LocalFilesystemUploadProvider } from './providers/local-filesystem-upload.provider';
import { S3UploadProvider } from './providers/s3-upload.provider';
import { FAKE_S3_CREDENTIALS, startFakeS3 } from './providers/fake-s3-server';
import { UploadsService } from './uploads.service';
import { PNG_1X1_BASE64 } from './image-test-fixtures';

/**
 * Account deletion removes a customer's own photos from storage. `remove` must delete exactly the generated file it is given — never a
 * seeded/marketplace asset, never anything outside the uploads directory or bucket — and never throw.
 */
describe('upload removal (account deletion)', () => {
  describe('local filesystem provider', () => {
    let dir: string;
    let provider: LocalFilesystemUploadProvider;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hatly-remove-'));
      const config = { get: (k: string) => ({ 'uploads.localDir': dir, 'uploads.publicUrlPrefix': '/uploads/files' } as Record<string, string>)[k] };
      provider = new LocalFilesystemUploadProvider(config as unknown as ConfigService);
    });
    afterEach(() => fs.rm(dir, { recursive: true, force: true }));

    it('deletes the stored file; a second removal (already gone) still reports removed', async () => {
      const { url } = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'x.png' });
      const file = path.join(dir, url.split('/').pop()!);
      await expect(fs.stat(file)).resolves.toBeDefined();
      await expect(provider.remove(url)).resolves.toBe(true);
      await expect(fs.stat(file)).rejects.toThrow();
      await expect(provider.remove(url)).resolves.toBe(true);
    });

    it('refuses anything that is not one of its own generated names: seeded media, traversal, other prefixes, junk', async () => {
      await fs.mkdir(path.join(dir, 'marketplace'), { recursive: true });
      await fs.writeFile(path.join(dir, 'marketplace', 'logo.png'), 'x');
      await fs.writeFile(path.join(dir, 'keep.png'), 'x');
      for (const ref of ['/uploads/files/marketplace/logo.png', '/uploads/files/../keep.png', '/uploads/files/keep.png', '/other/0b8e4c1a-1b2c-4d3e-8f90-123456789abc.png', 'https://evil.example/x.png', '', '/uploads/files/0b8e4c1a-1b2c-4d3e-8f90-123456789abc.png/../../keep.png']) {
        await expect(provider.remove(ref)).resolves.toBe(false);
      }
      await expect(fs.stat(path.join(dir, 'marketplace', 'logo.png'))).resolves.toBeDefined();
      await expect(fs.stat(path.join(dir, 'keep.png'))).resolves.toBeDefined();
    });
  });

  describe('S3-compatible provider (signature-verifying fake)', () => {
    it('sends a SIGNED delete for exactly that object; foreign references never reach the store; failures resolve false', async () => {
      const fake = await startFakeS3('hatly-test');
      try {
        const provider = new S3UploadProvider({
          endpoint: fake.endpoint, bucket: 'hatly-test', forcePathStyle: true, access: 'private',
          signedUrlTtlSeconds: 300, keyPrefix: '', publicUrlPrefix: '/uploads/files', ...FAKE_S3_CREDENTIALS,
        });
        const a = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'a.png' });
        const b = await provider.store({ base64Content: PNG_1X1_BASE64, filename: 'b.png' });
        expect(fake.objects.size).toBe(2);
        await expect(provider.remove(a.url)).resolves.toBe(true); // the fake verifies the SigV4 signature (403 otherwise)
        expect([...fake.objects.keys()]).toEqual([b.url.split('/').pop()]);
        const before = fake.requests.length;
        await expect(provider.remove('https://evil.example/0b8e4c1a-1b2c-4d3e-8f90-123456789abc.png')).resolves.toBe(false);
        await expect(provider.remove('/uploads/files/marketplace/logo.png')).resolves.toBe(false);
        expect(fake.requests.length).toBe(before); // refused locally, nothing sent
        fake.failNextWith = 500;
        await expect(provider.remove(b.url)).resolves.toBe(false); // never throws
      } finally {
        await fake.close();
      }
    });
  });

  it('UploadsService.removeStoredFiles counts removed/failed and never throws, even if the provider rejects', async () => {
    const provider = { store: jest.fn(), remove: jest.fn(async (u: string) => { if (u === 'boom') throw new Error('x'); return u !== 'no'; }) };
    const service = new UploadsService({} as any, provider as any);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.removeStoredFiles(['ok', 'no', 'boom'])).resolves.toEqual({ removed: 1, failed: 2 });
  });
});
