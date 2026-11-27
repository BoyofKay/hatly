import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UploadProvider, UploadResult } from '../upload-provider.interface';
import { safeExtensionOf, STORED_FILE_NAME } from './storage-keys';

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
    const dir = path.resolve(this.storageDir);
    await fs.mkdir(dir, { recursive: true });

    const safeExtension = this.extractSafeExtension(params.filename);
    const storageKey = `${randomUUID()}${safeExtension}`;
    const fullPath = path.resolve(dir, storageKey);
    // Defence in depth on top of the UUID key: the resolved path must be a direct child of the storage directory.
    if (path.dirname(fullPath) !== dir || path.basename(fullPath) !== storageKey) {
      throw new Error('Refusing to write outside the uploads directory.');
    }

    const buffer = Buffer.from(params.base64Content, 'base64');
    // `wx`: never overwrite an existing file.
    await fs.writeFile(fullPath, buffer, { flag: 'wx' });

    return { url: `${this.publicUrlPrefix}/${storageKey}` };
  }

  /**
   * Deletes a file this provider wrote. Only an exact `<prefix>/<uuid>.<ext>` reference is resolved (seeded `marketplace/...` media, other
   * prefixes, traversal attempts and arbitrary names are refused, `false`); the resolved path must sit directly in the uploads directory.
   * An already-missing file counts as removed.
   */
  async remove(storedUrl: string): Promise<boolean> {
    const prefix = `${this.publicUrlPrefix.replace(/\/+$/, '')}/`;
    if (typeof storedUrl !== 'string' || !storedUrl.startsWith(prefix)) return false;
    const fileName = storedUrl.slice(prefix.length);
    if (!STORED_FILE_NAME.test(fileName)) return false;
    const dir = path.resolve(this.storageDir);
    const fullPath = path.resolve(dir, fileName);
    if (path.dirname(fullPath) !== dir) return false;
    try {
      await fs.unlink(fullPath);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
    }
  }

  /**
   * Only ever returns one of a small fixed allowlist, or '' — never
   * echoes arbitrary characters from the untrusted input back into a
   * filesystem path.
   */
  private extractSafeExtension(filename: string): string {
    return safeExtensionOf(filename);
  }
}
