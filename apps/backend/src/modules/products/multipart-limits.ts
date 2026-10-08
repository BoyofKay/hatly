import { BadRequestException } from '@nestjs/common';

/**
 * Multer limits for the endpoints that accept exactly ONE uploaded file (Excel import, product image) — M5 Batch 4.
 *
 * `fileSize` was the only limit before; multer's other limits default to "unlimited", so one authenticated request could carry
 * any number of parts/fields, each field up to 1 MB, all buffered in memory before the handler ran. These routes need one file
 * and at most a few short text fields, so anything beyond this is refused up front (multer errors become a 4xx).
 */
export const singleFileMultipartLimits = (fileSize: number) => ({
  fileSize,
  files: 1,
  fields: 10,
  parts: 11,
  fieldSize: 16 * 1024,
  headerPairs: 50,
});

/** A multipart request that carries no file part reaches the handler with `file === undefined`; that is a client error, not a 500. */
export function requireUploadedFile<T>(file: T | undefined | null, field: string): T {
  if (!file) {
    throw new BadRequestException({
      message: `A file is required (multipart field "${field}").`,
      details: { code: 'FILE_REQUIRED', field },
    });
  }
  return file;
}
