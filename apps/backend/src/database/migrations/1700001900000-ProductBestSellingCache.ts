import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Discovery & Ranking, Best Selling. CONFIRMED business
 * decisions (do not reopen): Best Selling counts TOTAL QUANTITY SOLD
 * from `DELIVERED` orders only, excluding any `CANCELLED` segment.
 * PIECE products count `SUM(OrderItem.quantity)`; WEIGHT products
 * count `SUM(OrderItem.actualWeightGrams)` — never "1 unit" regardless
 * of actual weight (the exact same care Weighted Products itself
 * already established for OrderItem).
 *
 * Two SEPARATE, explicitly-named columns — never one ambiguous
 * "units" field mixing incompatible measures (a WEIGHT product's
 * grams and a PIECE product's piece-count are not the same unit and
 * must never be summed together): `delivered_quantity_count` for
 * PIECE, `delivered_weight_grams_count` for WEIGHT. A given Product is
 * always exactly one pricing unit (frozen at the Product row itself,
 * per the existing PricingUnit enum), so exactly one of these two
 * columns is ever non-zero for any given product — never both.
 *
 * DERIVED/RECOMPUTABLE CACHE — mirrors `VendorBranch.ratingCount`/
 * `ratingSumStars`/`Offer.consumedUnitsCount` exactly: never the
 * authoritative source (historical `Order`/`OrderItem` rows remain
 * that), always rebuildable via
 * `SUM(quantity) FROM order_items WHERE product_id = X AND ...`.
 * Updated exactly once per order, from inside the existing, already
 * exactly-once-guaranteed `ON_THE_WAY -> DELIVERED` transition (see
 * BestSellingCacheService) — no new delivery workflow, no separate
 * idempotency mechanism invented.
 */
export class ProductBestSellingCache1700001900000 implements MigrationInterface {
  name = 'ProductBestSellingCache1700001900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" ADD COLUMN "delivered_quantity_count" bigint NOT NULL DEFAULT 0;
      ALTER TABLE "products" ADD COLUMN "delivered_weight_grams_count" bigint NOT NULL DEFAULT 0;
      CREATE INDEX "idx_products_price_minor" ON "products" ("price_minor");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_products_price_minor";
      ALTER TABLE "products" DROP COLUMN IF EXISTS "delivered_weight_grams_count";
      ALTER TABLE "products" DROP COLUMN IF EXISTS "delivered_quantity_count";
    `);
  }
}
