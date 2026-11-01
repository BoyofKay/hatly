import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MarketplaceVendorsService, MarketplaceVendorView } from '../sectors/marketplace-vendors.service';
import { SectorsService } from '../sectors/sectors.service';
import { ActiveOfferSummary, OfferConsumptionService } from '../offers/offer-consumption.service';
import { hasActiveOfferForProductSql, PRODUCT_BEST_SELLING_ORDER_SQL } from '../products/products.service';
import { CacheSource, HomeSectionsCache } from './home-sections.cache';
import {
  HOME_PRODUCT_SECTIONS_CONTRACT_VERSION,
  HOME_SECTION_IDS,
  HomeProductSectionsResponse,
  HomeProductView,
  HomeSectionId,
  HomeSectionResult,
} from './home-product-sections.types';

/** Same numbers the Customer app used when it composed Home itself (`home_content_config.dart`) — the section meanings do not change. */
export const HOME_SECTOR_FANOUT = 3;
export const HOME_SOURCE_VENDORS = 6;
export const HOME_PRODUCTS_PER_VENDOR = 3;
export const HOME_MAX_ENTRIES = 10;
export const HOME_NEW_PRODUCT_WINDOW_DAYS = 30;
const OFFER_RESOLUTION_CONCURRENCY = 3;

interface Sources {
  vendors: MarketplaceVendorView[];
}
type OkSection = Extract<HomeSectionResult, { status: 'OK' }>;

export type CacheOutcome = 'HIT' | 'MISS' | 'BYPASS';

interface ProductRow {
  id: string;
  vendor_branch_id: string;
  category_id: string;
  name: string;
  name_ar: string | null;
  description: string | null;
  description_ar: string | null;
  image_url: string | null;
  price_minor: string;
  is_available: boolean;
  pricing_unit: string;
  inventory_mode: string;
  quantity: number | null;
  delivered_quantity_count: string;
  delivered_weight_grams_count: string;
  created_at: Date;
}

const BASE_COLUMNS = `product.id, product.vendor_branch_id, product.category_id, product.name, product.name_ar, product.description,
  product.description_ar, product.image_url, product.price_minor, product.is_available, product.pricing_unit, product.inventory_mode,
  product.quantity, product.delivered_quantity_count, product.delivered_weight_grams_count, product.created_at`;

/**
 * ONE answer to "what do the three Home product rows contain" — replacing the Customer app's own composition (3 vendor-list requests, then
 * 3 sections × 6 vendors = 18 product requests). It keeps the app's definitions exactly (see the constants above):
 *   source vendors  = the first 3 active sectors' vendor lists (the existing vendor listing: active branch + active vendor), ranked by
 *                     rating count, rating, name, at most 6;
 *   per section     = each source vendor's own best 3 AVAILABLE products (most ordered: best-selling order; new: newest first; offers:
 *                     only products with a currently valid offer), then the section's definition decides what qualifies
 *                     (ordered at least once / created in the last 30 days / carries an active offer the checkout would honour),
 *                     interleaved across vendors, de-duplicated, at most 10 for Most ordered and New.
 * The per-vendor top-3 is ONE window-function query per section (not one per vendor); active offers are resolved ONCE per source vendor
 * for the union of the sections' products, with bounded concurrency. Sections are cached separately (HomeSectionsCache), so a section
 * that fails is reported as an ERROR section while the others are still served.
 */
@Injectable()
export class HomeProductSectionsService {
  private readonly logger = new Logger(HomeProductSectionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly sectorsService: SectorsService,
    private readonly marketplaceVendorsService: MarketplaceVendorsService,
    private readonly offerConsumptionService: OfferConsumptionService,
    private readonly cache: HomeSectionsCache,
  ) {}

  async getSections(params: { sections?: HomeSectionId[]; deliveryZoneId?: string } = {}): Promise<{ response: HomeProductSectionsResponse; cache: CacheOutcome }> {
    const requested = HOME_SECTION_IDS.filter((id) => !params.sections || params.sections.includes(id));
    const scopeKey = params.deliveryZoneId ?? 'all';
    const prefix = `home:sections:v${HOME_PRODUCT_SECTIONS_CONTRACT_VERSION}:e${await this.cache.epoch()}:${scopeKey}`;
    const sources: CacheSource[] = [];

    let vendors: MarketplaceVendorView[];
    try {
      const resolved = await this.cache.getOrCompute<Sources>(`${prefix}:sources`, () => this.computeSources(params.deliveryZoneId));
      sources.push(resolved.source);
      vendors = resolved.value.vendors;
    } catch (error) {
      this.logger.error(`Home sources unavailable: ${(error as Error).message}`);
      return { response: this.assemble(params.deliveryZoneId, [], requested.map((id) => this.errorSection(id))), cache: 'MISS' };
    }

    // Learn which sections are not cached; those are computed TOGETHER (one pass shares the offer resolution), each cached on its own.
    const keyOf = (id: HomeSectionId) => `${prefix}:${id}`;
    const peeked = await Promise.all(requested.map((id) => this.cache.peek<HomeSectionResult>(keyOf(id))));
    const missing = requested.filter((_, index) => peeked[index] === null);
    let batch: Promise<Map<HomeSectionId, HomeSectionResult>> | undefined;
    const results = await Promise.all(
      requested.map(async (id): Promise<HomeSectionResult> => {
        try {
          const resolved = await this.cache.getOrCompute<HomeSectionResult>(
            keyOf(id),
            async () => {
              batch ??= this.computeSections(missing.length > 0 ? missing : [id], vendors);
              return (await batch).get(id) ?? this.errorSection(id);
            },
            { cacheable: (value) => value.status === 'OK' },
          );
          sources.push(resolved.source);
          return resolved.value;
        } catch (error) {
          this.logger.error(`Home section ${id} unavailable: ${(error as Error).message}`);
          return this.errorSection(id);
        }
      }),
    );

    const outcome: CacheOutcome = sources.includes('BYPASS') ? 'BYPASS' : sources.every((s) => s === 'CACHE') ? 'HIT' : 'MISS';
    return { response: this.assemble(params.deliveryZoneId, vendors, results), cache: outcome };
  }

  private assemble(zoneId: string | undefined, vendors: MarketplaceVendorView[], sections: HomeSectionResult[]): HomeProductSectionsResponse {
    return {
      contractVersion: HOME_PRODUCT_SECTIONS_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      scope: { deliveryZoneId: zoneId ?? null },
      vendors,
      sections,
    };
  }

  private errorSection(id: HomeSectionId): HomeSectionResult {
    return { id, status: 'ERROR', code: 'SECTION_UNAVAILABLE', products: [] };
  }

  // ---- source vendors --------------------------------------------------------------------------------------------------------------

  private async computeSources(deliveryZoneId?: string): Promise<Sources> {
    const sectors = [...(await this.sectorsService.listActiveForCustomers())]
      .sort((a, b) => a.sortOrder - b.sortOrder || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, HOME_SECTOR_FANOUT);
    const lists = await Promise.all(
      sectors.map((sector) =>
        this.marketplaceVendorsService
          .listBySector(sector.id, deliveryZoneId ? { deliveryZoneId } : {})
          .then((result) => result.data)
          // one sector failing degrades to nothing for that sector, exactly as the app did
          .catch((error) => {
            this.logger.warn(`Home vendor list for sector ${sector.id} failed: ${(error as Error).message}`);
            return [] as MarketplaceVendorView[];
          }),
      ),
    );
    const seen = new Set<string>();
    const unique = lists.flat().filter((v) => seen.add(v.id));
    unique.sort(
      (a, b) =>
        b.ratingCount - a.ratingCount ||
        b.ratingAverage - a.ratingAverage ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    return { vendors: unique.slice(0, HOME_SOURCE_VENDORS) };
  }

  // ---- sections --------------------------------------------------------------------------------------------------------------------

  private async computeSections(ids: HomeSectionId[], vendors: MarketplaceVendorView[]): Promise<Map<HomeSectionId, HomeSectionResult>> {
    const out = new Map<HomeSectionId, HomeSectionResult>();
    const branchIds = vendors.map((v) => v.id);
    if (branchIds.length === 0) {
      for (const id of ids) out.set(id, { id, status: 'OK', products: [] });
      return out;
    }

    // 1. one query per section: every source vendor's top 3
    const perSection = new Map<HomeSectionId, Map<string, ProductRow[]>>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          perSection.set(id, await this.topPerBranch(id, branchIds));
        } catch (error) {
          this.logger.error(`Home section ${id} query failed: ${(error as Error).message}`);
          out.set(id, this.errorSection(id));
        }
      }),
    );

    // 2. active offers, resolved once per vendor for the union of the products of the sections still in play
    const unionByBranch = new Map<string, Map<string, ProductRow>>();
    for (const byBranch of perSection.values()) {
      for (const [branchId, rows] of byBranch) {
        const bucket = unionByBranch.get(branchId) ?? new Map<string, ProductRow>();
        for (const row of rows) bucket.set(row.id, row);
        unionByBranch.set(branchId, bucket);
      }
    }
    const offers = new Map<string, ActiveOfferSummary>();
    try {
      await mapWithConcurrency([...unionByBranch.entries()], OFFER_RESOLUTION_CONCURRENCY, async ([branchId, rows]) => {
        const resolved = await this.offerConsumptionService.resolveActiveOffersForProducts({
          vendorBranchId: branchId,
          products: [...rows.values()].map((r) => ({ productId: r.id, categoryId: r.category_id, priceMinor: Number(r.price_minor), pricingUnit: r.pricing_unit })),
        });
        for (const [productId, offer] of resolved) offers.set(productId, offer);
      });
    } catch (error) {
      this.logger.error(`Home offer resolution failed: ${(error as Error).message}`);
      for (const id of perSection.keys()) out.set(id, this.errorSection(id));
      return out;
    }

    // 3. each section's definition, interleaved over the vendors in ranked order
    const now = Date.now();
    for (const [id, byBranch] of perSection) {
      const lists = branchIds.map((branchId) => (byBranch.get(branchId) ?? []).map((row) => this.toView(row, offers.get(row.id) ?? null)));
      out.set(id, { id, status: 'OK', products: this.compose(lists, id, now) });
    }
    return out;
  }

  /** `ROW_NUMBER() OVER (PARTITION BY branch ...) <= 3` — the same per-vendor listing the app asked for, in one statement. */
  private async topPerBranch(id: HomeSectionId, branchIds: string[]): Promise<Map<string, ProductRow[]>> {
    const orderBy = id === 'MOST_ORDERED' ? `${PRODUCT_BEST_SELLING_ORDER_SQL} DESC, product.id ASC` : 'product.created_at DESC, product.id ASC';
    const offerFilter = id === 'OFFERS' ? `AND ${hasActiveOfferForProductSql()}` : '';
    const rows: Array<ProductRow & { rn: string }> = await this.dataSource.query(
      `SELECT ranked.* FROM (
         SELECT ${BASE_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY product.vendor_branch_id ORDER BY ${orderBy}) AS rn
           FROM products product
          WHERE product.vendor_branch_id = ANY($1::uuid[]) AND product.deleted_at IS NULL AND product.is_available = true ${offerFilter}
       ) ranked
       WHERE ranked.rn <= $2
       ORDER BY ranked.vendor_branch_id, ranked.rn`,
      [branchIds, HOME_PRODUCTS_PER_VENDOR],
    );
    const byBranch = new Map<string, ProductRow[]>();
    for (const row of rows) byBranch.set(row.vendor_branch_id, [...(byBranch.get(row.vendor_branch_id) ?? []), row]);
    return byBranch;
  }

  private compose(perVendor: HomeProductView[][], id: HomeSectionId, now: number): HomeProductView[] {
    const qualifies = (p: HomeProductView): boolean => {
      if (id === 'OFFERS') return p.activeOffer !== null;
      if (id === 'MOST_ORDERED') return p.deliveredQuantityCount > 0 || p.deliveredWeightGramsCount > 0;
      const age = now - new Date(p.createdAt).getTime();
      return age >= 0 && age < HOME_NEW_PRODUCT_WINDOW_DAYS * 24 * 3600_000;
    };
    const max = id === 'OFFERS' ? Infinity : HOME_MAX_ENTRIES;
    const seen = new Set<string>();
    const out: HomeProductView[] = [];
    const longest = perVendor.reduce((m, l) => Math.max(m, l.length), 0);
    for (let i = 0; i < longest && out.length < max; i++) {
      for (const list of perVendor) {
        const product = list[i];
        if (!product || !qualifies(product) || !seen.add(product.id)) continue;
        out.push(product);
        if (out.length >= max) break;
      }
    }
    return out;
  }

  private toView(row: ProductRow, activeOffer: ActiveOfferSummary | null): HomeProductView {
    return {
      id: row.id,
      vendorBranchId: row.vendor_branch_id,
      categoryId: row.category_id,
      name: row.name,
      nameAr: row.name_ar ?? null,
      description: row.description ?? null,
      descriptionAr: row.description_ar ?? null,
      imageUrl: row.image_url ?? null,
      priceMinor: Number(row.price_minor),
      isAvailable: row.is_available,
      pricingUnit: row.pricing_unit,
      inventoryMode: row.inventory_mode,
      quantity: row.quantity ?? null,
      deliveredQuantityCount: Number(row.delivered_quantity_count),
      deliveredWeightGramsCount: Number(row.delivered_weight_grams_count),
      createdAt: new Date(row.created_at).toISOString(),
      activeOffer,
    };
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; rejects with the first failure. */
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export type { OkSection };
