import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { UploadProvider, UploadResult } from '../upload-provider.interface';

/**
 * STUB — per the approved plan: "keep the UploadProvider
 * abstraction/stub as planned; do not introduce an external SDK."
 *
 * Unlike GoogleMapsProvider's stub (which throws — Phase 1), this one
 * is functionally complete for the one thing that needs to be real
 * for the rest of the system to work correctly: it mints a genuine,
 * unique URL string and that string IS what gets persisted in the
 * `Upload` table (see uploads.service.ts) — so "does this imageUrl
 * correspond to a real Hatly upload" is a real, testable check, not
 * itself faked.
 *
 * What is NOT real: no file bytes are written anywhere. The
 * `base64Content` parameter is accepted (so the calling contract is
 * already correct for a future real provider) but discarded — this
 * stub cannot actually serve the uploaded image back later. Replacing
 * this with a real S3-compatible implementation is a drop-in swap:
 * implement `UploadProvider`, wire it in `uploads.module.ts`, nothing
 * else changes.
 */
@Injectable()
export class StubUploadProvider implements UploadProvider {
  async store(params: { base64Content: string; filename: string }): Promise<UploadResult> {
    const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return { url: `stub-upload://${randomUUID()}/${safeName}` };
  }
}
