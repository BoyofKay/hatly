import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Group 8 (end-to-end HTTP journeys) — real defect found: `POST /admin/vendors`
 * answered HTTP 500 for every valid request, so a Vendor could never be created
 * through the API against a real database.
 *
 * ROOT CAUSE: `vendors.category` was created NOT NULL with no default in the
 * Phase-1 InitialSchema (a free-text placeholder, "FK to VendorCategory in a
 * fuller schema"). Marketplace sectors later became the authoritative
 * classification (`vendor_branches.marketplace_sector_id`, migration
 * 1700001800000) and `AdminVendorsService` deliberately stopped reading or
 * writing `category` ("untouched legacy columns"), but the NOT NULL constraint was
 * never relaxed. The unit tests mock the repository so the insert never
 * reached PostgreSQL; only a real INSERT exposes the mismatch.
 *
 * FIX: make the inert legacy column nullable. Nothing reads it; nothing is
 * dropped or rewritten (existing values are kept as they are), and the column
 * stays available should a future migration decide to remove it deliberately.
 * NULL, rather than a fake default like '' or 'GENERAL', is the honest value for
 * "no legacy category recorded".
 */
export class VendorCategoryLegacyNullable1700003900000 implements MigrationInterface {
  name = 'VendorCategoryLegacyNullable1700003900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendors" ALTER COLUMN "category" DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restoring NOT NULL is only possible while no row is NULL; back-fill with the
    // empty string first so the revert cannot fail on data created after `up`.
    await queryRunner.query(`UPDATE "vendors" SET "category" = '' WHERE "category" IS NULL`);
    await queryRunner.query(`ALTER TABLE "vendors" ALTER COLUMN "category" SET NOT NULL`);
  }
}
