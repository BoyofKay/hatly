import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Offers Final System - Checkout Integration. Additive columns needed
 * for SUBTOTAL_DISCOUNT segment-level historical snapshots and to
 * complete FLASH_SALE's item-level snapshot (special price, which the
 * old offerDiscountType/ValueSnapshot columns can no longer carry
 * since those became SUBTOTAL_DISCOUNT-only in the mechanism split).
 * No existing column touched, no existing data destroyed.
 */
export class OffersCheckoutSnapshots1700002600000 implements MigrationInterface {
  name = 'OffersCheckoutSnapshots1700002600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items" ADD COLUMN "offer_special_price_minor_snapshot" bigint;
      ALTER TABLE "order_items" ADD COLUMN "offer_mechanism_snapshot" varchar(20);

      ALTER TABLE "order_vendor_segments" ADD COLUMN "applied_offer_id" uuid;
      ALTER TABLE "order_vendor_segments" ADD COLUMN "offer_discount_type_snapshot" varchar(10);
      ALTER TABLE "order_vendor_segments" ADD COLUMN "offer_discount_value_snapshot" integer;
      ALTER TABLE "order_vendor_segments" ADD COLUMN "offer_eligible_subtotal_minor_snapshot" bigint;
      ALTER TABLE "order_vendor_segments" ADD COLUMN "offer_discount_amount_minor" bigint;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "offer_discount_amount_minor";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "offer_eligible_subtotal_minor_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "offer_discount_value_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "offer_discount_type_snapshot";
      ALTER TABLE "order_vendor_segments" DROP COLUMN IF EXISTS "applied_offer_id";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "offer_mechanism_snapshot";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "offer_special_price_minor_snapshot";
    `);
  }
}
