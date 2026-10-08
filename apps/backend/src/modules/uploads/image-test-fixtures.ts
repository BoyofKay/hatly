/** Minimal, valid image byte fixtures shared by the upload tests (not a spec file). */
export const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
export const WEBP_BYTES = (() => {
  const payload = Buffer.alloc(18, 1);
  const header = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'ascii');
  const buf = Buffer.concat([header, payload]);
  buf.writeUInt32LE(buf.length - 8, 4);
  return buf;
})();

