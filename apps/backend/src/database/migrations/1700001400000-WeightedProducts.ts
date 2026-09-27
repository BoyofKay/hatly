import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Weighted Products. CONFIRMED business decisions (do not
 * reopen): a Product is either PIECE or WEIGHT; weight is always
 * integer GRAMS, never floating-point kilograms; the existing integer
 * `quantity` column on cart_items/order_items is NEVER overloaded to
 * mean grams — a WEIGHT item gets its own, separate
 * `requested_weight_grams` / `actual_weight_grams` columns.
 *
 * `order_item_weight_records` mirrors `ad_hoc_purchase_records`
 * exactly (see that table's own migration/entity): one PERMANENT row
 * per OrderItem, DB-level unique on `order_item_id` — the real
 * enforcement behind "first authorized actor (Vendor OR Driver) to
 * record wins; no second operational recording is ever allowed."
 * Exactly one of `recorded_by_user_id` (a VendorStaff-linked User) /
 * `recorded_by_driver_id` is ever populated — enforced in
 * OrderItemWeightRecordService, application-level, matching this
 * project's existing convention for nullable-XOR business rules
 * (Postgres CHECK constraints spanning nullable XOR logic have not
 * been used elsewhere in this schema).
 *
 * CONFIRMED business decision: ADMIN plays no role in weight or
 * weighted-price entry/correction at all — there is deliberately no
 * correction/override table here. An earlier draft of this migration
 * included one (`order_item_weight_corrections`); it was removed
 * before this migration was ever applied anywhere, per that decision
 * — not left in place as dead schema.
 */
export class WeightedProducts1700001400000 implements MigrationInterface {
  name = 'WeightedProducts1700001400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" ADD COLUMN "pricing_unit" varchar(10) NOT NULL DEFAULT 'PIECE';

      ALTER TABLE "cart_items" ADD COLUMN "requested_weight_grams" integer;

      ALTER TABLE "order_items" ADD COLUMN "pricing_unit_snapshot" varchar(10);
      ALTER TABLE "order_items" ADD COLUMN "requested_weight_grams" integer;
      ALTER TABLE "order_items" ADD COLUMN "actual_weight_grams" integer;
      ALTER TABLE "order_items" ADD COLUMN "estimated_amount_minor" bigint;
      ALTER TABLE "order_items" ADD COLUMN "final_amount_minor" bigint;

      CREATE TABLE "order_item_weight_records" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_item_id" uuid NOT NULL REFERENCES "order_items"("id"),
        "weight_grams" integer NOT NULL,
        "recorded_by_user_id" uuid REFERENCES "users"("id"),
        "recorded_by_driver_id" uuid REFERENCES "drivers"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_order_item_weight_records_item" ON "order_item_weight_records" ("order_item_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "order_item_weight_records";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "final_amount_minor";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "estimated_amount_minor";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "actual_weight_grams";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "requested_weight_grams";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "pricing_unit_snapshot";
      ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "requested_weight_grams";
      ALTER TABLE "products" DROP COLUMN IF EXISTS "pricing_unit";
    `);
  }
}
