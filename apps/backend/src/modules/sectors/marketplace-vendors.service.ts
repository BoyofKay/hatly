import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceSector } from './entities/marketplace-sector.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { HIGHEST_RATED_MINIMUM_RATING_COUNT } from '../ratings/highest-rated-threshold';
import { ServiceAreaResolverService } from '../service-areas/service-area-resolver.service';
import {
  VendorSortOption,
  normalizedSearchTerm,
  resolveLimit,
  resolvePage,
} from '../discovery/discovery.constants';

export interface MarketplaceVendorView {
  /**
   * The VendorBranch id — the actual addressable unit everywhere else
   * in this codebase (Products, Cart, Orders, Ratings, Offers all key
   * off `vendorBranchId`, never a bare Vendor id). Sector filtering is
   * itself branch-scoped (decision 2), so a listing entry is
   * necessarily one branch, not one Vendor — the same Vendor can
   * legitimately appear more than once across different sectors if it
   * has branches in each.
   */
  id: string;
  name: string;
  nameAr: string | null;
  logoUrl: string | null;
  isOpen: boolean;
  ratingAverage: number;
  ratingCount: number;
}

export interface MarketplaceVendorListResult {
  data: MarketplaceVendorView[];
  page: number;
  limit: number;
  total: number;
}

/**
 * CONFIRMED business decisions (Discovery & Ranking — do not reopen):
 * `sort=highestRated` uses `VendorBranch.ratingSumStars/ratingCount`,
 * gated by the existing `HIGHEST_RATED_MINIMUM_RATING_COUNT` (5) — a
 * branch below that threshold simply never appears under this sort
 * (it remains fully visible under `newest`/default browsing). Tie-break:
 * average -> ratingCount -> createdAt -> id, all descending except the
 * final deterministic id ascending (an arbitrary-but-stable final
 * tiebreaker, never meant to carry business meaning itself).
 * `sort=newest` (also the default) is unchanged from the Marketplace
 * Sector phase's own `createdAt DESC` ordering — Discovery only makes
 * it an explicit, selectable option rather than the sole behavior.
 * There is deliberately NO vendor-level `bestSelling` sort (decision:
 * Best Selling is product-level only in this chunk).
 *
 * Search (decision 8): vendor/branch `name`/`nameAr`, case-insensitive
 * substring (`ILIKE`), minimum 2 characters — below that, the normal
 * unsearched/sorted result is returned rather than executing an
 * expensive query, per `normalizedSearchTerm`'s own contract.
 *
 * Never trusts a client-supplied sector validity — the requested
 * `sectorId` is always re-verified as active/non-deleted server-side
 * before any branch is returned (decision 22) — unchanged from the
 * Marketplace Sector phase.
 */
@Injectable()
export class MarketplaceVendorsService {
  constructor(
    @InjectRepository(MarketplaceSector) private readonly sectorsRepository: Repository<MarketplaceSector>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
    private readonly serviceAreaResolverService: ServiceAreaResolverService,
  ) {}

  /**
   * PHASE I-B addition (Multi-City / Service Area): `latitude`/
   * `longitude` are OPTIONAL — deliberately backward-conscious. When
   * omitted, behavior is byte-for-byte unchanged from before this
   * chunk (no geographic filter at all — matches the existing,
   * already-built customer app, which doesn't send coordinates yet).
   * When provided, the backend resolves the containing ServiceArea and
   * filters strictly to branches assigned to that exact area — a
   * resolved-but-empty result (customer outside every active zone)
   * correctly returns zero branches, never an unfiltered fallback.
   */
  async listBySector(
    sectorId: string,
    params: {
      sort?: VendorSortOption;
      search?: string;
      page?: number;
      limit?: number;
      latitude?: number;
      longitude?: number;
    } = {},
  ): Promise<MarketplaceVendorListResult> {
    const sector = await this.sectorsRepository.findOne({ where: { id: sectorId } });
    if (!sector || !sector.isActive) {
      throw new NotFoundException('Sector not found.');
    }

    const page = resolvePage(params.page);
    const limit = resolveLimit(params.limit);
    const searchTerm = normalizedSearchTerm(params.search);

    let resolvedServiceAreaId: string | null = null;
    if (params.latitude != null && params.longitude != null) {
      const resolved = await this.serviceAreaResolverService.resolveForPoint(params.latitude, params.longitude);
      if (!resolved) {
        // Outside every active ServiceArea — correctly empty, never an
        // unfiltered fallback.
        return { data: [], page, limit, total: 0 };
      }
      resolvedServiceAreaId = resolved.id;
    }

    let qb = this.branchesRepository
      .createQueryBuilder('branch')
      .innerJoinAndSelect('branch.vendor', 'vendor')
      .where('branch.marketplace_sector_id = :sectorId', { sectorId })
      .andWhere('branch.is_active = true')
      .andWhere('vendor.is_active = true');

    if (resolvedServiceAreaId) {
      qb = qb.andWhere('branch.service_area_id = :serviceAreaId', { serviceAreaId: resolvedServiceAreaId });
    }

    if (searchTerm) {
      qb = qb.andWhere('(vendor.name ILIKE :term OR vendor.name_ar ILIKE :term)', { term: `%${searchTerm}%` });
    }

    if (params.sort === 'highestRated') {
      qb = qb
        .andWhere('branch.rating_count >= :minRatings', { minRatings: HIGHEST_RATED_MINIMUM_RATING_COUNT })
        .orderBy('(branch.rating_sum_stars::float / branch.rating_count)', 'DESC')
        .addOrderBy('branch.rating_count', 'DESC')
        .addOrderBy('branch.created_at', 'DESC')
        .addOrderBy('branch.id', 'ASC');
    } else {
      qb = qb.orderBy('branch.created_at', 'DESC').addOrderBy('branch.id', 'ASC');
    }

    // offset()/limit(), NOT skip()/take(): with a join TypeORM's skip/take switches to a two-query
    // "select distinct ids first" strategy that resolves every ORDER BY key as `alias.propertyName`.
    // Raw SQL ORDER BY expressions and database column names (`branch.created_at`, the rating
    // expressions) are not property paths, so the query crashed with a 500 on a real database
    // ("Cannot read properties of undefined (reading 'databaseName')" / "alias was not found").
    // The joins here are many-to-one (branch -> vendor, product -> branch -> vendor) and cannot
    // multiply parent rows, so plain LIMIT/OFFSET is exactly equivalent and safe.
    const [branches, total] = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    const data = branches.map((branch) => ({
      id: branch.id,
      name: branch.vendor.name,
      nameAr: branch.vendor.nameAr ?? null,
      logoUrl: branch.vendor.logoUrl ?? null,
      isOpen: branch.isOpen,
      ratingAverage: branch.ratingCount > 0 ? branch.ratingSumStars / branch.ratingCount : 0,
      ratingCount: branch.ratingCount,
    }));

    return { data, page, limit, total };
  }
}
