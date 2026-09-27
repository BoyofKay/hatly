import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 Step 3 of the approved multi-phase implementation plan:
 * multi-vendor Cart/Order schema. ALTERs the existing `carts`,
 * `cart_items`, `orders`, `order_items`, `vendor_branches` tables
 * (created by earlier migrations) rather than dropping/recreating
 * them — no real data has ever existed in any of these tables in this
 * project (order creation was never built), so this is purely a
 * structural change, not a data migration.
 *
 * Does NOT touch `orders.status`/the `orders_status_enum` type —
 * deliberately unchanged this step, see order-vendor-segment.entity.ts.
 */
export class MultiVendorCartOrderSchema1700000400000 implements MigrationInterface {
  name = 'MultiVendorCartOrderSchema1700000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- vendor_branches: pickup/delivery capability flags ----
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" ADD COLUMN "delivery_enabled" boolean NOT NULL DEFAULT true;
      ALTER TABLE "vendor_branches" ADD COLUMN "pickup_enabled" boolean NOT NULL DEFAULT true;
    `);

    // ---- carts: drop single-branch assumption, add fulfillment/order-note ----
    await queryRunner.query(`
      ALTER TABLE "carts" DROP COLUMN "vendor_branch_id";
      ALTER TABLE "carts" ADD COLUMN "fulfillment_type" varchar(20) NOT NULL DEFAULT 'DELIVERY';
      ALTER TABLE "carts" ADD COLUMN "order_note" varchar;
    `);

    // ---- cart_vendor_groups: the core multi-vendor split (up to 3 per cart, enforced in CartService) ----
    await queryRunner.query(`
      CREATE TABLE "cart_vendor_groups" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "cart_id" uuid NOT NULL REFERENCES "carts"("id") ON DELETE CASCADE,
        "group_type" varchar(20) NOT NULL,
        "vendor_branch_id" uuid REFERENCES "vendor_branches"("id"),
        "ad_hoc_place_name" varchar,
        "vendor_note" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_cart_vendor_groups_cart" ON "cart_vendor_groups" ("cart_id");
    `);

    // ---- cart_items: repoint to groups, allow ad-hoc (no product) items ----
    await queryRunner.query(`
      ALTER TABLE "cart_items" DROP COLUMN "cart_id";
      ALTER TABLE "cart_items" ADD COLUMN "cart_vendor_group_id" uuid NOT NULL
        REFERENCES "cart_vendor_groups"("id") ON DELETE CASCADE;
      CREATE INDEX "idx_cart_items_group" ON "cart_items" ("cart_vendor_group_id");

      ALTER TABLE "cart_items" ALTER COLUMN "product_id" DROP NOT NULL;
      ALTER TABLE "cart_items" ADD COLUMN "free_text_description" varchar;
      ALTER TABLE "cart_items" ADD COLUMN "image_urls" jsonb;
    `);

    // ---- orders: drop single-branch assumption, add fulfillment/order-note ----
    // orders.status / orders_status_enum intentionally untouched.
    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN "vendor_branch_id";
      ALTER TABLE "orders" ADD COLUMN "fulfillment_type" varchar(20) NOT NULL DEFAULT 'DELIVERY';
      ALTER TABLE "orders" ADD COLUMN "order_note" varchar;
    `);

    // ---- order_vendor_segments: order-side mirror of cart_vendor_groups ----
    await queryRunner.query(`
      CREATE TABLE "order_vendor_segments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "group_type" varchar(20) NOT NULL,
        "vendor_branch_id" uuid REFERENCES "vendor_branches"("id"),
        "ad_hoc_place_name_snapshot" varchar,
        "vendor_note_snapshot" varchar,
        "status" varchar(20) NOT NULL DEFAULT 'PENDING',
        "subtotal_minor" bigint,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_order_vendor_segments_order" ON "order_vendor_segments" ("order_id");
      CREATE INDEX "idx_order_vendor_segments_status" ON "order_vendor_segments" ("status");
    `);

    // ---- order_items: repoint to segments, allow ad-hoc snapshot fields ----
    await queryRunner.query(`
      ALTER TABLE "order_items" DROP COLUMN "order_id";
      ALTER TABLE "order_items" ADD COLUMN "order_vendor_segment_id" uuid NOT NULL
        REFERENCES "order_vendor_segments"("id") ON DELETE CASCADE;
      CREATE INDEX "idx_order_items_segment" ON "order_items" ("order_vendor_segment_id");

      ALTER TABLE "order_items" ALTER COLUMN "product_id" DROP NOT NULL;
      ALTER TABLE "order_items" ALTER COLUMN "product_name_snapshot" DROP NOT NULL;
      ALTER TABLE "order_items" ALTER COLUMN "unit_price_minor" DROP NOT NULL;
      ALTER TABLE "order_items" ADD COLUMN "free_text_description_snapshot" varchar;
      ALTER TABLE "order_items" ADD COLUMN "image_urls_snapshot" jsonb;
    `);

    // ---- uploads: backs the "imageUrls must be real Hatly uploads" enforcement ----
    await queryRunner.query(`
      CREATE TABLE "uploads" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "url" varchar NOT NULL,
        "uploaded_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_uploads_url" ON "uploads" ("url");
      CREATE INDEX "idx_uploads_user" ON "uploads" ("uploaded_by_user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "uploads"`);

    await queryRunner.query(`
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "image_urls_snapshot";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "free_text_description_snapshot";
      ALTER TABLE "order_items" ALTER COLUMN "unit_price_minor" SET NOT NULL;
      ALTER TABLE "order_items" ALTER COLUMN "product_name_snapshot" SET NOT NULL;
      ALTER TABLE "order_items" ALTER COLUMN "product_id" SET NOT NULL;
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "order_vendor_segment_id";
      ALTER TABLE "order_items" ADD COLUMN "order_id" uuid;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "order_vendor_segments"`);

    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "order_note";
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "fulfillment_type";
      ALTER TABLE "orders" ADD COLUMN "vendor_branch_id" uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "image_urls";
      ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "free_text_description";
      ALTER TABLE "cart_items" ALTER COLUMN "product_id" SET NOT NULL;
      ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "cart_vendor_group_id";
      ALTER TABLE "cart_items" ADD COLUMN "cart_id" uuid;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "cart_vendor_groups"`);

    await queryRunner.query(`
      ALTER TABLE "carts" DROP COLUMN IF EXISTS "order_note";
      ALTER TABLE "carts" DROP COLUMN IF EXISTS "fulfillment_type";
      ALTER TABLE "carts" ADD COLUMN "vendor_branch_id" uuid;
    `);

    await queryRunner.query(`
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "pickup_enabled";
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "delivery_enabled";
    `);
  }
}
