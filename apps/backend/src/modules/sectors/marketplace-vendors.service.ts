import { branchIdsUnderClosure, isWithinOpeningHours, effectiveOpenSql } from '../../common/branch-availability';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryZone } from '../delivery-zones/entities/delivery-zone.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketplaceSector } from './entities/marketplace-sector.entity';
import { MarketplaceSubcategory } from './entities/marketplace-subcategory.entity';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Offer } from '../offers/entities/offer.entity';
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
  /** Vendor-level identity used by Favorites; id above remains the branch route. */
  vendorId: string;
  name: string;
  nameAr: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  isOpen: boolean;
  /** Weekly hours `{ sun: { open: '12:00', close: '02:00' }, … }` (Cairo time); empty = always open. */
  openingHours: Record<string, unknown>;
  ratingAverage: number;
  ratingCount: number;
  /**
   * Filters V1 addition. Real data — true only when at least one
   * currently-active, currently-in-window `Offer` row exists for this
   * branch (see `hasActiveOfferSql` below). Batch-resolved for the
   * whole returned page in one extra query, never per-row/N+1 — same
   * discipline `OfferConsumptionService.resolveActiveOffersForProducts`
   * already established for the product list.
   */
  hasOffer: boolean;
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
    @InjectRepository(MarketplaceSubcategory) private readonly subcategoriesRepository: Repository<MarketplaceSubcategory>,
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
    @InjectRepository(Offer) private readonly offersRepository: Repository<Offer>,
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
      /** Manual-address customers: narrow by the zone's service area (see ListVendorsQueryDto). */
      deliveryZoneId?: string;
      subcategoryId?: string;
      /** Filters V1. Real `VendorBranch.isOpen` — never inferred from opening-hours schedule data. */
      openNow?: boolean;
      /** Filters V1. Real, currently-in-window `Offer` existence — see `hasActiveOfferSql`. */
      hasOffers?: boolean;
      /** Filters V1. `0..5` — branches with no ratings at all never match any threshold > 0. */
      minRating?: number;
    } = {},
  ): Promise<MarketplaceVendorListResult> {
    const sector = await this.sectorsRepository.findOne({ where: { id: sectorId } });
    if (!sector || !sector.isActive) {
      throw new NotFoundException('Sector not found.');
    }

    // Consolidated customer-commerce milestone (Part E — Sector Subcategories): re-validated
    // server-side exactly like `sectorId` itself (never trusts client-supplied validity, same
    // discipline this class's own top comment already establishes) — a subcategory belonging to a
    // DIFFERENT sector than the one being browsed, or an inactive/deleted one, must never silently
    // filter results (that would look like an empty-but-plausible listing instead of a clear bug).
    if (params.subcategoryId) {
      const subcategory = await this.subcategoriesRepository.findOne({ where: { id: params.subcategoryId } });
      if (!subcategory || !subcategory.isActive || subcategory.sectorId !== sectorId) {
        throw new NotFoundException('Subcategory not found for this sector.');
      }
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
    } else if (params.deliveryZoneId) {
      const zone = await this.branchesRepository.manager
        .getRepository(DeliveryZone)
        .findOne({ where: { id: params.deliveryZoneId, isActive: true }, relations: { serviceArea: true } });
      if (!zone || !zone.serviceArea?.isActive) {
        // Same rule as a point outside every area: correctly empty, never an unfiltered fallback.
        return { data: [], page, limit, total: 0 };
      }
      resolvedServiceAreaId = zone.serviceAreaId;
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

    if (params.subcategoryId) {
      // A plain EXISTS against the join table, not an `innerJoin` — the join table has no
      // relevance to the SELECTed columns and an INNER JOIN on a many-to-many would risk
      // duplicating a branch row if it were ever assigned to more than one matching subcategory
      // (impossible here since we filter to exactly one subcategoryId, but EXISTS keeps this
      // correct even if that ever changes, and needs no DISTINCT).
      qb = qb.andWhere(
        'EXISTS (SELECT 1 FROM vendor_branch_subcategories vbs WHERE vbs.vendor_branch_id = branch.id AND vbs.subcategory_id = :subcategoryId)',
        { subcategoryId: params.subcategoryId },
      );
    }

    if (searchTerm) {
      qb = qb.andWhere('(vendor.name_norm ILIKE hatly_norm(:term) OR vendor.name_ar_norm ILIKE hatly_norm(:term))', { term: `%${searchTerm}%` });
    }

    // Filters V1 additions — all additive, all optional, all real data (no fabricated/inferred values).
    if (params.openNow) {
      qb = qb.andWhere(effectiveOpenSql('branch')); // the manual switch AND no active closure
    }
    if (params.hasOffers) {
      qb = qb.andWhere(hasActiveOfferSql());
    }
    if (params.minRating != null) {
      qb = qb.andWhere('branch.rating_count > 0 AND (branch.rating_sum_stars::float / branch.rating_count) >= :minRating', {
        minRating: params.minRating,
      });
    }

    if (params.sort === 'highestRated') {
      qb = qb
        .andWhere('branch.rating_count >= :minRatings', { minRatings: HIGHEST_RATED_MINIMUM_RATING_COUNT })
        .orderBy('(branch.rating_sum_stars::float / branch.rating_count)', 'DESC')
        .addOrderBy('branch.rating_count', 'DESC')
        .addOrderBy('branch.created_at', 'DESC')
        .addOrderBy('branch.id', 'ASC');
    } else if (params.sort === 'offers') {
      // Filters V1. Ordering by a raw EXISTS expression works fine without it being in the SELECT
      // list (plain Postgres ORDER BY, no DISTINCT involved) — no `addSelect`/raw-hydration
      // complexity needed, unlike the per-branch `hasOffer` VALUE below (which does need a real
      // batch query since we return it, not just sort by it).
      qb = qb
        .orderBy(hasActiveOfferSql(), 'DESC')
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

    // Filters V1. ONE extra query for the whole returned page — never N+1 — mirrors
    // `OfferConsumptionService.resolveActiveOffersForProducts`'s own "batch resolve, per page"
    // discipline exactly. A vendor-list "has offer" badge/filter only needs a presence signal
    // (unlike the product-level version, it doesn't need to know WHICH offer, so no product/category
    // targeting resolution is needed here at all — any currently-active, in-window Offer row for the
    // branch is sufficient).
    const branchIds = branches.map((b) => b.id);
    const branchIdsWithOffer = new Set<string>();
    if (branchIds.length > 0) {
      const rows: Array<{ vendor_branch_id: string }> = await this.offersRepository
        .createQueryBuilder('offer')
        .select('DISTINCT offer.vendor_branch_id', 'vendor_branch_id')
        .where('offer.vendor_branch_id IN (:...branchIds)', { branchIds })
        .andWhere('offer.is_active = true')
        .andWhere('offer.start_at <= now()')
        .andWhere('offer.end_at > now()')
        .getRawMany();
      for (const row of rows) branchIdsWithOffer.add(row.vendor_branch_id);
    }

    const underClosure = await branchIdsUnderClosure(this.branchesRepository.manager, branches.map((b) => b.id));
    const data = branches.map((branch) => ({
      id: branch.id,
      vendorId: branch.vendorId,
      name: branch.vendor.name,
      nameAr: branch.vendor.nameAr ?? null,
      logoUrl: branch.vendor.logoUrl ?? null,
      coverImageUrl: branch.vendor.coverImageUrl ?? null,
      // Bug 2026-11-23: 'open' must match checkout — the switch, temporary closures AND the weekly working hours.
      isOpen: branch.isOpen && !underClosure.has(branch.id) && isWithinOpeningHours(branch.openingHours as never),
      openingHours: branch.openingHours ?? {},
      ratingAverage: branch.ratingCount > 0 ? branch.ratingSumStars / branch.ratingCount : 0,
      ratingCount: branch.ratingCount,
      hasOffer: branchIdsWithOffer.has(branch.id),
    }));

    return { data, page, limit, total };
  }
}

/**
 * Filters V1. A branch counts as "has an offer" purely by real,
 * currently-active, currently-in-window `Offer` existence. This is
 * hand-written raw SQL (a correlated subquery string), NOT a
 * TypeORM-generated query — so it does NOT get TypeORM's automatic
 * `deleted_at IS NULL` soft-delete scoping the way `.createQueryBuilder()`
 * calls do; `o.deleted_at IS NULL` is spelled out explicitly here for
 * exactly that reason. Used both as a `WHERE` filter (`hasOffers=true`)
 * and as a raw `ORDER BY` expression (`sort=offers`) — Postgres allows
 * ordering by an expression that isn't in the SELECT list, so this
 * never needs `addSelect`/raw-row hydration.
 */
function hasActiveOfferSql(): string {
  return `EXISTS (
    SELECT 1 FROM offers o
    WHERE o.vendor_branch_id = branch.id
      AND o.is_active = true
      AND o.deleted_at IS NULL
      AND o.start_at <= now()
      AND o.end_at > now()
  )`;
}
