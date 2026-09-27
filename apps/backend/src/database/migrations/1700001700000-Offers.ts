import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Offers & Promotions. CONFIRMED business decisions (do not
 * reopen): exactly two discount types (PERCENTAGE / FIXED), each
 * Offer uses exactly one — represented as ONE `discount_value` column
 * whose meaning depends on `discount_type` (basis points for
 * PERCENTAGE, minor units for FIXED), not two nullable-XOR columns —
 * simpler than the design review's draft, and still a single, always-
 * populated value per Offer (CHECK constraints enforce validity).
 * Every Offer is scoped to exactly one VendorBranch, always required.
 * `start_at`/`end_at` both required — no indefinite Offers. The four
 * limits are independent, nullable = unlimited for THAT dimension.
 *
 * `offer_products`/`offer_categories` are separate join tables per
 * the approved design (never a generic polymorphic target table) —
 * live FK to `products`/`product_categories` is appropriate here
 * (unlike historical snapshot tables) because Offer targeting reflects
 * CURRENT catalog state, and neither Products nor ProductCategories
 * are ever hard-deleted (soft-delete only), so the FK is always safe.
 *
 * `offer_consumptions` is the append-only ledger — unique on
 * `order_item_id` ALONE (not `(offer_id, order_item_id)`): CONFIRMED
 * "only ONE Offer may apply to a given OrderItem" (no stacking) means
 * an OrderItem can have AT MOST ONE consumption row ever, by
 * construction — exactly mirroring `order_item_weight_records`' own
 * unique-on-`order_item_id` precedent. This is also the DB-level
 * idempotency guarantee (decision Q): a retried order-creation attempt
 * can never double-consume the same OrderItem's offer, with no
 * client-supplied idempotency key needed (none exists anywhere else
 * in this codebase either — see OrderCreationService's own comment).
 *
 * `offers.consumed_units_count` / `consumed_discount_minor` are
 * DERIVED CACHES (mirrors `vendor_branches.rating_count`/
 * `rating_sum_stars` exactly) — always rebuildable from
 * `SELECT COUNT/SUM ... FROM offer_consumptions WHERE offer_id = X`,
 * never the authoritative source. They exist purely so a hot read
 * (allocation/budget remaining) never needs to scan the ledger table.
 */
export class Offers1700001700000 implements MigrationInterface {
  name = 'Offers1700001700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "offers" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "name" varchar(150) NOT NULL,
        "discount_type" varchar(10) NOT NULL,
        "discount_value" integer NOT NULL,
        "start_at" timestamptz NOT NULL,
        "end_at" timestamptz NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "per_order_limit" integer,
        "per_customer_lifetime_limit" integer,
        "total_allocation_limit" integer,
        "budget_cap_minor" bigint,
        "consumed_units_count" integer NOT NULL DEFAULT 0,
        "consumed_discount_minor" bigint NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "chk_offers_discount_type" CHECK ("discount_type" IN ('PERCENTAGE', 'FIXED')),
        CONSTRAINT "chk_offers_discount_value_positive" CHECK ("discount_value" > 0),
        CONSTRAINT "chk_offers_percentage_bounds" CHECK ("discount_type" <> 'PERCENTAGE' OR "discount_value" <= 10000),
        CONSTRAINT "chk_offers_validity_window" CHECK ("end_at" > "start_at"),
        CONSTRAINT "chk_offers_per_order_limit_positive" CHECK ("per_order_limit" IS NULL OR "per_order_limit" > 0),
        CONSTRAINT "chk_offers_lifetime_limit_positive" CHECK ("per_customer_lifetime_limit" IS NULL OR "per_customer_lifetime_limit" > 0),
        CONSTRAINT "chk_offers_allocation_limit_positive" CHECK ("total_allocation_limit" IS NULL OR "total_allocation_limit" > 0),
        CONSTRAINT "chk_offers_budget_cap_positive" CHECK ("budget_cap_minor" IS NULL OR "budget_cap_minor" > 0)
      );
      CREATE INDEX "idx_offers_vendor_branch" ON "offers" ("vendor_branch_id");
      CREATE INDEX "idx_offers_active_validity" ON "offers" ("is_active", "start_at", "end_at");

      CREATE TABLE "offer_products" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "offer_id" uuid NOT NULL REFERENCES "offers"("id"),
        "product_id" uuid NOT NULL REFERENCES "products"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_offer_products_unique" ON "offer_products" ("offer_id", "product_id");
      CREATE INDEX "idx_offer_products_product" ON "offer_products" ("product_id");

      CREATE TABLE "offer_categories" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "offer_id" uuid NOT NULL REFERENCES "offers"("id"),
        "product_category_id" uuid NOT NULL REFERENCES "product_categories"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_offer_categories_unique" ON "offer_categories" ("offer_id", "product_category_id");
      CREATE INDEX "idx_offer_categories_category" ON "offer_categories" ("product_category_id");

      CREATE TABLE "offer_consumptions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "offer_id" uuid NOT NULL REFERENCES "offers"("id"),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "order_item_id" uuid NOT NULL REFERENCES "order_items"("id"),
        "quantity_consumed" integer NOT NULL,
        "discount_applied_minor" bigint NOT NULL,
        "discount_type_snapshot" varchar(10) NOT NULL,
        "discount_value_snapshot" integer NOT NULL,
        "original_unit_price_minor_snapshot" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "chk_offer_consumptions_quantity_positive" CHECK ("quantity_consumed" > 0),
        CONSTRAINT "chk_offer_consumptions_discount_non_negative" CHECK ("discount_applied_minor" >= 0)
      );
      CREATE UNIQUE INDEX "idx_offer_consumptions_item" ON "offer_consumptions" ("order_item_id");
      CREATE INDEX "idx_offer_consumptions_offer" ON "offer_consumptions" ("offer_id");
      CREATE INDEX "idx_offer_consumptions_customer" ON "offer_consumptions" ("customer_id");
      CREATE INDEX "idx_offer_consumptions_offer_customer" ON "offer_consumptions" ("offer_id", "customer_id");
      CREATE INDEX "idx_offer_consumptions_order" ON "offer_consumptions" ("order_id");

      ALTER TABLE "order_items" ADD COLUMN "applied_offer_id" uuid;
      ALTER TABLE "order_items" ADD COLUMN "offer_discounted_quantity" integer;
      ALTER TABLE "order_items" ADD COLUMN "offer_discount_type_snapshot" varchar(10);
      ALTER TABLE "order_items" ADD COLUMN "offer_discount_value_snapshot" integer;
      ALTER TABLE "order_items" ADD COLUMN "offer_discount_amount_minor" bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "offer_discount_amount_minor";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "offer_discount_value_snapshot";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "offer_discount_type_snapshot";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "offer_discounted_quantity";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "applied_offer_id";
      DROP TABLE IF EXISTS "offer_consumptions";
      DROP TABLE IF EXISTS "offer_categories";
      DROP TABLE IF EXISTS "offer_products";
      DROP TABLE IF EXISTS "offers";
    `);
  }
}
