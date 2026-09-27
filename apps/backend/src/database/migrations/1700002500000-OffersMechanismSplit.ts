import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Offers — Final System (two mechanisms). CONFIRMED per the approved
 * design: ONE Offers system, not a second Promotions table set.
 * Additive to the existing `offers` table from Offers1700001700000 —
 * no existing table dropped, no existing data destroyed.
 *
 * `mechanism` discriminates the two calculation paths going forward.
 * Backfill: every pre-existing row becomes `FLASH_SALE` — CONFIRMED
 * reasoning: the existing per-unit quantity/allocation/budget-cap
 * machinery (`per_order_limit`/`per_customer_lifetime_limit`/
 * `total_allocation_limit`/`budget_cap_minor`/`consumed_units_count`)
 * is EXACTLY what FLASH_SALE keeps using unchanged (see
 * OfferConsumptionService's own updated comment) — this is the
 * closest-continuity backfill, not an arbitrary default. No real rows
 * exist in this environment to migrate in practice.
 *
 * `discount_type`/`discount_value` become NULLABLE — CONFIRMED not a
 * rename (per the explicit instruction not to rename existing
 * fields unnecessarily) — they remain exactly what they were, now
 * used ONLY for SUBTOTAL_DISCOUNT (percentage/fixed off ELIGIBLE
 * SUBTOTAL, a different semantic scope than their original "off unit
 * price" meaning, governed entirely by `mechanism` — never touched
 * for FLASH_SALE rows going forward).
 *
 * `special_price_minor` is FLASH_SALE-only (a replacement price, not
 * a discount amount — genuinely new, no existing column fit this).
 * `minimum_eligible_subtotal_minor`/`maximum_discount_minor` are
 * SUBTOTAL_DISCOUNT-only.
 *
 * CHECK constraints enforce mechanism/field consistency at the DB
 * level too, as defense in depth alongside DTO/service validation.
 */
export class OffersMechanismSplit1700002500000 implements MigrationInterface {
  name = 'OffersMechanismSplit1700002500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offers" ADD COLUMN "mechanism" varchar(20) NOT NULL DEFAULT 'FLASH_SALE';
      ALTER TABLE "offers" ADD COLUMN "special_price_minor" bigint;
      ALTER TABLE "offers" ADD COLUMN "minimum_eligible_subtotal_minor" bigint;
      ALTER TABLE "offers" ADD COLUMN "maximum_discount_minor" bigint;

      ALTER TABLE "offers" ALTER COLUMN "discount_type" DROP NOT NULL;
      ALTER TABLE "offers" ALTER COLUMN "discount_value" DROP NOT NULL;

      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_discount_value_positive";
      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_discount_value_positive" CHECK ("discount_value" IS NULL OR "discount_value" > 0);

      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_mechanism" CHECK ("mechanism" IN ('SUBTOTAL_DISCOUNT', 'FLASH_SALE'));
      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_special_price_positive" CHECK ("special_price_minor" IS NULL OR "special_price_minor" > 0);
      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_min_subtotal_positive" CHECK ("minimum_eligible_subtotal_minor" IS NULL OR "minimum_eligible_subtotal_minor" > 0);
      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_max_discount_positive" CHECK ("maximum_discount_minor" IS NULL OR "maximum_discount_minor" > 0);

      -- Cross-field consistency: SUBTOTAL_DISCOUNT requires discount_type/value and must not carry a special price;
      -- FLASH_SALE requires a special price and must not carry a subtotal discount type/value.
      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_mechanism_fields" CHECK (
        ("mechanism" = 'SUBTOTAL_DISCOUNT' AND "discount_type" IS NOT NULL AND "discount_value" IS NOT NULL AND "special_price_minor" IS NULL)
        OR
        ("mechanism" = 'FLASH_SALE' AND "special_price_minor" IS NOT NULL AND "discount_type" IS NULL AND "discount_value" IS NULL)
      );

      CREATE INDEX "idx_offers_mechanism" ON "offers" ("mechanism");

      -- OfferConsumption: extended for the two mechanisms.
      -- 'order_vendor_segment_id' is the SUBTOTAL_DISCOUNT consumption
      -- unit (one discount applies to a whole segment, not one item) —
      -- 'order_item_id' remains the FLASH_SALE unit, unchanged.
      -- Exactly one of the two is populated per row, discriminated by
      -- 'mechanism_snapshot'. 'discount_type_snapshot'/
      -- 'discount_value_snapshot' become nullable (SUBTOTAL_DISCOUNT
      -- only); 'special_price_minor_snapshot' is FLASH_SALE-only.
      ALTER TABLE "offer_consumptions" ADD COLUMN "mechanism_snapshot" varchar(20) NOT NULL DEFAULT 'FLASH_SALE';
      ALTER TABLE "offer_consumptions" ADD COLUMN "order_vendor_segment_id" uuid REFERENCES "order_vendor_segments"("id");
      ALTER TABLE "offer_consumptions" ADD COLUMN "special_price_minor_snapshot" bigint;
      ALTER TABLE "offer_consumptions" ADD COLUMN "eligible_subtotal_minor_snapshot" bigint;

      ALTER TABLE "offer_consumptions" ALTER COLUMN "order_item_id" DROP NOT NULL;
      ALTER TABLE "offer_consumptions" ALTER COLUMN "discount_type_snapshot" DROP NOT NULL;
      ALTER TABLE "offer_consumptions" ALTER COLUMN "discount_value_snapshot" DROP NOT NULL;
      ALTER TABLE "offer_consumptions" ALTER COLUMN "original_unit_price_minor_snapshot" DROP NOT NULL;

      DROP INDEX IF EXISTS "idx_offer_consumptions_item";
      -- Partial unique indexes: each mechanism's own consumption unit
      -- keeps its own "at most once" guarantee — the FLASH_SALE
      -- per-item guarantee is unchanged from before this migration;
      -- SUBTOTAL_DISCOUNT gets the equivalent per-segment guarantee.
      CREATE UNIQUE INDEX "idx_offer_consumptions_item" ON "offer_consumptions" ("order_item_id") WHERE "order_item_id" IS NOT NULL;
      CREATE UNIQUE INDEX "idx_offer_consumptions_segment" ON "offer_consumptions" ("order_vendor_segment_id") WHERE "order_vendor_segment_id" IS NOT NULL;

      ALTER TABLE "offer_consumptions" ADD CONSTRAINT "chk_offer_consumptions_mechanism" CHECK ("mechanism_snapshot" IN ('SUBTOTAL_DISCOUNT', 'FLASH_SALE'));
      ALTER TABLE "offer_consumptions" ADD CONSTRAINT "chk_offer_consumptions_unit" CHECK (
        ("mechanism_snapshot" = 'FLASH_SALE' AND "order_item_id" IS NOT NULL AND "order_vendor_segment_id" IS NULL)
        OR
        ("mechanism_snapshot" = 'SUBTOTAL_DISCOUNT' AND "order_vendor_segment_id" IS NOT NULL AND "order_item_id" IS NULL)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offer_consumptions" DROP CONSTRAINT IF EXISTS "chk_offer_consumptions_unit";
      ALTER TABLE "offer_consumptions" DROP CONSTRAINT IF EXISTS "chk_offer_consumptions_mechanism";
      DROP INDEX IF EXISTS "idx_offer_consumptions_segment";
      DROP INDEX IF EXISTS "idx_offer_consumptions_item";
      CREATE UNIQUE INDEX "idx_offer_consumptions_item" ON "offer_consumptions" ("order_item_id");
      ALTER TABLE "offer_consumptions" ALTER COLUMN "original_unit_price_minor_snapshot" SET NOT NULL;
      ALTER TABLE "offer_consumptions" ALTER COLUMN "discount_value_snapshot" SET NOT NULL;
      ALTER TABLE "offer_consumptions" ALTER COLUMN "discount_type_snapshot" SET NOT NULL;
      ALTER TABLE "offer_consumptions" ALTER COLUMN "order_item_id" SET NOT NULL;
      ALTER TABLE "offer_consumptions" DROP COLUMN IF EXISTS "eligible_subtotal_minor_snapshot";
      ALTER TABLE "offer_consumptions" DROP COLUMN IF EXISTS "special_price_minor_snapshot";
      ALTER TABLE "offer_consumptions" DROP COLUMN IF EXISTS "order_vendor_segment_id";
      ALTER TABLE "offer_consumptions" DROP COLUMN IF EXISTS "mechanism_snapshot";

      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_mechanism_fields";
      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_max_discount_positive";
      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_min_subtotal_positive";
      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_special_price_positive";
      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_mechanism";
      ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "chk_offers_discount_value_positive";
      ALTER TABLE "offers" ADD CONSTRAINT "chk_offers_discount_value_positive" CHECK ("discount_value" > 0);
      ALTER TABLE "offers" ALTER COLUMN "discount_value" SET NOT NULL;
      ALTER TABLE "offers" ALTER COLUMN "discount_type" SET NOT NULL;
      DROP INDEX IF EXISTS "idx_offers_mechanism";
      ALTER TABLE "offers" DROP COLUMN IF EXISTS "maximum_discount_minor";
      ALTER TABLE "offers" DROP COLUMN IF EXISTS "minimum_eligible_subtotal_minor";
      ALTER TABLE "offers" DROP COLUMN IF EXISTS "special_price_minor";
      ALTER TABLE "offers" DROP COLUMN IF EXISTS "mechanism";
    `);
  }
}
