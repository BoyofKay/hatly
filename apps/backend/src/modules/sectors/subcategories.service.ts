import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceSubcategory } from './entities/marketplace-subcategory.entity';
import { VendorBranchSubcategory } from './entities/vendor-branch-subcategory.entity';
import { MarketplaceSector } from './entities/marketplace-sector.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';

/**
 * Consolidated customer-commerce milestone (Sector Subcategories).
 * Mirrors `SectorsService`'s own established discipline throughout:
 * every relationship is re-validated server-side on every write, soft
 * delete is TypeORM's default `find`/`findOne` behavior (never
 * manually re-checked), and destructive removal is avoided in favor
 * of deactivation wherever the customer-facing effect is equivalent.
 *
 * `VendorBranchSubcategory` is a genuine many-to-many join — unlike
 * `SectorsService.assignBranchSector` (which overwrites a single FK),
 * `setBranchSubcategories` below performs a full "set replace":
 * delete every existing row for the branch, then insert exactly the
 * requested set. Simpler and race-free for what is, in practice, an
 * infrequent Admin-form save rather than a hot path.
 */
@Injectable()
export class SubcategoriesService {
  constructor(
    @InjectRepository(MarketplaceSubcategory) private readonly subcategoriesRepository: Repository<MarketplaceSubcategory>,
    @InjectRepository(MarketplaceSector) private readonly sectorsRepository: Repository<MarketplaceSector>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
    @InjectRepository(VendorBranchSubcategory)
    private readonly branchSubcategoriesRepository: Repository<VendorBranchSubcategory>,
  ) {}

  async create(dto: CreateSubcategoryDto): Promise<MarketplaceSubcategory> {
    const sector = await this.sectorsRepository.findOne({ where: { id: dto.sectorId } });
    if (!sector) {
      throw new NotFoundException('Sector not found.');
    }
    return this.subcategoriesRepository.save(
      this.subcategoriesRepository.create({
        sectorId: sector.id,
        name: dto.name,
        nameAr: dto.nameAr ?? null,
        imageUrl: dto.imageUrl ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  /** Admin listing — optionally scoped to one sector, active or not. */
  async listAllForAdmin(sectorId?: string): Promise<MarketplaceSubcategory[]> {
    return this.subcategoriesRepository.find({
      where: sectorId ? { sectorId } : {},
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * CONFIRMED: customer-facing — active, non-deleted only, ordered
   * deterministically (sortOrder ASC, then createdAt ASC as a stable
   * tiebreaker) — same discipline as `SectorsService.listActiveForCustomers`.
   * Also re-verifies the parent sector is itself active — a subcategory
   * of a deactivated sector must never surface on its own.
   */
  async listActiveForSector(sectorId: string): Promise<MarketplaceSubcategory[]> {
    const sector = await this.sectorsRepository.findOne({ where: { id: sectorId } });
    if (!sector || !sector.isActive) {
      throw new NotFoundException('Sector not found.');
    }
    return this.subcategoriesRepository.find({
      where: { sectorId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async getOne(id: string): Promise<MarketplaceSubcategory> {
    const subcategory = await this.subcategoriesRepository.findOne({ where: { id } });
    if (!subcategory) {
      throw new NotFoundException('Subcategory not found.');
    }
    return subcategory;
  }

  async update(id: string, dto: UpdateSubcategoryDto): Promise<MarketplaceSubcategory> {
    const subcategory = await this.getOne(id);
    if (dto.name !== undefined) subcategory.name = dto.name;
    if (dto.nameAr !== undefined) subcategory.nameAr = dto.nameAr;
    if (dto.imageUrl !== undefined) subcategory.imageUrl = dto.imageUrl;
    if (dto.sortOrder !== undefined) subcategory.sortOrder = dto.sortOrder;
    return this.subcategoriesRepository.save(subcategory);
  }

  async deactivate(id: string): Promise<MarketplaceSubcategory> {
    const subcategory = await this.getOne(id);
    subcategory.isActive = false;
    return this.subcategoriesRepository.save(subcategory);
  }

  async activate(id: string): Promise<MarketplaceSubcategory> {
    const subcategory = await this.getOne(id);
    subcategory.isActive = true;
    return this.subcategoriesRepository.save(subcategory);
  }

  /**
   * Full "set replace" of a branch's subcategory memberships. Every
   * requested id is re-validated (must exist; must belong to the
   * branch's OWN sector — a branch cannot be filed under a
   * subcategory of a sector it doesn't operate in, which would make
   * the "select a subcategory -> see this branch" flow nonsensical).
   */
  async setBranchSubcategories(branchId: string, subcategoryIds: string[]): Promise<MarketplaceSubcategory[]> {
    const branch = await this.branchesRepository.findOne({ where: { id: branchId } });
    if (!branch) {
      throw new NotFoundException('Vendor branch not found.');
    }

    const uniqueIds = Array.from(new Set(subcategoryIds));
    const resolved = uniqueIds.length ? await this.findByIds(uniqueIds) : [];
    if (resolved.length !== uniqueIds.length) {
      const foundIds = new Set(resolved.map((s) => s.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException({ message: 'One or more subcategories were not found.', details: { missing } });
    }

    const mismatched = resolved.filter((s) => s.sectorId !== branch.marketplaceSectorId);
    if (mismatched.length > 0) {
      throw new BadRequestException({
        message: "A branch can only be assigned to subcategories of its own sector.",
        details: { code: 'SUBCATEGORY_SECTOR_MISMATCH', subcategoryIds: mismatched.map((s) => s.id) },
      });
    }

    await this.branchSubcategoriesRepository.delete({ vendorBranchId: branchId });
    if (resolved.length > 0) {
      await this.branchSubcategoriesRepository.insert(
        resolved.map((s) => ({ vendorBranchId: branchId, subcategoryId: s.id })),
      );
    }
    return resolved;
  }

  private async findByIds(ids: string[]): Promise<MarketplaceSubcategory[]> {
    if (ids.length === 0) return [];
    return this.subcategoriesRepository
      .createQueryBuilder('subcategory')
      .where('subcategory.id IN (:...ids)', { ids })
      .getMany();
  }
}
