import { branchIdsUnderClosure, isWithinOpeningHours, effectiveOpenSql } from '../../common/branch-availability';
import { resolvePublicCatalogIds } from '../catalog/public-catalog-link';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VendorBranch } from '../vendors/entities/vendor-branch.entity';
import { Product } from '../products/entities/product.entity';
import { ServiceAreaResolverService } from '../service-areas/service-area-resolver.service';
import { normalizedSearchTerm, resolveLimit, resolvePage } from './discovery.constants';
import { OfferConsumptionService, ActiveOfferSummary } from '../offers/offer-consumption.service';

export interface SearchVendorResult {
  /** VendorBranch.id — CONFIRMED, the same addressable unit `/vendors` and `/vendor-branches/:id` already use, never a bare Vendor id. */
  id: string;
  /** Vendor-level ID for customer favorites; id is still VendorBranch ID. */
  vendorId: string;
  name: string;
  nameAr: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  isOpen: boolean;
  openingHours: Record<string, unknown>;
  ratingAverage: number;
  ratingCount: number;
}

export interface SearchProductResult {
  id: string;
  /** Marketplace product identity when linked to an ACTIVE catalog product, otherwise null. */
  catalogProductId: string | null;
  vendorBranchId: string;
  name: string;
  nameAr: string | null;
  imageUrl: string | null;
  priceMinor: number;
  pricingUnit: string;
  inventoryMode: string;
  quantity: number | null;
  isAvailable: boolean;
  vendorName: string;
  vendorNameAr: string | null;
  vendorLogoUrl: string | null;
  /** Customer Product-Level Offers Display. Same shape as the Product Card/Details contract — never a separate Search-specific representation. */
  activeOffer: ActiveOfferSummary | null;
}

export interface SearchResultPage<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface SearchResult {
  vendors: SearchResultPage<SearchVendorResult>;
  products: SearchResultPage<SearchProductResult>;
}

/**
 * Customer Search. ADDITIVE — reuses every existing rule verbatim
 * rather than reimplementing any of them:
 *  - `discovery.constants.ts` (normalizedSearchTerm/resolvePage/
 *    resolveLimit) — the exact same shared module `/vendors` and
 *    product listing already depend on, so this never drifts from
 *    them on min-query-length or pagination defaults.
 *  - `ServiceAreaResolverService.resolveForPoint` — the exact same
 *    ServiceArea algorithm `MarketplaceVendorsService.listBySector`
 *    already uses; not a second implementation.
 *  - The exact same `ILIKE`/rating-formula/column-name conventions
 *    confirmed by direct inspection of `MarketplaceVendorsService`/
 *    `ProductsService`.
 *
 * Genuinely NEW in this file (not copied from anywhere): the
 * cross-sector/cross-branch scope itself (neither existing query can
 * search without already knowing a sector or branch), the three-tier
 * exact/prefix/partial ranking, and the Search-specific
 * `isAvailable = true` product filter (the existing per-branch
 * product listing does NOT filter this — CONFIRMED by inspection —
 * this filter is deliberately added here per the approved design,
 * not copied from an absent precedent).
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectRepository(VendorBranch) private readonly branchesRepository: Repository<VendorBranch>,
    @InjectRepository(Product) private readonly productsRepository: Repository<Product>,
    private readonly serviceAreaResolverService: ServiceAreaResolverService,
    private readonly offerConsumptionService: OfferConsumptionService,
  ) {}

  async search(params: {
    q: string;
    latitude?: number;
    longitude?: number;
    vendorPage?: number;
    vendorLimit?: number;
    productPage?: number;
    productLimit?: number;
  }): Promise<SearchResult> {
    const vendorPage = resolvePage(params.vendorPage);
    const vendorLimit = resolveLimit(params.vendorLimit);
    const productPage = resolvePage(params.productPage);
    const productLimit = resolveLimit(params.productLimit);
    const searchTerm = normalizedSearchTerm(params.q);

    const emptyResult: SearchResult = {
      vendors: { data: [], page: vendorPage, limit: vendorLimit, total: 0 },
      products: { data: [], page: productPage, limit: productLimit, total: 0 },
    };

    // Below the minimum length — CONFIRMED, reuse the exact same
    // "no expensive query" gate as every other search-capable query.
    if (!searchTerm) {
      return emptyResult;
    }

    // Resolved ONCE, reused for both the vendor and product queries
    // below — CONFIRMED single ServiceArea algorithm, not duplicated.
    let resolvedServiceAreaId: string | null = null;
    if (params.latitude != null && params.longitude != null) {
      const resolved = await this.serviceAreaResolverService.resolveForPoint(params.latitude, params.longitude);
      if (!resolved) {
        // Outside every active ServiceArea — correctly empty for
        // BOTH collections, never an unfiltered fallback.
        return emptyResult;
      }
      resolvedServiceAreaId = resolved.id;
    }

    const [vendors, products] = await Promise.all([
      this.searchVendors(searchTerm, resolvedServiceAreaId, vendorPage, vendorLimit),
      this.searchProducts(searchTerm, resolvedServiceAreaId, productPage, productLimit),
    ]);

    return { vendors, products };
  }

  private async searchVendors(
    term: string,
    serviceAreaId: string | null,
    page: number,
    limit: number,
  ): Promise<SearchResultPage<SearchVendorResult>> {
    let qb = this.branchesRepository
      .createQueryBuilder('branch')
      .innerJoinAndSelect('branch.vendor', 'vendor')
      .where('branch.is_active = true')
      .andWhere('vendor.is_active = true')
      .andWhere('(vendor.name_norm ILIKE hatly_norm(:term) OR vendor.name_ar_norm ILIKE hatly_norm(:term))', { term: `%${term}%` });

    if (serviceAreaId) {
      qb = qb.andWhere('branch.service_area_id = :serviceAreaId', { serviceAreaId });
    }

    // Three-tier relevance — CONFIRMED, no scoring engine: an exact
    // (case-insensitive) match ranks above a prefix match, which
    // ranks above any other partial match; ties broken by the exact
    // same rating formula/ordering `listBySector`'s own highestRated
    // sort already uses, then a stable id tiebreaker.
    qb = qb
      .addSelect(
        `CASE
          WHEN vendor.name_norm = hatly_norm(:exactTerm) OR vendor.name_ar_norm = hatly_norm(:exactTerm) THEN 0
          WHEN vendor.name_norm ILIKE hatly_norm(:prefixTerm) OR vendor.name_ar_norm ILIKE hatly_norm(:prefixTerm) THEN 1
          ELSE 2
        END`,
        'relevance_rank',
      )
      .setParameters({ exactTerm: term, prefixTerm: `${term}%` })
      .orderBy('relevance_rank', 'ASC')
      .addOrderBy('(branch.rating_count > 0)', 'DESC')
      .addOrderBy(
        'CASE WHEN branch.rating_count > 0 THEN branch.rating_sum_stars::float / branch.rating_count ELSE 0 END',
        'DESC',
      )
      .addOrderBy('branch.rating_count', 'DESC')
      .addOrderBy('branch.id', 'ASC');

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

    const underClosure = await branchIdsUnderClosure(this.branchesRepository.manager, branches.map((b) => b.id));
    const data = branches.map((branch) => ({
      id: branch.id,
      vendorId: branch.vendorId,
      name: branch.vendor.name,
      nameAr: branch.vendor.nameAr ?? null,
      logoUrl: branch.vendor.logoUrl ?? null,
      coverImageUrl: branch.vendor.coverImageUrl ?? null,
      isOpen: branch.isOpen && !underClosure.has(branch.id) && isWithinOpeningHours(branch.openingHours as never),
      openingHours: branch.openingHours ?? {},
      ratingAverage: branch.ratingCount > 0 ? branch.ratingSumStars / branch.ratingCount : 0,
      ratingCount: branch.ratingCount,
    }));

    return { data, page, limit, total };
  }

  private async searchProducts(
    term: string,
    serviceAreaId: string | null,
    page: number,
    limit: number,
  ): Promise<SearchResultPage<SearchProductResult>> {
    // Single joined query — CONFIRMED, no N+1: the owning
    // VendorBranch+Vendor are loaded in the SAME query as the
    // products themselves.
    let qb = this.productsRepository
      .createQueryBuilder('product')
      .innerJoinAndSelect('product.vendorBranch', 'branch')
      .innerJoinAndSelect('branch.vendor', 'vendor')
      .where('branch.is_active = true')
      .andWhere('vendor.is_active = true')
      // Search-specific rule (approved design): unavailable products
      // are excluded. CONFIRMED this filter does NOT exist on the
      // per-branch product listing (inspected directly) — added here
      // deliberately, not copied from an absent precedent. TRACKED
      // quantity=0 products are NOT excluded by this or any other
      // condition here — visible as long as isAvailable is true,
      // matching the Inventory Foundation's own closed decision.
      .andWhere('product.is_available = true')
      .andWhere('(product.name_norm ILIKE hatly_norm(:term) OR product.name_ar_norm ILIKE hatly_norm(:term))', { term: `%${term}%` });

    if (serviceAreaId) {
      qb = qb.andWhere('branch.service_area_id = :serviceAreaId', { serviceAreaId });
    }

    qb = qb
      .addSelect(
        `CASE
          WHEN product.name_norm = hatly_norm(:exactTerm) OR product.name_ar_norm = hatly_norm(:exactTerm) THEN 0
          WHEN product.name_norm ILIKE hatly_norm(:prefixTerm) OR product.name_ar_norm ILIKE hatly_norm(:prefixTerm) THEN 1
          ELSE 2
        END`,
        'relevance_rank',
      )
      .setParameters({ exactTerm: term, prefixTerm: `${term}%` })
      .orderBy('relevance_rank', 'ASC')
      .addOrderBy('(branch.rating_count > 0)', 'DESC')
      .addOrderBy(
        'CASE WHEN branch.rating_count > 0 THEN branch.rating_sum_stars::float / branch.rating_count ELSE 0 END',
        'DESC',
      )
      .addOrderBy('product.id', 'ASC');

    // offset()/limit(), NOT skip()/take(): with a join TypeORM's skip/take switches to a two-query
    // "select distinct ids first" strategy that resolves every ORDER BY key as `alias.propertyName`.
    // Raw SQL ORDER BY expressions and database column names (`branch.created_at`, the rating
    // expressions) are not property paths, so the query crashed with a 500 on a real database
    // ("Cannot read properties of undefined (reading 'databaseName')" / "alias was not found").
    // The joins here are many-to-one (branch -> vendor, product -> branch -> vendor) and cannot
    // multiply parent rows, so plain LIMIT/OFFSET is exactly equivalent and safe.
    const [products, total] = await qb
      .offset((page - 1) * limit)
      .limit(limit)
      .getManyAndCount();

    // Customer Product-Level Offers Display. Batched PER BRANCH
    // (search can span many vendors, so a single global call would
    // wrongly mix branch-scoped offers) — CONFIRMED still never a
    // per-product query: at most one resolution call per DISTINCT
    // branch appearing on this page of results, reusing the exact
    // same batch method Product Cards/Details use, not a second
    // Search-specific implementation.
    const productsByBranch = new Map<string, typeof products>();
    for (const product of products) {
      if (!productsByBranch.has(product.vendorBranchId)) productsByBranch.set(product.vendorBranchId, []);
      productsByBranch.get(product.vendorBranchId)!.push(product);
    }
    const offersByProductId = new Map<string, ActiveOfferSummary>();
    for (const [vendorBranchId, branchProducts] of productsByBranch) {
      const resolved = await this.offerConsumptionService.resolveActiveOffersForProducts({
        vendorBranchId,
        products: branchProducts.map((p) => ({ productId: p.id, categoryId: p.categoryId, priceMinor: Number(p.priceMinor), pricingUnit: p.pricingUnit })),
      });
      for (const [productId, summary] of resolved) offersByProductId.set(productId, summary);
    }

    // Additive: the marketplace product identity (active catalog products only). One query per page.
    const catalogIds = await resolvePublicCatalogIds(
      this.productsRepository.manager,
      products.map((p) => p.id),
    );

    const data = products.map((product) => ({
      id: product.id,
      catalogProductId: catalogIds.get(product.id) ?? null,
      vendorBranchId: product.vendorBranchId,
      name: product.name,
      nameAr: product.nameAr ?? null,
      imageUrl: product.imageUrl ?? null,
      priceMinor: product.priceMinor,
      pricingUnit: product.pricingUnit,
      inventoryMode: product.inventoryMode,
      quantity: product.quantity ?? null,
      isAvailable: product.isAvailable,
      vendorName: product.vendorBranch.vendor.name,
      vendorNameAr: product.vendorBranch.vendor.nameAr ?? null,
      vendorLogoUrl: product.vendorBranch.vendor.logoUrl ?? null,
      activeOffer: offersByProductId.get(product.id) ?? null,
    }));

    return { data, page, limit, total };
  }
}
