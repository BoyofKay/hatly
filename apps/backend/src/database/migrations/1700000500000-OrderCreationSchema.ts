import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 Step 4 of the approved multi-phase implementation plan:
 * Order Creation + Cancellation. ALTERs `orders`/`order_vendor_segments`/
 * `order_items` (created by earlier migrations, still with zero real
 * rows — order creation has never existed until this step), adds the
 * new `ad_hoc_purchase_records` table, and seeds the two new
 * BusinessConfig keys this step introduces.
 *
 * Does NOT touch `orders_status_enum`/the state-machine's transition
 * table shape at the DB level — the Step 4 cancellation fix
 * (removing CUSTOMER from one transition rule) is application code
 * only, not a schema change.
 */
export class OrderCreationSchema1700000500000 implements MigrationInterface {
  name = 'OrderCreationSchema1700000500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- orders: nullable money fields + explicit pending-pricing flag ----
    await queryRunner.query(`
      ALTER TABLE "orders" ALTER COLUMN "delivery_fee_minor" DROP NOT NULL;
      ALTER TABLE "orders" ALTER COLUMN "total_minor" DROP NOT NULL;
      ALTER TABLE "orders" ADD COLUMN "has_pending_ad_hoc_pricing" boolean NOT NULL DEFAULT false;
    `);

    // ---- order_vendor_segments: dispatch lead-time dependency (schema only) ----
    await queryRunner.query(`
      ALTER TABLE "order_vendor_segments" ADD COLUMN "expected_ready_at" timestamptz;
    `);

    // ---- order_items: read-cache for the driver-recorded actual amount ----
    await queryRunner.query(`
      ALTER TABLE "order_items" ADD COLUMN "actual_amount_minor" bigint;
    `);

    // ---- ad_hoc_purchase_records: the real, immutable source of truth ----
    await queryRunner.query(`
      CREATE TABLE "ad_hoc_purchase_records" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_item_id" uuid NOT NULL REFERENCES "order_items"("id"),
        "amount_minor" bigint NOT NULL,
        "recorded_by_driver_id" uuid NOT NULL REFERENCES "drivers"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      -- One purchase record per order item, ever — the actual
      -- enforcement of "driver cannot overwrite/edit it", not just an
      -- application-level check (see AdHocPurchaseRecordService).
      CREATE UNIQUE INDEX "idx_ad_hoc_purchase_records_item" ON "ad_hoc_purchase_records" ("order_item_id");
    `);

    // ---- BusinessConfig seeds for this step's two new keys ----
    await queryRunner.query(`
      INSERT INTO "business_config" ("key", "value", "description") VALUES
      (
        'MULTI_VENDOR_ORDERS_ENABLED',
        'true'::jsonb,
        'Operational safety switch. false = order creation rejects any cart with more than one vendor group; existing multi-vendor carts/orders are unaffected.'
      ),
      (
        'DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES',
        '5'::jsonb,
        'Minutes before an OrderVendorSegment.expectedReadyAt that the future Dispatch engine may consider that segment assignment-eligible. Not read by anything yet.'
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "business_config" WHERE "key" IN ('MULTI_VENDOR_ORDERS_ENABLED', 'DISPATCH_ASSIGNMENT_LEAD_TIME_MINUTES');
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "ad_hoc_purchase_records"`);

    await queryRunner.query(`
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "actual_amount_minor";
    `);

    await queryRunner.query(`
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "expected_ready_at";
    `);

    await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "has_pending_ad_hoc_pricing";
      ALTER TABLE "orders" ALTER COLUMN "total_minor" SET NOT NULL;
      ALTER TABLE "orders" ALTER COLUMN "delivery_fee_minor" SET NOT NULL;
    `);
  }
}
