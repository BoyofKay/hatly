import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { checkBannerDimensions } from '../uploads/image-dimensions';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HomeBanner } from './entities/home-banner.entity';
import { HomeBannerActionType } from './home-banner-action.enum';
import { CreateHomeBannerDto } from './dto/create-home-banner.dto';
import { UpdateHomeBannerDto } from './dto/update-home-banner.dto';
import { Product } from '../products/entities/product.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { MarketplaceSector } from '../sectors/entities/marketplace-sector.entity';
import { UploadsService } from '../uploads/uploads.service';

/** At most this many banners are ever returned to customers (a carousel, not a catalogue). */
export const MAX_PUBLIC_BANNERS = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/** Where a banner stands in time, computed for the admin (the customer API simply omits everything that is not LIVE). */
export type HomeBannerDisplayStatus = 'DRAFT' | 'LIVE' | 'SCHEDULED' | 'EXPIRED';

export interface AdminHomeBannerView {
  id: string;
  title: string;
  titleAr: string | null;
  imageUrl: string | null;
  imageUrlAr?: string | null;
  actionType: HomeBannerActionType;
  actionTargetId: string | null;
  sectorId: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  displayStatus: HomeBannerDisplayStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** What a customer's phone receives — nothing administrative (no status, schedule, creator or timestamps). */
export interface PublicHomeBannerView {
  id: string;
  title: string;
  titleAr: string | null;
  imageUrl: string;
  imageUrlAr?: string | null;
  actionType: HomeBannerActionType;
  actionTargetId: string | null;
  sectorId: string | null;
}

@Injectable()
export class HomeBannersService {
  constructor(
    @InjectRepository(HomeBanner) private readonly repo: Repository<HomeBanner>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(VendorBranch) private readonly branches: Repository<VendorBranch>,
    @InjectRepository(MarketplaceSector) private readonly sectors: Repository<MarketplaceSector>,
    private readonly uploads: UploadsService,
  ) {}

  // ---- admin ---------------------------------------------------------------------------------------------------------------------

  async listForAdmin(now = new Date()): Promise<AdminHomeBannerView[]> {
    const rows = await this.repo.find({ order: { sortOrder: 'ASC', createdAt: 'DESC' } });
    return rows.map((b) => this.toAdminView(b, now));
  }

  async getForAdmin(id: string, now = new Date()): Promise<AdminHomeBannerView> {
    return this.toAdminView(await this.getOne(id), now);
  }

  async create(dto: CreateHomeBannerDto): Promise<AdminHomeBannerView> {
    const next = {
      actionType: dto.actionType ?? HomeBannerActionType.NONE,
      actionTargetId: dto.actionTargetId ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    };
    this.assertSchedule(next.startsAt, next.endsAt);
    await this.assertAction(next.actionType, next.actionTargetId);
    if (dto.sectorId) await this.assertSector(dto.sectorId);
    const saved = await this.repo.save(
      this.repo.create({
        title: dto.title.trim(),
        titleAr: dto.titleAr?.trim() || null,
        imageUrl: null,
        sectorId: dto.sectorId ?? (next.actionType === HomeBannerActionType.SECTOR ? next.actionTargetId : null),
        ...next,
        sortOrder: dto.sortOrder ?? 0,
        isActive: false,
      }),
    );
    return this.toAdminView(saved);
  }

  async update(id: string, dto: UpdateHomeBannerDto): Promise<AdminHomeBannerView> {
    const banner = await this.getOne(id);
    if (dto.title !== undefined) banner.title = dto.title.trim();
    if (dto.titleAr !== undefined) banner.titleAr = dto.titleAr === null ? null : dto.titleAr.trim() || null;
    if (dto.sortOrder !== undefined) banner.sortOrder = dto.sortOrder;
    if (dto.startsAt !== undefined) banner.startsAt = dto.startsAt === null ? null : new Date(dto.startsAt);
    if (dto.endsAt !== undefined) banner.endsAt = dto.endsAt === null ? null : new Date(dto.endsAt);
    if (dto.actionType !== undefined) {
      banner.actionType = dto.actionType;
      // Switching to NONE drops the target unless the same request (wrongly) sends one — which assertAction then refuses.
      if (dto.actionType === HomeBannerActionType.NONE && dto.actionTargetId === undefined) banner.actionTargetId = null;
    }
    if (dto.actionTargetId !== undefined) banner.actionTargetId = dto.actionTargetId;
    if (dto.sectorId !== undefined) banner.sectorId = dto.sectorId;
    this.assertSchedule(banner.startsAt ?? null, banner.endsAt ?? null);
    await this.assertAction(banner.actionType, banner.actionTargetId ?? null);
    if (banner.sectorId) await this.assertSector(banner.sectorId);
    return this.toAdminView(await this.repo.save(banner));
  }

  /**
   * Same boundary as a product image: JPEG/PNG/WebP only, 5 MB, and the stored name comes from the VALIDATED type, never the client's
   * filename. The file goes through the project's upload provider (`UploadsService`, which also checks the real bytes); only after
   * storage succeeded is the banner row updated. The stored value is the provider's stable reference, not a signed URL.
   */
  async uploadImage(
    id: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    uploadedByUserId: string,
    language: 'en' | 'ar' = 'en',
  ): Promise<AdminHomeBannerView> {
    const banner = await this.getOne(id);
    const extension = IMAGE_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException({ message: 'Only JPEG, PNG, or WebP images are allowed.', details: { code: 'UNSUPPORTED_IMAGE_TYPE' } });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException({ message: 'Image exceeds the maximum allowed size of 5MB.', details: { code: 'IMAGE_TOO_LARGE' } });
    }
    const shape = checkBannerDimensions(file.buffer);
    if (!shape.ok) {
      throw new BadRequestException({ message: shape.message, details: { code: shape.code } });
    }
    const upload = await this.uploads.upload(file.buffer.toString('base64'), `banner${extension}`, uploadedByUserId);
    if (language === 'ar') banner.imageUrlAr = upload.url;
    else banner.imageUrl = upload.url;
    return this.toAdminView(await this.repo.save(banner));
  }

  async activate(id: string): Promise<AdminHomeBannerView> {
    const banner = await this.getOne(id);
    if (!banner.imageUrl && !banner.imageUrlAr) {
      throw new BadRequestException({ message: 'Upload an image before publishing this banner.', details: { code: 'BANNER_IMAGE_REQUIRED' } });
    }
    banner.isActive = true;
    return this.toAdminView(await this.repo.save(banner));
  }

  async deactivate(id: string): Promise<AdminHomeBannerView> {
    const banner = await this.getOne(id);
    banner.isActive = false;
    return this.toAdminView(await this.repo.save(banner));
  }

  /** Soft delete: deactivated first, then hidden from every list. */
  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const banner = await this.getOne(id);
    banner.isActive = false;
    await this.repo.save(banner);
    await this.repo.softRemove(banner);
    return { id, deleted: true };
  }

  // ---- customers -----------------------------------------------------------------------------------------------------------------

  /**
   * The banners a customer may see RIGHT NOW: active, with an image, inside their schedule window, in the admin's order, capped. A
   * banner whose destination has since disappeared (product unavailable, branch or sector deactivated or removed) is left out
   * rather than leading to a dead page.
   */
  async listPublic(now = new Date()): Promise<PublicHomeBannerView[]> {
    const rows = await this.repo
      .createQueryBuilder('b')
      .where('b.is_active = true')
      .andWhere('(b.image_url IS NOT NULL OR b.image_url_ar IS NOT NULL)')
      .andWhere('(b.starts_at IS NULL OR b.starts_at <= :now)', { now })
      .andWhere('(b.ends_at IS NULL OR b.ends_at > :now)', { now })
      .orderBy('b.sort_order', 'ASC')
      .addOrderBy('b.created_at', 'DESC')
      .limit(MAX_PUBLIC_BANNERS * 2) // headroom: some may be dropped below
      .getMany();
    if (rows.length === 0) return [];

    const usable = {
      [HomeBannerActionType.PRODUCT]: await this.usableIds(this.products, rows, HomeBannerActionType.PRODUCT, { isAvailable: true }),
      [HomeBannerActionType.VENDOR]: await this.usableIds(this.branches, rows, HomeBannerActionType.VENDOR, { isActive: true }),
      [HomeBannerActionType.SECTOR]: await this.usableIds(this.sectors, rows, HomeBannerActionType.SECTOR, { isActive: true }),
    };
    return rows
      .filter((b) => b.actionType === HomeBannerActionType.NONE || usable[b.actionType].has(b.actionTargetId ?? ''))
      .slice(0, MAX_PUBLIC_BANNERS)
      .map((b) => ({
        id: b.id,
        title: b.title,
        titleAr: b.titleAr ?? null,
        imageUrl: (b.imageUrl ?? b.imageUrlAr) as string,
        ...(b.imageUrlAr ? { imageUrlAr: b.imageUrlAr } : {}),
        actionType: b.actionType,
        actionTargetId: b.actionTargetId ?? null,
        sectorId: b.sectorId ?? (b.actionType === HomeBannerActionType.SECTOR ? b.actionTargetId ?? null : null),
      }));
  }

  // ---- internals -----------------------------------------------------------------------------------------------------------------

  private async assertSector(id: string): Promise<void> {
    if (!(await this.sectors.findOne({ where: { id, isActive: true } }))) {
      throw new BadRequestException({ message: 'Choose an active sector for this promotion.', details: { code: 'BANNER_SECTOR_INVALID' } });
    }
  }

  private async getOne(id: string): Promise<HomeBanner> {
    const banner = await this.repo.findOne({ where: { id } });
    if (!banner) throw new NotFoundException({ message: 'Banner not found.', details: { code: 'BANNER_NOT_FOUND' } });
    return banner;
  }

  private async usableIds(
    repo: Repository<any>,
    rows: HomeBanner[],
    type: HomeBannerActionType,
    activeWhere: Record<string, boolean>,
  ): Promise<Set<string>> {
    const ids = [...new Set(rows.filter((b) => b.actionType === type && b.actionTargetId).map((b) => b.actionTargetId as string))];
    if (ids.length === 0) return new Set();
    const found: Array<{ id: string }> = await repo.find({ where: { id: In(ids), ...activeWhere }, select: { id: true } });
    return new Set(found.map((r) => r.id));
  }

  private assertSchedule(startsAt: Date | null, endsAt: Date | null): void {
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException({ message: 'The end time must be after the start time.', details: { code: 'BANNER_SCHEDULE_INVALID' } });
    }
  }

  /** NONE has no target; anything else needs one that exists today. (Whether it is still usable is re-checked when customers read.) */
  private async assertAction(type: HomeBannerActionType, targetId: string | null): Promise<void> {
    if (type === HomeBannerActionType.NONE) {
      if (targetId) {
        throw new BadRequestException({ message: 'A banner with no action cannot have a target.', details: { code: 'BANNER_ACTION_TARGET_UNEXPECTED' } });
      }
      return;
    }
    if (!targetId) {
      throw new BadRequestException({ message: 'Choose what this banner opens.', details: { code: 'BANNER_ACTION_TARGET_REQUIRED' } });
    }
    const repo: Repository<any> = type === HomeBannerActionType.PRODUCT ? this.products : type === HomeBannerActionType.VENDOR ? this.branches : this.sectors;
    if (!(await repo.findOne({ where: { id: targetId }, select: { id: true } }))) {
      throw new BadRequestException({ message: 'The chosen destination does not exist.', details: { code: 'BANNER_ACTION_TARGET_NOT_FOUND' } });
    }
  }

  private toAdminView(b: HomeBanner, now = new Date()): AdminHomeBannerView {
    return {
      id: b.id,
      title: b.title,
      titleAr: b.titleAr ?? null,
      imageUrl: b.imageUrl ?? null,
      ...(b.imageUrlAr ? { imageUrlAr: b.imageUrlAr } : {}),
      actionType: b.actionType,
      actionTargetId: b.actionTargetId ?? null,
      sectorId: b.sectorId ?? null,
      sortOrder: b.sortOrder,
      isActive: b.isActive,
      startsAt: b.startsAt ?? null,
      endsAt: b.endsAt ?? null,
      displayStatus: this.statusAt(b, now),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  statusAt(b: Pick<HomeBanner, 'isActive' | 'imageUrl' | 'imageUrlAr' | 'startsAt' | 'endsAt'>, now: Date): HomeBannerDisplayStatus {
    if (!b.isActive || (!b.imageUrl && !b.imageUrlAr)) return 'DRAFT';
    if (b.startsAt && b.startsAt.getTime() > now.getTime()) return 'SCHEDULED';
    if (b.endsAt && b.endsAt.getTime() <= now.getTime()) return 'EXPIRED';
    return 'LIVE';
  }
}
