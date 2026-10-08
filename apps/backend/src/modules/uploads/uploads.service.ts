import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Upload } from './entities/upload.entity';
import { UPLOAD_PROVIDER, UploadProvider } from './upload-provider.interface';
import { decodeBase64Image, UploadRejectedError } from './image-validation';

@Injectable()
export class UploadsService {
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
}
