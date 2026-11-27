import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hatly promotions (owner decision 2026-11-27): Hatly-wide or per-store promo CODES and automatic CAMPAIGNS, on the order's items or
 * its delivery fee, with dates, %/fixed/fixed-fee, scope, minimum spend, maximum discount, per-customer / total / budget limits, new
 * customers only, whether it combines with other promotions, and who pays a delivery-fee discount (Hatly or the driver).
 * `promotion_redemptions` is the ledger of uses (one per promotion per order; reversed when the order is cancelled).
 * Orders keep the promotion part separately (it is already inside discount_minor / the charged delivery_fee_minor). Additive.
 */
export class Promotions1700010100000 implements MigrationInterface {
  name = 'Promotions1700010100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "promotions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(150) NOT NULL,
        "name_ar" varchar(150) NULL,
        "kind" varchar(12) NOT NULL CHECK ("kind" IN ('CODE','AUTOMATIC')),
        "code" varchar(40) NULL,
        "target" varchar(16) NOT NULL CHECK ("target" IN ('ITEMS','DELIVERY_FEE')),
        "discount_type" varchar(12) NOT NULL CHECK ("discount_type" IN ('PERCENTAGE','FIXED','FIXED_FEE')),
        "discount_value" bigint NOT NULL CHECK ("discount_value" >= 0),
        "max_discount_minor" bigint NULL CHECK ("max_discount_minor" IS NULL OR "max_discount_minor" > 0),
        "min_subtotal_minor" bigint NULL CHECK ("min_subtotal_minor" IS NULL OR "min_subtotal_minor" >= 0),
        "scope_type" varchar(10) NOT NULL DEFAULT 'ALL' CHECK ("scope_type" IN ('ALL','SECTORS','BRANCHES')),
        "scope_ids" uuid[] NOT NULL DEFAULT '{}',
        "starts_at" timestamptz NOT NULL,
        "ends_at" timestamptz NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "per_customer_limit" int NULL CHECK ("per_customer_limit" IS NULL OR "per_customer_limit" > 0),
        "total_uses_limit" int NULL CHECK ("total_uses_limit" IS NULL OR "total_uses_limit" > 0),
        "budget_cap_minor" bigint NULL CHECK ("budget_cap_minor" IS NULL OR "budget_cap_minor" > 0),
        "new_customers_only" boolean NOT NULL DEFAULT false,
        "stackable" boolean NOT NULL DEFAULT false,
        "fee_bearer" varchar(8) NOT NULL DEFAULT 'HATLY' CHECK ("fee_bearer" IN ('HATLY','DRIVER')),
        "uses_count" int NOT NULL DEFAULT 0,
        "discount_given_minor" bigint NOT NULL DEFAULT 0,
        "created_by_user_id" uuid NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_promotions_code_kind" CHECK (("kind" = 'CODE') = ("code" IS NOT NULL)),
        CONSTRAINT "chk_promotions_dates" CHECK ("ends_at" > "starts_at"),
        CONSTRAINT "chk_promotions_fixed_fee" CHECK ("discount_type" <> 'FIXED_FEE' OR "target" = 'DELIVERY_FEE'),
        CONSTRAINT "chk_promotions_percent" CHECK ("discount_type" <> 'PERCENTAGE' OR ("discount_value" BETWEEN 1 AND 100))
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_promotions_code" ON "promotions" (upper("code")) WHERE "code" IS NOT NULL`);
    await q.query(`CREATE INDEX "idx_promotions_live" ON "promotions" ("kind", "is_active", "ends_at")`);
    await q.query(`
      CREATE TABLE "promotion_redemptions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "promotion_id" uuid NOT NULL REFERENCES "promotions"("id"),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "customer_id" uuid NOT NULL REFERENCES "users"("id"),
        "target" varchar(16) NOT NULL,
        "discount_minor" bigint NOT NULL CHECK ("discount_minor" > 0),
        "fee_bearer" varchar(8) NULL,
        "reversed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_promotion_redemptions_order" UNIQUE ("promotion_id", "order_id")
      )`);
    await q.query(`CREATE INDEX "idx_promotion_redemptions_customer" ON "promotion_redemptions" ("promotion_id", "customer_id") WHERE "reversed_at" IS NULL`);
    await q.query(`CREATE INDEX "idx_promotion_redemptions_order" ON "promotion_redemptions" ("order_id")`);
    await q.query(`ALTER TABLE "orders"
      ADD COLUMN "promotion_discount_minor" bigint NOT NULL DEFAULT 0,
      ADD COLUMN "delivery_fee_discount_minor" bigint NOT NULL DEFAULT 0,
      ADD COLUMN "delivery_fee_discount_bearer" varchar(8) NULL,
      ADD COLUMN "promotion_snapshot" jsonb NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "promotion_discount_minor", DROP COLUMN IF EXISTS "delivery_fee_discount_minor",
      DROP COLUMN IF EXISTS "delivery_fee_discount_bearer", DROP COLUMN IF EXISTS "promotion_snapshot"`);
    await q.query(`DROP TABLE IF EXISTS "promotion_redemptions"`);
    await q.query(`DROP TABLE IF EXISTS "promotions"`);
  }
}
