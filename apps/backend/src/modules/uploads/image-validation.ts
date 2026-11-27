/**
 * Upload boundary validation (M5 Batch 1). Decides, from the BYTES — never from a client-supplied filename or MIME type —
 * whether an upload is an acceptable image, and which extension it is stored with.
 *
 * Accepted: JPEG, PNG, WebP (what the Customer/Driver/Vendor apps produce; HEIC/GIF/SVG/PDF/HTML/etc. are rejected).
 * This is a signature + minimal-structure check, not a full decode (no image library is a dependency of this service); files are
 * additionally always served as non-executable (`nosniff` + sandboxing CSP, see app.setup.ts), so even a crafted file that passes
 * the signature check can never run as a page or script.
 */
export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

export type UploadRejectionCode = 'UPLOAD_NOT_BASE64' | 'UPLOAD_EMPTY' | 'UPLOAD_TOO_LARGE' | 'UNSUPPORTED_IMAGE_TYPE' | 'UNSUPPORTED_AUDIO_TYPE';

export class UploadRejectedError extends Error {
  constructor(public readonly code: UploadRejectionCode, message: string) {
    super(message);
    this.name = 'UploadRejectedError';
  }
}

export interface DetectedImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: '.jpg' | '.png' | '.webp';
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detectImageType(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 16) return null;
  // JPEG: SOI (FF D8) then a marker (FF xx, xx in C0..FE).
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff && buffer[3] >= 0xc0 && buffer[3] <= 0xfe) {
    return { mime: 'image/jpeg', extension: '.jpg' };
  }
  // PNG: 8-byte signature then the IHDR chunk.
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { mime: 'image/png', extension: '.png' };
  }
  // WebP: RIFF container, declared size consistent with the data, WEBP form type, then a VP8/VP8L/VP8X chunk.
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const declared = buffer.readUInt32LE(4) + 8;
    const chunk = buffer.toString('ascii', 12, 16);
    if (declared <= buffer.length && (chunk === 'VP8 ' || chunk === 'VP8L' || chunk === 'VP8X')) {
      return { mime: 'image/webp', extension: '.webp' };
    }
  }
  return null;
}

const BASE64_ALPHABET = (() => {
  const table = new Uint8Array(128);
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/') table[ch.charCodeAt(0)] = 1;
  return table;
})();

/**
 * Strict base64 body check: one or more alphabet characters followed by at most two `=` padding characters, nothing else.
 *
 * A linear scan, deliberately NOT a regular expression: `/^[A-Za-z0-9+/]+={0,2}$/` over a ~7 MB string (a near-limit image)
 * intermittently threw `RangeError: Maximum call stack size exceeded` inside V8's regex engine, turning a valid upload into a
 * 500. (Found in M5 Batch 4 via an intermittent E2E failure; the stack trace pointed at `RegExp.test` here.)
 */
export function isStrictBase64(value: string): boolean {
  let end = value.length;
  if (end > 0 && value.charCodeAt(end - 1) === 61) {
    end -= 1;
    if (end > 0 && value.charCodeAt(end - 1) === 61) end -= 1;
  }
  if (end === 0) return false;
  for (let i = 0; i < end; i++) {
    const code = value.charCodeAt(i);
    if (code > 127 || BASE64_ALPHABET[code] === 0) return false;
  }
  return true;
}

/**
 * Strictly decodes a base64 string (raw base64 — no `data:` prefix), enforces the size ceiling BEFORE allocating the decoded
 * buffer, and verifies it is an accepted image. Throws {@link UploadRejectedError} with a stable code otherwise.
 */
export function decodeBase64Image(base64: string, maxBytes: number = MAX_UPLOAD_IMAGE_BYTES): { buffer: Buffer; base64: string; image: DetectedImage } {
  const compact = base64.replace(/\s+/g, '');
  if (compact.length === 0) throw new UploadRejectedError('UPLOAD_EMPTY', 'The upload is empty.');
  if (compact.length % 4 !== 0 || !isStrictBase64(compact)) {
    throw new UploadRejectedError('UPLOAD_NOT_BASE64', 'The upload content must be valid base64.');
  }
  // Decoded size = 3/4 of the encoded length (minus padding). Checked from the length so an oversized body is never decoded.
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const decodedSize = (compact.length / 4) * 3 - padding;
  if (decodedSize > maxBytes) {
    throw new UploadRejectedError('UPLOAD_TOO_LARGE', `The image exceeds the maximum allowed size of ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  }
  const buffer = Buffer.from(compact, 'base64');
  const image = detectImageType(buffer);
  if (!image) throw new UploadRejectedError('UNSUPPORTED_IMAGE_TYPE', 'Only JPEG, PNG, or WebP images are allowed.');
  return { buffer, base64: compact, image };
}
