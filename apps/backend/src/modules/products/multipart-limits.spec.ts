import { BadRequestException } from '@nestjs/common';
import { requireUploadedFile, singleFileMultipartLimits } from './multipart-limits';

describe('multipart limits', () => {
  it('allows exactly one file plus a few short fields, and keeps the caller\'s size ceiling', () => {
    expect(singleFileMultipartLimits(123)).toEqual({ fileSize: 123, files: 1, fields: 10, parts: 11, fieldSize: 16384, headerPairs: 50 });
  });

  it('requireUploadedFile returns the file, and turns a missing one into a 400 with a stable code', () => {
    const file = { buffer: Buffer.from('x') };
    expect(requireUploadedFile(file, 'file')).toBe(file);
    for (const missing of [undefined, null]) {
      try {
        requireUploadedFile(missing, 'image');
        fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({ details: { code: 'FILE_REQUIRED', field: 'image' } });
      }
    }
  });
});
