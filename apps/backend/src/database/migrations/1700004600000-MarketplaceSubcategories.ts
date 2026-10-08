import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidated customer-commerce milestone (Part E — Sector
 * Subcategories). Adds a real, Admin-managed Level-1.5 taxonomy
 * WITHIN an existing `MarketplaceSector` (e.g. "Burgers" inside
 * "Restaurants") — completely separate from `ProductCategory`, and
 * layered on top of `marketplace_sectors`/`vendor_branches` without
 * touching either.
 *
 * `vendor_branch_subcategories` is a genuine many-to-many join table
 * — deliberately NOT another single FK column on `vendor_branches`,
 * because a branch is explicitly required to belong to MULTIPLE
 * subcategories (unlike `vendor_branches.marketplace_sector_id`,
 * which stays exactly-one by an earlier, separate, still-honored
 * decision — see `MarketplaceSectors1700001800000` and
 * `SectorsService.assignBranchSector`). Composite primary key on the
 * pair itself makes "already assigned" a natural, race-free unique
 * constraint rather than an application-level check.
 *
 * Also bundles Part F (Marketplace image/asset readiness): adds
 * `marketplace_sectors.image_url` — the one sector-level imagery gap
 * this milestone found (`Vendor.logoUrl`/`Product.imageUrl` already
 * existed; `MarketplaceSubcategory.imageUrl` is created fresh above).
 * Same plain-nullable-URL-column pattern as those, not a new asset
 * pipeline.
 */
export class MarketplaceSubcategories1700004600000 implements MigrationInterface {
  name = 'MarketplaceSubcategories1700004600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_sectors" ADD COLUMN "image_url" varchar(500);

      CREATE TABLE "marketplace_subcategories" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "sector_id" uuid NOT NULL REFERENCES "marketplace_sectors"("id"),
        "name" varchar(100) NOT NULL,
        "name_ar" varchar(100),
        "image_url" varchar(500),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_marketplace_subcategories_sector_id" ON "marketplace_subcategories" ("sector_id");
      CREATE INDEX "idx_marketplace_subcategories_active_sort" ON "marketplace_subcategories" ("sector_id", "is_active", "sort_order");

      CREATE TABLE "vendor_branch_subcategories" (
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "subcategory_id" uuid NOT NULL REFERENCES "marketplace_subcategories"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("vendor_branch_id", "subcategory_id")
      );
      CREATE INDEX "idx_vendor_branch_subcategories_subcategory" ON "vendor_branch_subcategories" ("subcategory_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "vendor_branch_subcategories";
      DROP TABLE IF EXISTS "marketplace_subcategories";
      ALTER TABLE "marketplace_sectors" DROP COLUMN IF EXISTS "image_url";
    `);
  }
}
