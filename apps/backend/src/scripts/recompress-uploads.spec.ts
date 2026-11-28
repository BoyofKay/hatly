import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp = require('sharp');
import { recompressFile } from './recompress-uploads';

describe('recompress-uploads (owner decision 2026-11-28)', () => {
  it('shrinks a large phone photo, keeps the format, strips GPS / camera metadata and caps the long edge at 1600 px', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recompress-'));
    const file = path.join(dir, 'photo.jpg');
    const noisy = Buffer.alloc(3000 * 2000 * 3);
    for (let i = 0; i < noisy.length; i++) noisy[i] = (i * 2654435761) % 251;
    await fs.writeFile(file, await sharp(noisy, { raw: { width: 3000, height: 2000, channels: 3 } }).withMetadata({ exif: { IFD0: { Artist: 'Phone' } } }).jpeg({ quality: 98 }).toBuffer());
    const r = (await recompressFile(file)) as any;
    expect(r.after).toBeLessThan(r.before);
    const meta = await sharp(r.write).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  it('leaves small files, WebP and audio alone', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recompress-'));
    const small = path.join(dir, 'small.jpg');
    await fs.writeFile(small, await sharp({ create: { width: 50, height: 50, channels: 3, background: '#f00' } }).jpeg().toBuffer());
    expect(await recompressFile(small)).toBeNull();
    const webp = path.join(dir, 'x.webp');
    await fs.writeFile(webp, Buffer.alloc(300_000));
    expect(await recompressFile(webp)).toBeNull();
    const audio = path.join(dir, 'x.m4a');
    await fs.writeFile(audio, Buffer.alloc(300_000));
    expect(await recompressFile(audio)).toBeNull();
  });
});
