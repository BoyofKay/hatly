/**
 * Reads the pixel size of a PNG, JPEG or WebP from its header bytes — no decoding, no dependency. Used where an image's SHAPE matters
 * (a Home promotion has recommended square artwork); the type itself is still established by `detectImageType`. Returns null for anything it cannot read, and the
 * caller then refuses the image rather than guessing.
 */
export interface ImageDimensions {
  width: number;
  height: number;
}

export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  return readPng(buffer) ?? readJpeg(buffer) ?? readWebp(buffer);
}

function positive(width: number, height: number): ImageDimensions | null {
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

function readPng(b: Buffer): ImageDimensions | null {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return positive(b.readUInt32BE(16), b.readUInt32BE(20));
}

function readJpeg(b: Buffer): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    const length = b.readUInt16BE(i + 2);
    if (length < 2) return null;
    // Start-Of-Frame markers (not DHT 0xC4, JPG 0xC8, DAC 0xCC): precision(1) height(2) width(2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return positive(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
    }
    i += 2 + length;
  }
  return null;
}

function readWebp(b: Buffer): ImageDimensions | null {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    // canvas width-1 (24 bits LE) at 24, height-1 at 27
    return positive(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
  }
  if (chunk === 'VP8 ') {
    // frame tag(3) start code 9d 01 2a, then width(2 LE, 14 bits) height(2 LE, 14 bits)
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return positive(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return positive((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  return null;
}

/** Square 1080×1080 is recommended, not a mandatory aspect ratio. Keep the minimum quality floor without rejecting legacy artwork. */
export const BANNER_MIN_WIDTH = 320;
export const BANNER_MIN_HEIGHT = 320;

export type BannerImageProblem = 'BANNER_IMAGE_UNREADABLE' | 'BANNER_IMAGE_TOO_SMALL' | 'BANNER_IMAGE_WRONG_SHAPE';

export function checkBannerDimensions(buffer: Buffer): { ok: true; dimensions: ImageDimensions } | { ok: false; code: BannerImageProblem; message: string } {
  const d = readImageDimensions(buffer);
  if (!d) return { ok: false, code: 'BANNER_IMAGE_UNREADABLE', message: 'The size of this image could not be read. Use a standard JPEG, PNG or WebP.' };
  if (d.width < BANNER_MIN_WIDTH || d.height < BANNER_MIN_HEIGHT) {
    return { ok: false, code: 'BANNER_IMAGE_TOO_SMALL', message: `The image is ${d.width}×${d.height}. A banner must be at least ${BANNER_MIN_WIDTH}×${BANNER_MIN_HEIGHT} pixels (recommended 1080×1080).` };
  }
  return { ok: true, dimensions: d };
}
