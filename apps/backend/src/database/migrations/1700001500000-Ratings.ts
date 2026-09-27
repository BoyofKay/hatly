import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Ratings. CONFIRMED business decisions (do not reopen):
 * three independent targets (Vendor/Branch, Driver, Product) — no
 * generic Order rating; 1–5 stars, optional text comment; ratings are
 * immutable (no update/delete path exists anywhere in this codebase
 * for these tables — enforced by the complete absence of any such
 * method, mirroring `ad_hoc_purchase_records`/`order_item_weight_records`);
 * one rating per (customer, eligible interaction), enforced here at
 * the DB level via a unique index per table, not just in application
 * code.
 *
 * THREE SEPARATE TABLES, not one generalized `ratings` table —
 * deliberate choice (see the accompanying report for the full
 * reasoning): each target's natural key is a DIFFERENT column
 * (`order_vendor_segment_id` / `delivery_id` / `order_item_id`) with a
 * different eligibility-lookup shape. A single table would need three
 * mutually-exclusive nullable FK columns (nullable-ID ambiguity — the
 * exact anti-pattern the requirements called out) and three different
 * partial unique indexes, instead of one plain 2-column unique index
 * per table here.
 *
 * `vendor_branch_id` on `product_ratings` (and the rating itself
 * having no direct FK-enforced dependency on the CURRENT state of
 * `products.deleted_at`) is a denormalized snapshot, not a second
 * source of truth — it exists purely so a future "Highest Rated for
 * Vendor X" query never needs to join back through
 * order_items -> order_vendor_segments just to filter by vendor,
 * mirroring the "avoid N+1, but never invent a competing authority"
 * balance already established in Phase F/G (e.g.
 * FinancialEvent.rateSnapshot).
 *
 * `product_id` on `product_ratings` deliberately has NO REFERENCES
 * constraint — mirrors `order_items.product_id`'s own existing
 * convention exactly (see that column's own migration/entity
 * comment): the rating must remain historically understandable even
 * if the live Product row's shape changes, without this table
 * depending on a live FK to it. Every other FK here
 * (order_vendor_segment_id, delivery_id, order_item_id, driver_id,
 * vendor_branch_id, customer_id/user_id) references a row that this
 * codebase never hard-deletes (soft-delete only, per BaseEntity), so
 * a real REFERENCES constraint is safe and appropriate for all of
 * those.
 *
 * Aggregate cache columns added to `vendor_branches` / `drivers` /
 * `products`: `rating_count` + `rating_sum_stars` (NOT a stored
 * average) — average is always `rating_sum_stars / rating_count`,
 * computed on read, never stored pre-divided. This is the literal
 * "derived, recomputable, non-authoritative" cache the requirements
 * call for: trivially rebuildable from `SELECT COUNT(*), SUM(stars)`
 * against the underlying rating rows, and immune to any
 * floating-point rounding drift since only integers are ever stored.
 * `rating_count >= 5` is the (only) approved number gating a future
 * "Highest Rated" query — not implemented in this migration/phase.
 */
export class Ratings1700001500000 implements MigrationInterface {
  name = 'Ratings1700001500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" ADD COLUMN "rating_count" integer NOT NULL DEFAULT 0;
      ALTER TABLE "vendor_branches" ADD COLUMN "rating_sum_stars" integer NOT NULL DEFAULT 0;

      ALTER TABLE "drivers" ADD COLUMN "rating_count" integer NOT NULL DEFAULT 0;
      ALTER TABLE "drivers" ADD COLUMN "rating_sum_stars" integer NOT NULL DEFAULT 0;

      ALTER TABLE "products" ADD COLUMN "rating_count" integer NOT NULL DEFAULT 0;
      ALTER TABLE "products" ADD COLUMN "rating_sum_stars" integer NOT NULL DEFAULT 0;

      CREATE TABLE "vendor_ratings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "order_vendor_segment_id" uuid NOT NULL REFERENCES "order_vendor_segments"("id"),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "stars" smallint NOT NULL,
        "comment" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_vendor_ratings_customer_segment" ON "vendor_ratings" ("customer_id", "order_vendor_segment_id");
      CREATE INDEX "idx_vendor_ratings_branch" ON "vendor_ratings" ("vendor_branch_id");

      CREATE TABLE "driver_ratings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "delivery_id" uuid NOT NULL REFERENCES "deliveries"("id"),
        "driver_id" uuid NOT NULL REFERENCES "drivers"("id"),
        "stars" smallint NOT NULL,
        "comment" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_driver_ratings_customer_delivery" ON "driver_ratings" ("customer_id", "delivery_id");
      CREATE INDEX "idx_driver_ratings_driver" ON "driver_ratings" ("driver_id");

      CREATE TABLE "product_ratings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "order_item_id" uuid NOT NULL REFERENCES "order_items"("id"),
        "product_id" uuid,
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "stars" smallint NOT NULL,
        "comment" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_product_ratings_customer_item" ON "product_ratings" ("customer_id", "order_item_id");
      CREATE INDEX "idx_product_ratings_product" ON "product_ratings" ("product_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "product_ratings";
      DROP TABLE IF EXISTS "driver_ratings";
      DROP TABLE IF EXISTS "vendor_ratings";
      ALTER TABLE "products" DROP COLUMN IF EXISTS "rating_sum_stars";
      ALTER TABLE "products" DROP COLUMN IF EXISTS "rating_count";
      ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rating_sum_stars";
      ALTER TABLE "drivers" DROP COLUMN IF EXISTS "rating_count";
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "rating_sum_stars";
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "rating_count";
    `);
  }
}
