import { pngOf } from './image-test-fixtures';
import { checkBannerDimensions, readImageDimensions } from './image-dimensions';

function jpegOf(width: number, height: number): Buffer {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(17, 0); // length
  sof[2] = 8; // precision
  sof.writeUInt16BE(height, 3);
  sof.writeUInt16BE(width, 5);
  sof[7] = 3;
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, Buffer.from([0xff, 0xc0]), sof, Buffer.from([0xff, 0xd9])]);
}

function webpVp8x(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

function webpLossy(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8 ', 12, 'ascii');
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a;
  b.writeUInt16LE(width, 26);
  b.writeUInt16LE(height, 28);
  return b;
}

function webpLossless(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8L', 12, 'ascii');
  b[20] = 0x2f;
  b.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  return b;
}

describe('readImageDimensions', () => {
  it.each([
    ['PNG', pngOf(1200, 600)],
    ['JPEG', jpegOf(1200, 600)],
    ['WebP (VP8X)', webpVp8x(1200, 600)],
    ['WebP (lossy VP8)', webpLossy(1200, 600)],
    ['WebP (lossless VP8L)', webpLossless(1200, 600)],
  ])('%s → 1200 × 600', (_name, buffer) => {
    expect(readImageDimensions(buffer)).toEqual({ width: 1200, height: 600 });
  });

  it('returns null for anything it cannot read (empty, truncated, text, a PNG without IHDR)', () => {
    for (const buffer of [Buffer.alloc(0), Buffer.from('not an image'), pngOf(10, 10).subarray(0, 20), jpegOf(10, 10).subarray(0, 6)]) {
      expect(readImageDimensions(buffer)).toBeNull();
    }
  });
});

describe('checkBannerDimensions — square artwork recommended', () => {
  it('accepts recommended square, reported 1254×1254 and legacy artwork in every format', () => {
    for (const buffer of [pngOf(1080, 1080), pngOf(1254, 1254), jpegOf(1200, 600), webpVp8x(1000, 1000), webpLossy(900, 400)]) {
      expect(checkBannerDimensions(buffer)).toMatchObject({ ok: true });
    }
  });

  it('refuses too-small images with the size in the message', () => {
    expect(checkBannerDimensions(pngOf(400, 200))).toMatchObject({ ok: false, code: 'BANNER_IMAGE_TOO_SMALL', message: expect.stringContaining('400×200') });
    expect(checkBannerDimensions(jpegOf(1200, 200))).toMatchObject({ ok: false, code: 'BANNER_IMAGE_TOO_SMALL' });
  });

  it('does not reject non-square artwork solely by ratio', () => {
    for (const buffer of [pngOf(1000, 1000), pngOf(800, 1200), jpegOf(3000, 800)]) {
      expect(checkBannerDimensions(buffer)).toMatchObject({ ok: true });
    }
  });

  it('refuses an image whose size cannot be read', () => {
    expect(checkBannerDimensions(Buffer.from('GIF89a......'))).toMatchObject({ ok: false, code: 'BANNER_IMAGE_UNREADABLE' });
  });
});
