import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Checkout + order lifecycle (PD-006). ADDITIVE and reversible: only new columns (all nullable or defaulted), one new
 * table, and constraints that every existing row already satisfies. No existing column is dropped or retyped; legacy
 * values stay valid and are documented in docs/PRODUCT_DECISIONS.md.
 *
 * addresses           structured Egyptian address details + a default flag (at most ONE default per customer)
 * vendor_branches     preparation_time_minutes — the only source of a preparation estimate (null = no estimate)
 * orders              electronic_payment_method, wallet_amount_minor, amount_due_minor (total − wallet), coupon_snapshot,
 *                     checkout_quote_snapshot (the frozen quote), estimated_travel_seconds (from the frozen quote)
 * order_vendor_segments  frozen vendor/branch display snapshot + the preparation estimate that was in force + coupon code
 * order_items         Arabic product-name snapshot
 * offers              coupon_code (an offer with a code applies ONLY when that code is entered)
 * payments            electronic_method
 * order_status_events order status history (timeline). Legacy orders get a best-effort backfill flagged actor_role='LEGACY'.
 */
export class CheckoutOrderLifecycle1700004200000 implements MigrationInterface {
  name = 'CheckoutOrderLifecycle1700004200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "addresses"
        ADD COLUMN "governorate" varchar(80),
        ADD COLUMN "city" varchar(80),
        ADD COLUMN "street" varchar(200),
        ADD COLUMN "building_number" varchar(40),
        ADD COLUMN "floor" varchar(20),
        ADD COLUMN "apartment" varchar(20),
        ADD COLUMN "landmark" varchar(200),
        ADD COLUMN "formatted_address" varchar(500),
        ADD COLUMN "is_default" boolean NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX "UQ_addresses_one_default_per_customer" ON "addresses" ("customer_id")
        WHERE "is_default" = true AND "is_active" = true AND "deleted_at" IS NULL;

      ALTER TABLE "vendor_branches"
        ADD COLUMN "preparation_time_minutes" int,
        ADD CONSTRAINT "chk_vendor_branches_preparation_time" CHECK ("preparation_time_minutes" IS NULL OR "preparation_time_minutes" > 0);

      -- A PICKUP order has no delivery address (nothing is delivered): the snapshot is null for it, and always present for delivery.
      ALTER TABLE "orders" ALTER COLUMN "delivery_address_snapshot" DROP NOT NULL;
      ALTER TABLE "orders"
        ADD COLUMN "electronic_payment_method" varchar(20),
        ADD COLUMN "wallet_amount_minor" bigint NOT NULL DEFAULT 0,
        ADD COLUMN "amount_due_minor" bigint,
        ADD COLUMN "coupon_snapshot" jsonb,
        ADD COLUMN "checkout_quote_snapshot" jsonb,
        ADD COLUMN "estimated_travel_seconds" int,
        ADD CONSTRAINT "chk_orders_electronic_payment_method"
          CHECK ("electronic_payment_method" IS NULL OR "electronic_payment_method" IN ('INSTAPAY','VODAFONE_CASH','ORANGE_CASH','ETISALAT_CASH','WE_PAY')),
        ADD CONSTRAINT "chk_orders_wallet_amount" CHECK ("wallet_amount_minor" >= 0);
      -- Existing orders were paid entirely by their own method: the whole total is still due through it.
      UPDATE "orders" SET "amount_due_minor" = "total_minor";

      ALTER TABLE "order_vendor_segments"
        ADD COLUMN "vendor_name_snapshot" varchar(150),
        ADD COLUMN "branch_name_snapshot" varchar(150),
        ADD COLUMN "branch_address_snapshot" varchar(255),
        ADD COLUMN "preparation_estimate_minutes" int,
        ADD COLUMN "coupon_code_snapshot" varchar(50);
      -- Best-effort history for legacy rows: what the vendor/branch is called today (better than joining live data forever).
      UPDATE "order_vendor_segments" s
        SET "vendor_name_snapshot" = v."name", "branch_name_snapshot" = b."name", "branch_address_snapshot" = b."address"
        FROM "vendor_branches" b JOIN "vendors" v ON v."id" = b."vendor_id"
        WHERE s."vendor_branch_id" = b."id";

      ALTER TABLE "order_items" ADD COLUMN "product_name_ar_snapshot" varchar(200);

      ALTER TABLE "offers" ADD COLUMN "coupon_code" varchar(50);
      CREATE UNIQUE INDEX "UQ_offers_coupon_code" ON "offers" (lower("coupon_code"))
        WHERE "coupon_code" IS NOT NULL AND "deleted_at" IS NULL;

      ALTER TABLE "payments"
        ADD COLUMN "electronic_method" varchar(20),
        ADD CONSTRAINT "chk_payments_electronic_method"
          CHECK ("electronic_method" IS NULL OR "electronic_method" IN ('INSTAPAY','VODAFONE_CASH','ORANGE_CASH','ETISALAT_CASH','WE_PAY'));

      CREATE TABLE "order_status_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "order_id" uuid NOT NULL,
        "from_status" varchar(30),
        "to_status" varchar(30) NOT NULL,
        "actor_role" varchar(30),
        "actor_user_id" uuid,
        CONSTRAINT "PK_order_status_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_status_events_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_status_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      );
      CREATE INDEX "IDX_order_status_events_order" ON "order_status_events" ("order_id", "created_at");
      INSERT INTO "order_status_events" ("order_id", "from_status", "to_status", "actor_role", "created_at")
        SELECT "id", NULL, 'PENDING', 'LEGACY', "created_at" FROM "orders";
      INSERT INTO "order_status_events" ("order_id", "from_status", "to_status", "actor_role", "created_at")
        SELECT "id", 'PENDING', "status"::text, 'LEGACY', "updated_at" FROM "orders" WHERE "status"::text <> 'PENDING';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "order_status_events";
      ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "chk_payments_electronic_method", DROP COLUMN IF EXISTS "electronic_method";
      DROP INDEX IF EXISTS "UQ_offers_coupon_code";
      ALTER TABLE "offers" DROP COLUMN IF EXISTS "coupon_code";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "product_name_ar_snapshot";
      ALTER TABLE "order_vendor_segments"
        DROP COLUMN IF EXISTS "coupon_code_snapshot", DROP COLUMN IF EXISTS "preparation_estimate_minutes",
        DROP COLUMN IF EXISTS "branch_address_snapshot", DROP COLUMN IF EXISTS "branch_name_snapshot", DROP COLUMN IF EXISTS "vendor_name_snapshot";
      UPDATE "orders" SET "delivery_address_snapshot" = '{"line1":"Pickup","latitude":0,"longitude":0}'::jsonb WHERE "delivery_address_snapshot" IS NULL;
      ALTER TABLE "orders" ALTER COLUMN "delivery_address_snapshot" SET NOT NULL;
      ALTER TABLE "orders"
        DROP CONSTRAINT IF EXISTS "chk_orders_wallet_amount", DROP CONSTRAINT IF EXISTS "chk_orders_electronic_payment_method",
        DROP COLUMN IF EXISTS "estimated_travel_seconds", DROP COLUMN IF EXISTS "checkout_quote_snapshot", DROP COLUMN IF EXISTS "coupon_snapshot",
        DROP COLUMN IF EXISTS "amount_due_minor", DROP COLUMN IF EXISTS "wallet_amount_minor", DROP COLUMN IF EXISTS "electronic_payment_method";
      ALTER TABLE "vendor_branches" DROP CONSTRAINT IF EXISTS "chk_vendor_branches_preparation_time", DROP COLUMN IF EXISTS "preparation_time_minutes";
      DROP INDEX IF EXISTS "UQ_addresses_one_default_per_customer";
      ALTER TABLE "addresses"
        DROP COLUMN IF EXISTS "is_default", DROP COLUMN IF EXISTS "formatted_address", DROP COLUMN IF EXISTS "landmark",
        DROP COLUMN IF EXISTS "apartment", DROP COLUMN IF EXISTS "floor", DROP COLUMN IF EXISTS "building_number",
        DROP COLUMN IF EXISTS "street", DROP COLUMN IF EXISTS "city", DROP COLUMN IF EXISTS "governorate";
    `);
  }
}
