import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Courier shift closing and vendor period closing (2026-11-13) — R25–R30, R32, R35, R43; owner decisions of 2026-11-13:
 *  (1) electronic / InstaPay / wallet orders: Hatly owes the courier the goods value he paid the store AND the delivery fee, the courier owes
 *      Hatly's % of the fee; (2) COD: the goods are collected from the customer and paid to the store (pass-through, excluded from the net);
 *      the courier keeps the delivery-fee cash, so he owes Hatly only its commission; (3) wallet parts and approved "change to wallet" follow
 *      the same facts; (4) a courier closing covers everything since his previous closing (register default).
 *  Every money part is its own column (R31) — see courier-settlement-math.ts.
 *
 * Additive only — no existing amount is rewritten:
 *  - `driver_settlement_periods` / `vendor_settlement_periods`: a human REFERENCE (unique), a METHOD version (1 = the earlier
 *    event-window formula, kept as stored for any period closed before this release; 2 = order/segment lines below), and the separate
 *    totals R30/R31 require (never combined in one amount).
 *  - `driver_settlement_period_orders`: one row per delivered order a courier closing settled — `order_id` UNIQUE, so the same order can
 *    never be settled twice (also under concurrent closes).
 *  - `vendor_settlement_period_lines`: one row per vendor part (segment) a vendor closing covered — `segment_id` UNIQUE, so a segment of a
 *    multi-vendor order is settled once, under its own vendor only.
 * Existing rows receive a LEGACY reference and method 1; their stored totals are left exactly as they are.
 */
export class SettlementClosingLines1700007900000 implements MigrationInterface {
  name = 'SettlementClosingLines1700007900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "driver_settlement_periods"
        ADD COLUMN "reference" varchar(40),
        ADD COLUMN "method_version" smallint NOT NULL DEFAULT 1,
        ADD COLUMN "fee_entitlement_minor" bigint,
        ADD COLUMN "courier_compensation_minor" bigint,
        ADD COLUMN "goods_paid_to_stores_minor" bigint,
        ADD COLUMN "goods_pass_through_minor" bigint,
        ADD COLUMN "goods_reimbursement_minor" bigint,
        ADD COLUMN "cash_collected_minor" bigint,
        ADD COLUMN "cash_held_minor" bigint,
        ADD COLUMN "change_kept_minor" bigint,
        ADD COLUMN "collected_by_hatly_minor" bigint,
        ADD COLUMN "orders_count" int,
        ADD COLUMN "unresolved_count" int;
      UPDATE "driver_settlement_periods" SET "reference" = 'LEGACY-' || upper(left(replace(id::text, '-', ''), 10)) WHERE "reference" IS NULL;
      ALTER TABLE "driver_settlement_periods" ALTER COLUMN "reference" SET DEFAULT ('CS-' || upper(left(replace(uuid_generate_v4()::text, '-', ''), 12)));
      ALTER TABLE "driver_settlement_periods" ALTER COLUMN "reference" SET NOT NULL;
      ALTER TABLE "driver_settlement_periods" ADD CONSTRAINT "UQ_driver_settlement_periods_reference" UNIQUE ("reference");

      ALTER TABLE "vendor_settlement_periods"
        ADD COLUMN "reference" varchar(40),
        ADD COLUMN "method_version" smallint NOT NULL DEFAULT 1,
        ADD COLUMN "orders_count" int,
        ADD COLUMN "rate_undefined_count" int;
      UPDATE "vendor_settlement_periods" SET "reference" = 'LEGACY-' || upper(left(replace(id::text, '-', ''), 10)) WHERE "reference" IS NULL;
      ALTER TABLE "vendor_settlement_periods" ALTER COLUMN "reference" SET DEFAULT ('VS-' || upper(left(replace(uuid_generate_v4()::text, '-', ''), 12)));
      ALTER TABLE "vendor_settlement_periods" ALTER COLUMN "reference" SET NOT NULL;
      ALTER TABLE "vendor_settlement_periods" ADD CONSTRAINT "UQ_vendor_settlement_periods_reference" UNIQUE ("reference");

      CREATE TABLE "driver_settlement_period_orders" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "period_id" uuid NOT NULL REFERENCES "driver_settlement_periods"("id"),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "delivery_id" uuid REFERENCES "deliveries"("id"),
        "commission_event_id" uuid REFERENCES "financial_events"("id"),
        "payment_method" varchar(30) NOT NULL,
        "payment_flow" varchar(12) NOT NULL CHECK ("payment_flow" IN ('COD','ELECTRONIC')),
        "delivered_at" timestamptz,
        "fee_entitlement_minor" bigint NOT NULL,
        "commission_minor" bigint NOT NULL,
        "courier_compensation_minor" bigint NOT NULL,
        "goods_paid_to_stores_minor" bigint NOT NULL,
        "goods_pass_through_minor" bigint NOT NULL,
        "goods_reimbursement_minor" bigint NOT NULL,
        "cash_collected_minor" bigint NOT NULL,
        "cash_held_minor" bigint NOT NULL,
        "change_kept_minor" bigint NOT NULL,
        "collected_by_hatly_minor" bigint NOT NULL,
        "net_to_courier_minor" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_driver_settlement_period_orders_order" UNIQUE ("order_id")
      );
      CREATE INDEX "IDX_driver_settlement_period_orders_period" ON "driver_settlement_period_orders" ("period_id");

      CREATE TABLE "vendor_settlement_period_lines" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "period_id" uuid NOT NULL REFERENCES "vendor_settlement_periods"("id"),
        "segment_id" uuid NOT NULL REFERENCES "order_vendor_segments"("id"),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "commission_event_id" uuid REFERENCES "financial_events"("id"),
        "handed_over_at" timestamptz NOT NULL,
        "fulfillment_type" varchar(20) NOT NULL,
        "segment_subtotal_minor" bigint NOT NULL,
        "commission_minor" bigint,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_vendor_settlement_period_lines_segment" UNIQUE ("segment_id")
      );
      CREATE INDEX "IDX_vendor_settlement_period_lines_period" ON "vendor_settlement_period_lines" ("period_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "vendor_settlement_period_lines";
      DROP TABLE IF EXISTS "driver_settlement_period_orders";
      ALTER TABLE "vendor_settlement_periods" DROP CONSTRAINT IF EXISTS "UQ_vendor_settlement_periods_reference",
        DROP COLUMN IF EXISTS "rate_undefined_count", DROP COLUMN IF EXISTS "orders_count", DROP COLUMN IF EXISTS "method_version", DROP COLUMN IF EXISTS "reference";
      ALTER TABLE "driver_settlement_periods" DROP CONSTRAINT IF EXISTS "UQ_driver_settlement_periods_reference",
        DROP COLUMN IF EXISTS "unresolved_count", DROP COLUMN IF EXISTS "orders_count", DROP COLUMN IF EXISTS "collected_by_hatly_minor",
        DROP COLUMN IF EXISTS "change_kept_minor", DROP COLUMN IF EXISTS "cash_held_minor", DROP COLUMN IF EXISTS "cash_collected_minor",
        DROP COLUMN IF EXISTS "goods_reimbursement_minor", DROP COLUMN IF EXISTS "goods_pass_through_minor", DROP COLUMN IF EXISTS "courier_compensation_minor",
        DROP COLUMN IF EXISTS "goods_paid_to_stores_minor", DROP COLUMN IF EXISTS "fee_entitlement_minor",
        DROP COLUMN IF EXISTS "method_version", DROP COLUMN IF EXISTS "reference";
    `);
  }
}
