import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Upload } from './entities/upload.entity';
import { UPLOAD_PROVIDER, UploadProvider } from './upload-provider.interface';
import { decodeBase64Image, UploadRejectedError } from './image-validation';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @InjectRepository(Upload) private readonly repo: Repository<Upload>,
    @Inject(UPLOAD_PROVIDER) private readonly uploadProvider: UploadProvider,
  ) {}

  /**
   * Image-only upload boundary. The bytes are validated FIRST (strict base64, size ceiling, JPEG/PNG/WebP signature — see
   * image-validation.ts) and the storage extension is derived from the DETECTED type, never from the client's `filename`
   * (kept in the signature for the callers/contract; it can no longer influence what is stored or where). Nothing reaches the
   * storage provider unless it is a valid image.
   */
  async upload(base64Content: string, _filename: string, uploadedByUserId: string): Promise<Upload> {
    let decoded: ReturnType<typeof decodeBase64Image>;
    try {
      decoded = decodeBase64Image(base64Content);
    } catch (error) {
      if (error instanceof UploadRejectedError) {
        throw new BadRequestException({ message: error.message, details: { code: error.code } });
      }
      throw error;
    }
    const { url } = await this.uploadProvider.store({
      base64Content: decoded.base64,
      filename: `upload${decoded.image.extension}`,
    });
    return this.repo.save(this.repo.create({ url, uploadedByUserId }));
  }

  /**
   * Used by CartService to validate that every submitted `imageUrls`
   * entry is a real Hatly upload belonging to the calling customer —
   * not an arbitrary external URL. Returns only the URLs that pass
   * both checks; the caller (CartService) treats any missing URL as a
   * validation failure.
   */
  async findOwnedUrls(urls: string[], uploadedByUserId: string): Promise<Set<string>> {
    if (urls.length === 0) return new Set();
    const rows = await this.repo
      .createQueryBuilder('upload')
      .where('upload.url IN (:...urls)', { urls })
      .andWhere('upload.uploaded_by_user_id = :uploadedByUserId', { uploadedByUserId })
      .getMany();
    return new Set(rows.map((r) => r.url));
  }

  /**
   * Account deletion, step 1 (inside the deletion transaction): forgets every upload this user made and returns the stored references so
   * the files can be removed after the transaction commits. Hard delete — a soft-deleted row would still tie the photo to the user id.
   */
  async detachAllOwnedBy(uploadedByUserId: string, manager: EntityManager): Promise<string[]> {
    // TypeORM's Postgres driver answers a DELETE … RETURNING with `[rows, affectedCount]` (a SELECT gives the rows directly).
    const result: unknown = await manager.query('DELETE FROM uploads WHERE uploaded_by_user_id = $1 RETURNING url', [uploadedByUserId]);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<{ url: string }>;
    return rows.map((r) => r.url).filter((url): url is string => typeof url === 'string');
  }

  /**
   * Account deletion, step 2 (after commit): removes the stored files. Best effort and never throws — the database no longer references
   * them, so a file that could not be removed is an orphan, reported by count (never by URL: a URL is a capability) for an operator retry.
   */
  async removeStoredFiles(urls: string[]): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;
    for (const url of urls) {
      const ok = this.uploadProvider.remove ? await this.uploadProvider.remove(url).catch(() => false) : false;
      if (ok) removed += 1;
      else failed += 1;
    }
    if (failed > 0) this.logger.error(`account deletion: ${failed} of ${urls.length} uploaded file(s) could not be removed from storage (orphaned; database references already erased).`);
    return { removed, failed };
  }
}
