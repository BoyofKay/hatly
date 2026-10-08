/**
 * CONFIRMED business decisions (Discovery & Ranking) — shared by both
 * `MarketplaceVendorsService` and `ProductsService` so the two query
 * paths never drift on these values.
 */

/** Below this length, search is not executed — return the normal unsearched result instead of an expensive query. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/** Same page/limit convention already established by CustomerOrdersService — not a new pagination style. */
export const DISCOVERY_DEFAULT_PAGE = 1;
export const DISCOVERY_DEFAULT_LIMIT = 20;
export const DISCOVERY_MAX_LIMIT = 50;

/** `'offers'` (Filters V1) added to both — see `MarketplaceVendorsService`/`ProductsService` for the real, EXISTS-backed ordering this uses (never a fabricated/arbitrary "offer strength" ranking). */
export type VendorSortOption = 'highestRated' | 'newest' | 'offers';
export type ProductSortOption = 'highestRated' | 'bestSelling' | 'newest' | 'price_asc' | 'price_desc' | 'offers';

export function resolvePage(page?: number): number {
  return page && page > 0 ? page : DISCOVERY_DEFAULT_PAGE;
}

export function resolveLimit(limit?: number): number {
  return limit && limit > 0 ? Math.min(limit, DISCOVERY_MAX_LIMIT) : DISCOVERY_DEFAULT_LIMIT;
}

/** `null`/empty/too-short search terms are treated identically: "no search applied." */
export function normalizedSearchTerm(search?: string): string | null {
  const trimmed = search?.trim();
  if (!trimmed || trimmed.length < MIN_SEARCH_QUERY_LENGTH) return null;
  return trimmed;
}
