import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G — Marketplace Sector Taxonomy. CONFIRMED business decisions
 * (do not reopen): `MarketplaceSector` (Level 1 — "which type of
 * vendor/branch this is, for marketplace browsing") is a completely
 * separate table from `ProductCategory` (Level 2 — "which menu
 * section a branch's own products fall into"), never merged, never a
 * parent/child relationship between them. The sector relationship
 * belongs to `VendorBranch`, never `Vendor` — different branches of
 * the same Vendor may legitimately operate in different sectors — and
 * never `Product` (a Product's sector is always derived via
 * `Product -> VendorBranch -> MarketplaceSector`, never stored
 * directly on Product).
 *
 * `Vendor.category` (the Phase-1 inert free-text column) is
 * DELIBERATELY untouched by this migration — not reused, not
 * reinterpreted, not migrated, not deleted. `marketplace_sector_id` is
 * the new, sole authoritative relationship.
 *
 * GENUINE DATA BLOCKER, reported rather than silently resolved: this
 * repository contains no seed script and no actual Vendor/VendorBranch
 * rows to inspect, so there is no authoritative information anywhere
 * in the ZIP to determine what sector any hypothetical existing
 * production branch should be assigned. Per the explicit instruction
 * to stop rather than invent a classification, `marketplace_sector_id`
 * is added as NULLABLE here, not the eventually-desired NOT NULL —
 * enforcing "exactly one sector" is done at the application/service
 * layer for every NEW VendorBranch sector assignment going forward
 * (see SectorsService.assignBranchSector), while any pre-existing
 * branch a real production database might contain stays NULL until an
 * operator with the actual business context backfills it and a
 * follow-up migration can then safely add the NOT NULL constraint.
 * This is intentionally left NOT NULL-ready but not yet enforced.
 */
export class MarketplaceSectors1700001800000 implements MigrationInterface {
  name = 'MarketplaceSectors1700001800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "marketplace_sectors" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "name_ar" varchar(100),
        "slug" varchar(100) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_marketplace_sectors_slug" ON "marketplace_sectors" ("slug");
      CREATE INDEX "idx_marketplace_sectors_active_sort" ON "marketplace_sectors" ("is_active", "sort_order");

      ALTER TABLE "vendor_branches" ADD COLUMN "marketplace_sector_id" uuid REFERENCES "marketplace_sectors"("id");
      CREATE INDEX "idx_vendor_branches_marketplace_sector" ON "vendor_branches" ("marketplace_sector_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "marketplace_sector_id";
      DROP TABLE IF EXISTS "marketplace_sectors";
    `);
  }
}
