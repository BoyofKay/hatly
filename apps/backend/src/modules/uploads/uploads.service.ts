import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Upload } from './entities/upload.entity';
import { UPLOAD_PROVIDER, UploadProvider } from './upload-provider.interface';

@Injectable()
export class UploadsService {
  constructor(
    @InjectRepository(Upload) private readonly repo: Repository<Upload>,
    @Inject(UPLOAD_PROVIDER) private readonly uploadProvider: UploadProvider,
  ) {}

  async upload(base64Content: string, filename: string, uploadedByUserId: string): Promise<Upload> {
    const { url } = await this.uploadProvider.store({ base64Content, filename });
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
