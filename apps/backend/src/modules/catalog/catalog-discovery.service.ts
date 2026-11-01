import { branchIdsUnderClosure, effectiveOpenSql } from '../../common/branch-availability';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CatalogProduct } from './entities/catalog-product.entity';
import { MarketplaceSector } from '../sectors/entities/marketplace-sector.entity';
import { ServiceAreaResolverService } from '../service-areas/service-area-resolver.service';
import { ActiveOfferSummary, OfferConsumptionService } from '../offers/offer-consumption.service';
import { HIGHEST_RATED_MINIMUM_RATING_COUNT } from '../ratings/highest-rated-threshold';
import { normalizedSearchTerm, resolveLimit, resolvePage } from '../discovery/discovery.constants';

export interface MarketplaceProductItem {
  /** Null for a listing nobody has linked to a catalog product (or whose catalog product is inactive/deleted). */
  catalogProductId: string | null;
  /** The vendor listing (existing products.id) — set only when exactly ONE relevant listing exists. */
  listingId: string | null;
  name: string;
  nameAr: string | null;
  imageUrl: string | null;
  brand: string | null;
  pricingUnit: string;
  /** Lowest listing price among the relevant listings. Plain listing price — offers are signalled by `hasOffer`. */
  fromPriceMinor: number;
  storeCount: number;
  hasOffer: boolean;
}

export interface CatalogListing {
  listingId: string;
  vendorBranchId: string;
  vendor: { id: string; name: string; nameAr: string | null; logoUrl: string | null };
  branchName: string;
  isOpen: boolean;
  ratingAverage: number;
  ratingCount: number;
  priceMinor: number;
  pricingUnit: string;
  activeOffer: ActiveOfferSummary | null;
  isAvailable: boolean;
  inventoryMode: string;
  quantity: number | null;
}

/**
 * A listing is "relevant" (public, shown to customers) when it is exactly what the rest of the customer
 * app already treats as browsable: not soft-deleted, `is_available = true` (the same rule search uses;
 * TRACKED quantity 0 stays visible with its inventory exposed), on an ACTIVE branch of an ACTIVE vendor.
 * The service-area filter is the existing one (`ServiceAreaResolverService`), applied only when both
 * coordinates are sent, and "outside every area" is correctly empty — never an unfiltered fallback.
 *
 * Grouping: listings linked to an active catalog product collapse into ONE item keyed by the catalog id;
 * every other listing is its own item keyed by its own id. Nothing here matches by name.
 */
@Injectable()
export class CatalogDiscoveryService {
  constructor(
    @InjectRepository(CatalogProduct) private readonly catalogRepository: Repository<CatalogProduct>,
    @InjectRepository(MarketplaceSector) private readonly sectorsRepository: Repository<MarketplaceSector>,
    private readonly dataSource: DataSource,
    private readonly serviceAreaResolver: ServiceAreaResolverService,
    private readonly offerConsumptionService: OfferConsumptionService,
  ) {}

  // -------------------------------------------------------------- GET /products?sectorId=

  async listBySector(params: {
    sectorId: string;
    // Filters V1 note: deliberately its OWN narrower literal union, not the shared
    // `ProductSortOption` (which gained `'offers'` for the per-branch product list this milestone
    // touches) — this cross-vendor catalog-grouped view is a separate, untouched feature; its own DTO
    // (`ListSectorProductsQueryDto`) already restricts `sort` to exactly this same set.
    sort?: 'highestRated' | 'bestSelling' | 'newest' | 'price_asc' | 'price_desc';
    search?: string;
    page?: number;
    limit?: number;
    latitude?: number;
    longitude?: number;
  }): Promise<{ data: MarketplaceProductItem[]; page: number; limit: number; total: number }> {
    const sector = await this.sectorsRepository.findOne({ where: { id: params.sectorId } });
    if (!sector || !sector.isActive) throw new NotFoundException('Sector not found.');

    const page = resolvePage(params.page);
    const limit = resolveLimit(params.limit);
    const term = normalizedSearchTerm(params.search);

    const area = await this.resolveServiceArea(params.latitude, params.longitude);
    if (area === 'OUTSIDE') return { data: [], page, limit, total: 0 };

    const args: unknown[] = [params.sectorId];
    let filters = 'b.marketplace_sector_id = $1';
    if (area) {
      args.push(area);
      filters += ` AND b.service_area_id = $${args.length}`;
    }
    if (term) {
      args.push(`%${term}%`);
      const t = `$${args.length}`;
      // Linked rows match on the SHARED catalog name, unlinked rows on their own — so a group is never
      // partially counted because one vendor spelled the name differently.
      filters += ` AND CASE WHEN c.id IS NOT NULL THEN (c.name ILIKE ${t} OR c.name_ar ILIKE ${t})
                            ELSE (p.name ILIKE ${t} OR p.name_ar ILIKE ${t}) END`;
    }

    const sort = params.sort ?? 'newest';
    const groupedWhere = sort === 'highestRated' ? `WHERE rating_cnt >= ${Number(HIGHEST_RATED_MINIMUM_RATING_COUNT)}` : '';
    const orderBy = {
      newest: 'sort_created_at DESC, group_id ASC',
      bestSelling: 'sold DESC, group_id ASC',
      highestRated: '(rating_sum::float8 / rating_cnt) DESC, rating_cnt DESC, sort_created_at DESC, group_id ASC',
      price_asc: 'from_price ASC, group_id ASC',
      price_desc: 'from_price DESC, group_id ASC',
    }[sort];

    const cte = `
      WITH eligible AS (
        SELECT p.id AS listing_id, p.price_minor, p.pricing_unit, p.image_url AS listing_image,
               p.name AS listing_name, p.name_ar AS listing_name_ar, p.created_at AS listing_created_at,
               p.rating_count, p.rating_sum_stars, p.delivered_quantity_count, p.delivered_weight_grams_count,
               c.id AS catalog_id, c.name AS c_name, c.name_ar AS c_name_ar, c.image_url AS c_image,
               c.brand AS c_brand, c.created_at AS c_created_at
          ${ELIGIBLE_FROM}
         WHERE ${ELIGIBLE_WHERE} AND ${filters}
      ), grouped AS (
        SELECT catalog_id,
               COALESCE(catalog_id, listing_id) AS group_id,
               COUNT(*)::int AS store_count,
               MIN(price_minor)::bigint AS from_price,
               (array_agg(listing_id ORDER BY price_minor ASC, listing_id ASC))[1] AS first_listing_id,
               COALESCE(MAX(c_name), MAX(listing_name)) AS name,
               COALESCE(MAX(c_name_ar), MAX(listing_name_ar)) AS name_ar,
               COALESCE(MAX(c_image), (array_agg(listing_image ORDER BY price_minor ASC, listing_id ASC)
                                        FILTER (WHERE listing_image IS NOT NULL))[1]) AS image_url,
               MAX(c_brand) AS brand,
               MAX(pricing_unit) AS pricing_unit,
               MAX(COALESCE(c_created_at, listing_created_at)) AS sort_created_at,
               SUM(CASE WHEN pricing_unit = 'WEIGHT' THEN delivered_weight_grams_count
                        ELSE delivered_quantity_count END)::float8 AS sold,
               SUM(rating_sum_stars)::bigint AS rating_sum,
               SUM(rating_count)::bigint AS rating_cnt
          FROM eligible
         GROUP BY catalog_id, COALESCE(catalog_id, listing_id)
      )`;

    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `${cte}
         SELECT * FROM grouped ${groupedWhere}
         ORDER BY ${orderBy}
         LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        args,
      ),
      this.dataSource.query(`${cte} SELECT COUNT(*)::int AS total FROM grouped ${groupedWhere}`, args),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    const groupIds: string[] = rows.map((r: { group_id: string }) => r.group_id);
    const offerGroups = await this.groupsWithOffers(groupIds, params.sectorId, area);

    const data: MarketplaceProductItem[] = rows.map((r: any) => ({
      catalogProductId: r.catalog_id ?? null,
      listingId: Number(r.store_count) === 1 ? r.first_listing_id : null,
      name: r.name,
      nameAr: r.name_ar ?? null,
      imageUrl: r.image_url ?? null,
      brand: r.brand ?? null,
      pricingUnit: r.pricing_unit,
      fromPriceMinor: Number(r.from_price),
      storeCount: Number(r.store_count),
      hasOffer: offerGroups.has(r.group_id),
    }));
    return { data, page, limit, total };
  }

  /**
   * Which of these groups have at least one listing with an active offer? Offers resolve per BRANCH in the
   * existing service, so this is bounded to one call per distinct branch on the page — never per product.
   */
  private async groupsWithOffers(groupIds: string[], sectorId: string, area: string | null): Promise<Set<string>> {
    const result = new Set<string>();
    if (groupIds.length === 0) return result;

    const args: unknown[] = [sectorId, groupIds];
    let areaFilter = '';
    if (area) {
      args.push(area);
      areaFilter = ` AND b.service_area_id = $${args.length}`;
    }
    const listings: Array<{ listing_id: string; vendor_branch_id: string; category_id: string; group_id: string }> =
      await this.dataSource.query(
        `SELECT p.id AS listing_id, p.vendor_branch_id, p.category_id, COALESCE(c.id, p.id) AS group_id
           ${ELIGIBLE_FROM}
          WHERE ${ELIGIBLE_WHERE} AND b.marketplace_sector_id = $1 AND COALESCE(c.id, p.id) = ANY($2::uuid[])${areaFilter}`,
        args,
      );

    const byBranch = new Map<string, typeof listings>();
    for (const l of listings) {
      if (!byBranch.has(l.vendor_branch_id)) byBranch.set(l.vendor_branch_id, []);
      byBranch.get(l.vendor_branch_id)!.push(l);
    }
    await Promise.all(
      [...byBranch].map(async ([vendorBranchId, branchListings]) => {
        const offers = await this.offerConsumptionService.resolveActiveOffersForProducts({
          vendorBranchId,
          products: branchListings.map((l) => ({ productId: l.listing_id, categoryId: l.category_id })),
        });
        for (const l of branchListings) if (offers.has(l.listing_id)) result.add(l.group_id);
      }),
    );
    return result;
  }

  // -------------------------------------------------------------- GET /catalog-products/:id

  async getDetails(id: string, coordinates: { latitude?: number; longitude?: number }) {
    const catalog = await this.catalogRepository.findOne({ where: { id } });
    // Inactive == not public. Same 404 as a missing one, so an inactive id is indistinguishable.
    if (!catalog || !catalog.isActive) throw new NotFoundException('Catalog product not found.');

    const area = await this.resolveServiceArea(coordinates.latitude, coordinates.longitude);
    const listings: CatalogListing[] = area === 'OUTSIDE' ? [] : await this.listingsFor(id, area);

    return {
      id: catalog.id,
      name: catalog.name,
      nameAr: catalog.nameAr ?? null,
      description: catalog.description ?? null,
      descriptionAr: catalog.descriptionAr ?? null,
      imageUrl: catalog.imageUrl ?? null,
      brand: catalog.brand ?? null,
      pricingUnit: catalog.pricingUnit,
      storeCount: listings.length,
      listings,
    };
  }

  private async listingsFor(catalogProductId: string, area: string | null): Promise<CatalogListing[]> {
    const args: unknown[] = [catalogProductId];
    let areaFilter = '';
    if (area) {
      args.push(area);
      areaFilter = ` AND b.service_area_id = $${args.length}`;
    }
    const rows: any[] = await this.dataSource.query(
      `SELECT p.id AS listing_id, p.vendor_branch_id, p.category_id, p.price_minor, p.pricing_unit,
              p.is_available, p.inventory_mode, p.quantity,
              b.name AS branch_name, ${effectiveOpenSql('b')} AS is_open, b.rating_count, b.rating_sum_stars,
              v.id AS vendor_id, v.name AS vendor_name, v.name_ar AS vendor_name_ar, v.logo_url AS vendor_logo_url
         ${ELIGIBLE_FROM}
        WHERE ${ELIGIBLE_WHERE} AND p.catalog_product_id = $1${areaFilter}
        ORDER BY p.price_minor ASC, p.id ASC`,
      args,
    );

    const byBranch = new Map<string, any[]>();
    for (const r of rows) {
      if (!byBranch.has(r.vendor_branch_id)) byBranch.set(r.vendor_branch_id, []);
      byBranch.get(r.vendor_branch_id)!.push(r);
    }
    const offersByListing = new Map<string, ActiveOfferSummary>();
    await Promise.all(
      [...byBranch].map(async ([vendorBranchId, branchRows]) => {
        const offers = await this.offerConsumptionService.resolveActiveOffersForProducts({
          vendorBranchId,
          products: branchRows.map((r) => ({ productId: r.listing_id, categoryId: r.category_id, priceMinor: Number(r.price_minor), pricingUnit: r.pricing_unit })),
        });
        for (const [listingId, offer] of offers) offersByListing.set(listingId, offer);
      }),
    );

    return rows.map((r) => ({
      listingId: r.listing_id,
      vendorBranchId: r.vendor_branch_id,
      vendor: {
        id: r.vendor_id,
        name: r.vendor_name,
        nameAr: r.vendor_name_ar ?? null,
        logoUrl: r.vendor_logo_url ?? null,
      },
      branchName: r.branch_name,
      isOpen: r.is_open,
      ratingAverage: Number(r.rating_count) > 0 ? Number(r.rating_sum_stars) / Number(r.rating_count) : 0,
      ratingCount: Number(r.rating_count),
      priceMinor: Number(r.price_minor),
      pricingUnit: r.pricing_unit,
      activeOffer: offersByListing.get(r.listing_id) ?? null,
      isAvailable: r.is_available,
      inventoryMode: r.inventory_mode,
      quantity: r.quantity === null || r.quantity === undefined ? null : Number(r.quantity),
    }));
  }

  // -------------------------------------------------------------- shared

  /** Both coordinates → the nearest active service area's id, or 'OUTSIDE'; otherwise null (no filtering). */
  private async resolveServiceArea(latitude?: number, longitude?: number): Promise<string | 'OUTSIDE' | null> {
    if (latitude == null || longitude == null) return null;
    const resolved = await this.serviceAreaResolver.resolveForPoint(latitude, longitude);
    return resolved ? resolved.id : 'OUTSIDE';
  }
}

const ELIGIBLE_FROM = `
  FROM products p
  JOIN vendor_branches b ON b.id = p.vendor_branch_id AND b.deleted_at IS NULL
  JOIN vendors v ON v.id = b.vendor_id AND v.deleted_at IS NULL
  LEFT JOIN catalog_products c ON c.id = p.catalog_product_id AND c.is_active = true AND c.deleted_at IS NULL`;

const ELIGIBLE_WHERE = `p.deleted_at IS NULL AND p.is_available = true AND b.is_active = true AND v.is_active = true`;
