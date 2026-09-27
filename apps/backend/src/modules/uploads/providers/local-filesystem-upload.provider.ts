import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UploadProvider, UploadResult } from '../upload-provider.interface';

/**
 * CHUNK 12B-1 CORRECTION. Real implementation of the existing
 * `UploadProvider` interface — writes actual bytes to disk, replacing
 * `StubUploadProvider` (which discarded `base64Content` entirely) as
 * the DEFAULT binding in `uploads.module.ts`. CONFIRMED safe: neither
 * `cart.service.spec.ts` nor `cart-pricing.service.spec.ts` actually
 * construct `UploadsModule`'s real DI graph — both use fully
 * hand-mocked repositories/services with literal `'stub-upload://...'`
 * strings as plain example fixture data, never exercising the actual
 * provider binding. Swapping the binding does not affect them.
 *
 * Local filesystem, not S3 — CONFIRMED per this chunk's explicit
 * instruction not to invent cloud credentials/SDKs not already
 * configured in the repository. The existing `UploadProvider`
 * interface (`store({base64Content, filename}): Promise<{url}>`) is
 * exactly the abstraction a future real S3-compatible provider would
 * implement instead — nothing in `UploadsService` or any caller
 * (VendorProductsService, CartService via UploadsService) would need
 * to change to swap this again later.
 *
 * Safety, per this chunk's explicit requirements:
 * - storage key is ALWAYS a fresh `randomUUID()` — the client's
 *   original filename is never used as the storage key (prevents path
 *   traversal and filename collisions structurally, not by sanitizing
 *   an untrusted string).
 * - file extension is derived from the caller-supplied, already-
 *   validated extension (see VendorProductsController's own MIME
 *   allowlist) — never parsed out of the untrusted original filename.
 */
@Injectable()
export class LocalFilesystemUploadProvider implements UploadProvider {
  constructor(private readonly configService: ConfigService) {}

  private get storageDir(): string {
    return this.configService.get<string>('uploads.localDir') ?? path.join(process.cwd(), 'uploads-storage');
  }

  private get publicUrlPrefix(): string {
    return this.configService.get<string>('uploads.publicUrlPrefix') ?? '/uploads/files';
  }

  /**
   * `filename` here is used ONLY to derive a safe extension (already
   * validated by the caller against an allowlist before this is ever
   * invoked for the Vendor image path) — never as the storage key
   * itself.
   */
  async store(params: { base64Content: string; filename: string }): Promise<UploadResult> {
    const dir = this.storageDir;
    await fs.mkdir(dir, { recursive: true });

    const safeExtension = this.extractSafeExtension(params.filename);
    const storageKey = `${randomUUID()}${safeExtension}`;
    const fullPath = path.join(dir, storageKey);

    const buffer = Buffer.from(params.base64Content, 'base64');
    await fs.writeFile(fullPath, buffer);

    return { url: `${this.publicUrlPrefix}/${storageKey}` };
  }

  /**
   * Only ever returns one of a small fixed allowlist, or '' — never
   * echoes arbitrary characters from the untrusted input back into a
   * filesystem path.
   */
  private extractSafeExtension(filename: string): string {
    const match = /\.([a-zA-Z0-9]{1,5})$/.exec(filename);
    const ext = match ? `.${match[1].toLowerCase()}` : '';
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    return allowed.includes(ext) ? ext : '';
  }
}
