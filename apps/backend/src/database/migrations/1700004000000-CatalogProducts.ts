import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catalog Foundation — a shared marketplace product identity above the existing vendor listings.
 * PURELY ADDITIVE: one new table and one nullable column. No existing row, id, foreign key or index is
 * touched or rewritten, no backfill is needed, and nothing is auto-linked — every existing product keeps
 * `catalog_product_id = NULL` and behaves exactly as before. The migration is reversible (down drops the
 * column, then the table).
 *
 * - `products.catalog_product_id` → `catalog_products.id` ON DELETE SET NULL.
 * - One catalog product at most once per vendor branch: partial UNIQUE (catalog_product_id,
 *   vendor_branch_id) that ignores NULL links and soft-deleted product rows (a deleted listing must not
 *   block a future one).
 * - Barcode/GTIN unique only when present and only among live (not soft-deleted) catalog products.
 * - pricing_unit consistency between a listing and its catalog product is enforced by the application
 *   (like every other business validation in this codebase), not a trigger.
 */
export class CatalogProducts1700004000000 implements MigrationInterface {
  name = 'CatalogProducts1700004000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog_products" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "name" varchar(150) NOT NULL,
        "name_ar" varchar(150),
        "description" text,
        "description_ar" text,
        "image_url" varchar,
        "brand" varchar(100),
        "pricing_unit" varchar(10) NOT NULL,
        "barcode" varchar(50),
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_catalog_products_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_catalog_products_pricing_unit" CHECK ("pricing_unit" IN ('PIECE', 'WEIGHT'))
      );
      CREATE UNIQUE INDEX "UQ_catalog_products_barcode" ON "catalog_products" ("barcode")
        WHERE "barcode" IS NOT NULL AND "deleted_at" IS NULL;

      ALTER TABLE "products" ADD COLUMN "catalog_product_id" uuid;
      ALTER TABLE "products" ADD CONSTRAINT "FK_products_catalog_product"
        FOREIGN KEY ("catalog_product_id") REFERENCES "catalog_products"("id") ON DELETE SET NULL;
      CREATE INDEX "IDX_products_catalog_product_id" ON "products" ("catalog_product_id")
        WHERE "catalog_product_id" IS NOT NULL;
      CREATE UNIQUE INDEX "UQ_products_catalog_product_branch" ON "products" ("catalog_product_id", "vendor_branch_id")
        WHERE "catalog_product_id" IS NOT NULL AND "deleted_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_products_catalog_product_branch";
      DROP INDEX IF EXISTS "IDX_products_catalog_product_id";
      ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "FK_products_catalog_product";
      ALTER TABLE "products" DROP COLUMN IF EXISTS "catalog_product_id";
      DROP TABLE IF EXISTS "catalog_products";
    `);
  }
}
