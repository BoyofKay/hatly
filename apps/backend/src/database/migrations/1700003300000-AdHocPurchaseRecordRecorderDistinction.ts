import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vendor/Driver Deferred Pricing for Custom CATALOG Items. Additive to
 * `ad_hoc_purchase_records` — no other table touched. `recorded_by_driver_id`
 * becomes nullable (a Vendor-priced record has no driver at all).
 * `recorded_by_role` distinguishes the two cases and defaults every
 * EXISTING row to `'DRIVER'` — correct by construction, since every
 * row that already exists was created by the pre-this-chunk Driver-only
 * purchase flow, then made NOT NULL going forward so every future row
 * must state which case it is. `recorded_by_user_id` is nullable and
 * only ever set for a `'VENDOR'` row (the authorized Vendor Staff
 * user's id) — never set alongside `recorded_by_driver_id`.
 */
export class AdHocPurchaseRecordRecorderDistinction1700003300000 implements MigrationInterface {
  name = 'AdHocPurchaseRecordRecorderDistinction1700003300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_purchase_records" ALTER COLUMN "recorded_by_driver_id" DROP NOT NULL;
      ALTER TABLE "ad_hoc_purchase_records" ADD COLUMN "recorded_by_role" varchar(10) NOT NULL DEFAULT 'DRIVER';
      ALTER TABLE "ad_hoc_purchase_records" ALTER COLUMN "recorded_by_role" DROP DEFAULT;
      ALTER TABLE "ad_hoc_purchase_records" ADD COLUMN "recorded_by_user_id" uuid;

      ALTER TABLE "ad_hoc_purchase_records" ADD CONSTRAINT "chk_ad_hoc_purchase_record_recorder_role" CHECK (
        "recorded_by_role" IN ('DRIVER', 'VENDOR')
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_purchase_records" DROP CONSTRAINT IF EXISTS "chk_ad_hoc_purchase_record_recorder_role";
      ALTER TABLE "ad_hoc_purchase_records" DROP COLUMN IF EXISTS "recorded_by_user_id";
      ALTER TABLE "ad_hoc_purchase_records" DROP COLUMN IF EXISTS "recorded_by_role";
      ALTER TABLE "ad_hoc_purchase_records" ALTER COLUMN "recorded_by_driver_id" SET NOT NULL;
    `);
  }
}
