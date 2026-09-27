import { EntityManager } from 'typeorm';

/**
 * Which of these listings are linked to a catalog product that is PUBLIC (active and not soft-deleted)?
 * Returns listingId → catalogProductId. Listings with no link — or linked to an inactive/deleted catalog
 * product — are simply absent, so a public response never exposes an unusable identity and such a listing
 * behaves exactly like an unlinked one. ONE query per page, never per product.
 */
export async function resolvePublicCatalogIds(
  manager: Pick<EntityManager, 'query'>,
  productIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (productIds.length === 0) return result;
  const rows: Array<{ id: string; catalog_id: string }> = await manager.query(
    `SELECT p.id AS id, c.id AS catalog_id
       FROM products p
       JOIN catalog_products c ON c.id = p.catalog_product_id AND c.is_active = true AND c.deleted_at IS NULL
      WHERE p.id = ANY($1::uuid[]) AND p.catalog_product_id IS NOT NULL`,
    [productIds],
  );
  for (const row of rows) result.set(row.id, row.catalog_id);
  return result;
}
