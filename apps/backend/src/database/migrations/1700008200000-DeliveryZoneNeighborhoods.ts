import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Second-level delivery geography (Zone -> Neighborhood/Village).
 *
 * Backward-compatible: each existing delivery_zones row keeps its id, bilingual
 * labels, fee, active state, and links from addresses/orders. Existing rows get
 * NULL parent labels and are explicitly flagged for review in Admin; nothing
 * is translated, split, renamed, deactivated, or reassigned automatically.
 *
 * Every NEW row represents exactly ONE named neighborhood/village with its own
 * base delivery fee. A parent zone is identified by its bilingual zoneName pair
 * and service area; same-parent children may be created independently.
 */
export class DeliveryZoneNeighborhoods1700008200000 implements MigrationInterface {
  name = 'DeliveryZoneNeighborhoods1700008200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_zones"
        ADD COLUMN "zone_name" varchar(150),
        ADD COLUMN "zone_name_ar" varchar(150),
        ADD COLUMN "is_selectable" boolean NOT NULL DEFAULT true;
      ALTER TABLE "delivery_zones" ADD CONSTRAINT "chk_delivery_zones_parent_pair"
        CHECK (
          ("zone_name" IS NULL AND "zone_name_ar" IS NULL)
          OR ("zone_name" IS NOT NULL AND "zone_name_ar" IS NOT NULL
            AND length(btrim("zone_name")) > 0 AND length(btrim("zone_name_ar")) > 0)
        );
      -- Existing names were unique for the entire service area. Scope uniqueness
      -- to a bilingual parent so different zones can contain the same village name.
      DROP INDEX IF EXISTS "UQ_delivery_zones_area_name_ar";
      DROP INDEX IF EXISTS "UQ_delivery_zones_area_name";
      CREATE UNIQUE INDEX "UQ_delivery_zones_area_name_ar"
        ON "delivery_zones" ("service_area_id", lower(coalesce("zone_name_ar", '')), lower("name_ar"))
        WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX "UQ_delivery_zones_area_name"
        ON "delivery_zones" ("service_area_id", lower(coalesce("zone_name", '')), lower("name"))
        WHERE "deleted_at" IS NULL;
      CREATE INDEX "IDX_delivery_zones_parent" ON "delivery_zones"
        ("service_area_id", "zone_name_ar", "display_order")
        WHERE "deleted_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Removing these columns would erase delivery-zone hierarchy entered after
    // this migration. Refuse data loss rather than silently destroying it.
    const [{ count }] = await queryRunner.query(
      `SELECT count(*)::int AS count FROM "delivery_zones" WHERE "zone_name" IS NOT NULL OR "is_selectable" IS NOT TRUE`,
    );
    if (Number(count) > 0) throw new Error('Cannot roll back: delivery-zone parent names exist; export and migrate them first.');
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_delivery_zones_parent";
      DROP INDEX IF EXISTS "UQ_delivery_zones_area_name_ar";
      DROP INDEX IF EXISTS "UQ_delivery_zones_area_name";
      CREATE UNIQUE INDEX "UQ_delivery_zones_area_name_ar"
        ON "delivery_zones" ("service_area_id", lower("name_ar")) WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX "UQ_delivery_zones_area_name"
        ON "delivery_zones" ("service_area_id", lower("name")) WHERE "deleted_at" IS NULL;
      ALTER TABLE "delivery_zones" DROP CONSTRAINT IF EXISTS "chk_delivery_zones_parent_pair";
      ALTER TABLE "delivery_zones" DROP COLUMN IF EXISTS "zone_name_ar", DROP COLUMN IF EXISTS "zone_name", DROP COLUMN IF EXISTS "is_selectable";
    `);
  }
}
