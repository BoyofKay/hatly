import { JPEG_BYTES, PNG_1X1_BASE64, WEBP_BYTES } from './image-test-fixtures';
import { decodeBase64Image, detectImageType, isStrictBase64, MAX_UPLOAD_IMAGE_BYTES, UploadRejectedError } from './image-validation';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as UploadRejectedError).code;
  }
};

describe('image upload validation', () => {
  it('accepts real JPEG, PNG and WebP content and derives the extension from the BYTES', () => {
    expect(decodeBase64Image(PNG_1X1_BASE64).image).toEqual({ mime: 'image/png', extension: '.png' });
    expect(decodeBase64Image(JPEG_BYTES.toString('base64')).image).toEqual({ mime: 'image/jpeg', extension: '.jpg' });
    expect(decodeBase64Image(WEBP_BYTES.toString('base64')).image).toEqual({ mime: 'image/webp', extension: '.webp' });
  });

  it('tolerates line breaks inside otherwise valid base64', () => {
    const wrapped = PNG_1X1_BASE64.replace(/(.{20})/g, '$1\n');
    expect(decodeBase64Image(wrapped).image.mime).toBe('image/png');
  });

  it.each([
    ['plain text', Buffer.from('hello this is not an image at all')],
    ['HTML', Buffer.from('<html><script>alert(1)</script></html>  ')],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['PDF', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')],
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;;;;;;;;;;', 'binary')],
    ['HEIC', Buffer.from('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic', 'binary')],
    ['an executable', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0, 0xb8])],
    ['a ZIP/office file', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    ['a PNG signature without an IHDR chunk', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)])],
    ['a RIFF that is not WebP', Buffer.from('RIFF\x10\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00', 'binary')],
    ['a WebP whose declared size exceeds the data', (() => { const b = Buffer.from(WEBP_BYTES); b.writeUInt32LE(9999, 4); return b; })()],
    ['a tiny file', Buffer.from([0xff, 0xd8, 0xff])],
  ])('rejects %s as UNSUPPORTED_IMAGE_TYPE even when it is valid base64', (_name, bytes) => {
    expect(code(() => decodeBase64Image((bytes as Buffer).toString('base64')))).toBe('UNSUPPORTED_IMAGE_TYPE');
  });

  it('rejects content that is not strict base64', () => {
    for (const bad of ['not base64 !!!', 'data:image/png;base64,' + PNG_1X1_BASE64, '../../etc/passwd', PNG_1X1_BASE64 + '$', 'abc', '=AAA']) {
      expect(code(() => decodeBase64Image(bad))).toBe('UPLOAD_NOT_BASE64');
    }
  });

  it('rejects an empty upload', () => {
    expect(code(() => decodeBase64Image(''))).toBe('UPLOAD_EMPTY');
    expect(code(() => decodeBase64Image('   \n  '))).toBe('UPLOAD_EMPTY');
  });

  it('enforces the size ceiling from the encoded length, before decoding', () => {
    const justOver = Buffer.concat([JPEG_BYTES, Buffer.alloc(MAX_UPLOAD_IMAGE_BYTES, 7)]).toString('base64');
    expect(code(() => decodeBase64Image(justOver))).toBe('UPLOAD_TOO_LARGE');
    const atLimit = Buffer.concat([JPEG_BYTES, Buffer.alloc(MAX_UPLOAD_IMAGE_BYTES - JPEG_BYTES.length, 7)]).toString('base64');
    expect(decodeBase64Image(atLimit).image.mime).toBe('image/jpeg');
    expect(code(() => decodeBase64Image('A'.repeat(40_000_000)))).toBe('UPLOAD_TOO_LARGE');
  });

  it('detectImageType never looks at a filename or declared MIME type — only bytes', () => {
    expect(detectImageType(Buffer.from('.png.png.png.png.png.png'))).toBeNull();
  });
});

describe('isStrictBase64 (a linear scan, not a regex — see the function comment)', () => {
  it('accepts exactly what the old pattern /^[A-Za-z0-9+/]+={0,2}$/ accepted, and rejects what it rejected', () => {
    const old = /^[A-Za-z0-9+/]+={0,2}$/;
    const samples = ['', '=', '==', '===', 'A', 'AA==', 'AAA=', 'AAAA', 'A===', '====', 'AA=A', 'A=A=', 'AB+/', 'AB-_', 'AB C', 'AB\n', 'é', 'AAé=', 'AAAA\u0000', 'data:image/png;base64,AAAA', 'AAAAAAAAAAAA=', 'AAAAAAAAAAAA==', 'AAAAAAAAAAAA==='];
    for (const sample of samples) expect({ sample, ok: isStrictBase64(sample) }).toEqual({ sample, ok: old.test(sample) });
  });

  it('handles a string far beyond the upload limit in linear time and without ever throwing (the old regex threw RangeError near 7 MB)', () => {
    for (const chars of [6_991_872, 7_000_000, 30_000_000]) {
      const big = 'Qk'.repeat(chars / 2);
      const started = Date.now();
      expect(isStrictBase64(big)).toBe(true);
      expect(isStrictBase64(big + '!')).toBe(false);
      expect(Date.now() - started).toBeLessThan(2000);
    }
  });

  it('is not sensitive to how deep the call stack already is (the failure was intermittent: it depended on the stack at the time)', () => {
    const big = 'Qk'.repeat(3_500_000);
    const atDepth = (n: number): boolean => (n === 0 ? isStrictBase64(big) : atDepth(n - 1));
    for (const depth of [0, 500, 2000, 4000]) expect(atDepth(depth)).toBe(true);
  });

  it('a maximum-size valid image decodes every time: 40 consecutive near-limit decodes, none a 500', () => {
    const png = Buffer.from(PNG_1X1_BASE64, 'base64');
    const exactlyAtLimit = Buffer.concat([png, Buffer.alloc(MAX_UPLOAD_IMAGE_BYTES - png.length)]).toString('base64');
    for (let i = 0; i < 40; i++) expect(decodeBase64Image(exactlyAtLimit).image.mime).toBe('image/png');
  });
});
