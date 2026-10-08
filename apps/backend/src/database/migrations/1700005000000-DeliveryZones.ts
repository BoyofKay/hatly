import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Delivery Zones (PD-009). ADDITIVE and reversible.
 *
 * delivery_zones   A named local delivery area ("بلبيس — أبو نصيب") inside an existing ServiceArea. In V1 the zone IS the
 *                  serviceability boundary and its `delivery_fee_minor` IS the base delivery fee. The optional
 *                  representative coordinates are metadata only (future map work) — never a pricing or containment input,
 *                  so nothing is invented for them: both NULL or both set.
 * addresses        `delivery_zone_id` (nullable: legacy rows keep NULL and are NOT guessed into a zone — checkout asks the
 *                  customer to choose one, `ADDRESS_ZONE_REQUIRED`). The map pin becomes OPTIONAL (a valid address no longer
 *                  needs geocoding), but latitude/longitude stay a pair.
 *
 * No existing row changes value. `down()` refuses to drop the coordinate NOT NULL relaxation while a pin-less address exists
 * rather than inventing coordinates for it.
 */
export class DeliveryZones1700005000000 implements MigrationInterface {
  name = 'DeliveryZones1700005000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "delivery_zones" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "service_area_id" uuid NOT NULL,
        "governorate" varchar(80) NOT NULL,
        "governorate_ar" varchar(80) NOT NULL,
        "city" varchar(80) NOT NULL,
        "city_ar" varchar(80) NOT NULL,
        "name" varchar(150) NOT NULL,
        "name_ar" varchar(150) NOT NULL,
        "delivery_fee_minor" bigint NOT NULL,
        "display_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "representative_latitude" double precision,
        "representative_longitude" double precision,
        CONSTRAINT "PK_delivery_zones_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_delivery_zones_service_area" FOREIGN KEY ("service_area_id") REFERENCES "service_areas"("id"),
        CONSTRAINT "chk_delivery_zones_fee" CHECK ("delivery_fee_minor" >= 0),
        CONSTRAINT "chk_delivery_zones_display_order" CHECK ("display_order" >= 0),
        CONSTRAINT "chk_delivery_zones_names" CHECK (
          length(btrim("name")) > 0 AND length(btrim("name_ar")) > 0 AND length(btrim("city")) > 0
          AND length(btrim("city_ar")) > 0 AND length(btrim("governorate")) > 0 AND length(btrim("governorate_ar")) > 0
        ),
        CONSTRAINT "chk_delivery_zones_representative_point" CHECK (
          ("representative_latitude" IS NULL AND "representative_longitude" IS NULL)
          OR ("representative_latitude" BETWEEN -90 AND 90 AND "representative_longitude" BETWEEN -180 AND 180)
        )
      );
      -- One live zone per name inside a service area (Arabic and Latin names separately), case-insensitively.
      CREATE UNIQUE INDEX "UQ_delivery_zones_area_name_ar" ON "delivery_zones" ("service_area_id", lower("name_ar")) WHERE "deleted_at" IS NULL;
      CREATE UNIQUE INDEX "UQ_delivery_zones_area_name" ON "delivery_zones" ("service_area_id", lower("name")) WHERE "deleted_at" IS NULL;
      CREATE INDEX "IDX_delivery_zones_active_order" ON "delivery_zones" ("is_active", "display_order");

      ALTER TABLE "addresses"
        ADD COLUMN "delivery_zone_id" uuid,
        ADD CONSTRAINT "FK_addresses_delivery_zone" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id");
      CREATE INDEX "IDX_addresses_delivery_zone" ON "addresses" ("delivery_zone_id");

      ALTER TABLE "addresses" ALTER COLUMN "latitude" DROP NOT NULL, ALTER COLUMN "longitude" DROP NOT NULL;
      ALTER TABLE "addresses" ADD CONSTRAINT "chk_addresses_coordinates_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM "addresses" WHERE "latitude" IS NULL`);
    if (count > 0) {
      throw new Error(
        `Cannot revert DeliveryZones: ${count} saved address(es) have no map pin, and the previous schema requires one. ` +
          'Coordinates are never invented — resolve those addresses first.',
      );
    }
    await queryRunner.query(`
      ALTER TABLE "addresses" DROP CONSTRAINT IF EXISTS "chk_addresses_coordinates_pair";
      ALTER TABLE "addresses" ALTER COLUMN "latitude" SET NOT NULL, ALTER COLUMN "longitude" SET NOT NULL;
      DROP INDEX IF EXISTS "IDX_addresses_delivery_zone";
      ALTER TABLE "addresses" DROP CONSTRAINT IF EXISTS "FK_addresses_delivery_zone", DROP COLUMN IF EXISTS "delivery_zone_id";
      DROP TABLE IF EXISTS "delivery_zones";
    `);
  }
}
