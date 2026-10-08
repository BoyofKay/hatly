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

  describe('storage-boundary safety', () => {
    it.each(['../../etc/passwd', '..\\..\\windows\\system32', '/etc/passwd', 'a/b/c.png', 'x.png/../../../y.png', 'photo.png\0.html', 'photo.PNG.exe', '.htaccess', ''])(
      'a hostile filename (%j) can never move the file out of the storage directory or choose its name',
      async (filename) => {
        const provider = buildProvider(tmpDir);
        const result = await provider.store({ base64Content: Buffer.from('x').toString('base64'), filename });

        const key = result.url.slice('/uploads/files/'.length);
        expect(key).toMatch(/^[0-9a-f-]{36}(\.(jpg|jpeg|png|webp))?$/);
        expect(key).not.toMatch(/[\\/]|\.\./);
        const entries = await fs.readdir(tmpDir);
        expect(entries).toEqual([key]); // exactly one file, directly inside the directory
      },
    );

    it('only an allow-listed image extension is ever kept; anything else is stored with NO extension (never .html/.svg/.php/.exe)', async () => {
      const provider = buildProvider(tmpDir);
      for (const filename of ['a.html', 'a.svg', 'a.php', 'a.exe', 'a.js', 'a.PNG.html']) {
        const { url } = await provider.store({ base64Content: Buffer.from('x').toString('base64'), filename });
        expect(url).not.toMatch(/\.(html|svg|php|exe|js)$/);
      }
    });

    it('two uploads never collide or overwrite each other', async () => {
      const provider = buildProvider(tmpDir);
      const a = await provider.store({ base64Content: Buffer.from('one').toString('base64'), filename: 'x.png' });
      const b = await provider.store({ base64Content: Buffer.from('two').toString('base64'), filename: 'x.png' });
      expect(a.url).not.toBe(b.url);
      expect((await fs.readdir(tmpDir)).length).toBe(2);
    });
  });
});
