import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LocalFilesystemUploadProvider } from './local-filesystem-upload.provider';

function buildProvider(localDir: string) {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'uploads.localDir') return localDir;
      if (key === 'uploads.publicUrlPrefix') return '/uploads/files';
      return undefined;
    }),
  };
  return new LocalFilesystemUploadProvider(configService as any);
}

describe('LocalFilesystemUploadProvider', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hatly-upload-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes the actual decoded bytes to disk', async () => {
    const provider = buildProvider(tmpDir);
    const content = Buffer.from('real image bytes').toString('base64');

    const result = await provider.store({ base64Content: content, filename: 'photo.jpg' });

    const storedFilename = result.url.split('/').pop()!;
    const writtenBytes = await fs.readFile(path.join(tmpDir, storedFilename));
    expect(writtenBytes.toString()).toBe('real image bytes');
  });

  it('never uses the original filename as the storage key — always a fresh UUID', async () => {
    const provider = buildProvider(tmpDir);
    const result = await provider.store({ base64Content: 'YQ==', filename: '../../etc/passwd.jpg' });

    expect(result.url).not.toContain('etc');
    expect(result.url).not.toContain('passwd');
    expect(result.url).toMatch(/[0-9a-f-]{36}\.jpg$/);
  });

  it('two uploads with the same original filename never collide', async () => {
    const provider = buildProvider(tmpDir);
    const first = await provider.store({ base64Content: 'YQ==', filename: 'photo.jpg' });
    const second = await provider.store({ base64Content: 'Yg==', filename: 'photo.jpg' });
    expect(first.url).not.toBe(second.url);
  });

  it('drops an unrecognized/unsafe extension rather than echoing it into the storage path', async () => {
    const provider = buildProvider(tmpDir);
    const result = await provider.store({ base64Content: 'YQ==', filename: 'malware.exe' });
    expect(result.url).not.toContain('.exe');
  });
});
