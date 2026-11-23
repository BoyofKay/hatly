import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceSector } from './entities/marketplace-sector.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { CreateSectorDto } from './dto/create-sector.dto';
import { UpdateSectorDto } from './dto/update-sector.dto';

/**
 * FINAL DECISION: Admin-only (no Vendor-facing sector management or
 * branch-assignment endpoint exists anywhere — see the controllers'
 * own comments). `getOne`/`assignBranchSector` rely on TypeORM's
 * `@DeleteDateColumn`-backed soft delete (see BaseEntity) to already
 * exclude a soft-deleted sector from `findOne` by default — no manual
 * `deletedAt IS NULL` check is needed for that half; `isActive` is a
 * separate flag checked explicitly.
 */
@Injectable()
export class SectorsService {
  constructor(
    @InjectRepository(MarketplaceSector) private readonly sectorsRepository: Repository<MarketplaceSector>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
  ) {}

  async create(dto: CreateSectorDto): Promise<MarketplaceSector> {
    await this.assertSlugAvailable(dto.slug);
    return this.sectorsRepository.save(
      this.sectorsRepository.create({
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        slug: dto.slug,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        imageUrl: dto.imageUrl ?? null,
        bannerUrl: dto.bannerUrl ?? null,
        customRequestsEnabled: dto.customRequestsEnabled ?? false,
      }),
    );
  }

  /** Admin listing — every sector, active or not (soft-deleted ones are still excluded, per TypeORM's own default). */
  async listAllForAdmin(): Promise<MarketplaceSector[]> {
    return this.sectorsRepository.find({ order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  /**
   * CONFIRMED (decision 12): customer-facing — active, non-deleted
   * only, ordered by sortOrder ASC then a stable deterministic
   * secondary key (createdAt) so ties never reorder unpredictably
   * between requests.
   */
  async listActiveForCustomers(): Promise<MarketplaceSector[]> {
    return this.sectorsRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async getOne(id: string): Promise<MarketplaceSector> {
    const sector = await this.sectorsRepository.findOne({ where: { id } });
    if (!sector) {
      throw new NotFoundException('Sector not found.');
    }
    return sector;
  }

  async update(id: string, dto: UpdateSectorDto): Promise<MarketplaceSector> {
    const sector = await this.getOne(id);
    if (dto.name !== undefined) sector.name = dto.name;
    if (dto.nameAr !== undefined) sector.nameAr = dto.nameAr;
    if (dto.sortOrder !== undefined) sector.sortOrder = dto.sortOrder;
    if (dto.imageUrl !== undefined) sector.imageUrl = dto.imageUrl;
    if (dto.bannerUrl !== undefined) sector.bannerUrl = dto.bannerUrl;
    if (dto.customRequestsEnabled !== undefined) sector.customRequestsEnabled = dto.customRequestsEnabled;
    return this.sectorsRepository.save(sector);
  }

  /**
   * Prefer safe deactivation over destructive deletion (decision 9/21)
   * — never touches any VendorBranch currently assigned to this
   * sector. A branch pointed at a since-deactivated sector keeps its
   * FK exactly as-is (never nulled, never corrupted) — it simply stops
   * being returned by the active-only customer-facing endpoints (see
   * MarketplaceVendorsService), which is the intended effect of
   * deactivation, not a data-integrity risk.
   */
  async deactivate(id: string): Promise<MarketplaceSector> {
    const sector = await this.getOne(id);
    sector.isActive = false;
    return this.sectorsRepository.save(sector);
  }

  async activate(id: string): Promise<MarketplaceSector> {
    const sector = await this.getOne(id);
    sector.isActive = true;
    return this.sectorsRepository.save(sector);
  }

  /**
   * CONFIRMED (decision 11): every assignment is fully re-validated —
   * never trusts that a previously-valid sectorId is still valid.
   * Exactly one sector per branch — a second call simply overwrites
   * the FK (never a many-to-many, per decision 7).
   */
  async assignBranchSector(branchId: string, sectorId: string): Promise<VendorBranch> {
    const branch = await this.branchesRepository.findOne({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException('Vendor branch not found.');
    }

    const sector = await this.getOne(sectorId); // NotFoundException if missing or soft-deleted
    if (!sector.isActive) {
      throw new BadRequestException({
        message: 'Cannot assign a VendorBranch to an inactive Sector.',
        details: { code: 'SECTOR_NOT_ACTIVE' },
      });
    }

    branch.marketplaceSectorId = sector.id;
    return this.branchesRepository.save(branch);
  }

  private async assertSlugAvailable(slug: string): Promise<void> {
    const existing = await this.sectorsRepository.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException({
        message: 'A Sector with this slug already exists.',
        details: { code: 'SLUG_ALREADY_EXISTS' },
      });
    }
  }
}
