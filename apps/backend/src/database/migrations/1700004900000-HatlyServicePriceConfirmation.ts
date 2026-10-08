import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hatly Service price confirmation by Hatly operations (M-UX Hatly Service checkout task).
 *
 * A Hatly Service order is created with an explicitly PENDING price (`Order.hasPendingAdHocPricing`, item `actualAmountMinor`
 * NULL). Until now only the Driver (who buys the item) could record the final amount. Operations can now confirm it during
 * preparation through the SAME `ad_hoc_purchase_records` table — one row per item, unique on `order_item_id` — so the existing
 * "a price can never be recorded twice" guarantee and audit trail (who, when, how much) are reused rather than duplicated.
 * The only schema change is allowing the recorder role 'ADMIN'. Additive and reversible (down() refuses to run while ADMIN
 * rows exist, so it can never silently orphan or rewrite confirmed prices).
 */
export class HatlyServicePriceConfirmation1700004900000 implements MigrationInterface {
  name = 'HatlyServicePriceConfirmation1700004900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_purchase_records" DROP CONSTRAINT IF EXISTS "chk_ad_hoc_purchase_record_recorder_role";
      ALTER TABLE "ad_hoc_purchase_records" ADD CONSTRAINT "chk_ad_hoc_purchase_record_recorder_role" CHECK (
        "recorded_by_role" IN ('DRIVER', 'VENDOR', 'ADMIN')
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ n }] = await queryRunner.query(`SELECT count(*)::int AS n FROM "ad_hoc_purchase_records" WHERE "recorded_by_role" = 'ADMIN'`);
    if (n > 0) {
      throw new Error(`Refusing to revert: ${n} price confirmation(s) were recorded by operations. Remove or re-attribute them deliberately first.`);
    }
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_purchase_records" DROP CONSTRAINT IF EXISTS "chk_ad_hoc_purchase_record_recorder_role";
      ALTER TABLE "ad_hoc_purchase_records" ADD CONSTRAINT "chk_ad_hoc_purchase_record_recorder_role" CHECK (
        "recorded_by_role" IN ('DRIVER', 'VENDOR')
      );
    `);
  }
}
