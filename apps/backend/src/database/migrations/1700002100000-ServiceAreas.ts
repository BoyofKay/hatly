import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase I-B — Multi-City / Service Area. CONFIRMED business decisions
 * (do not reopen): center-point + radius zone model, no City entity,
 * no PostGIS/geometry dependency. `vendor_branches.service_area_id`
 * already existed as a plain, unconstrained uuid column (confirmed by
 * inspection — accepted at branch creation since Phase I-A Chunk 1,
 * but never actually referenced a real table). This migration adds
 * the real table and the real FK constraint — deliberately does NOT
 * touch the column's existing nullability: this repository has no
 * seed data and no real deployed rows (confirmed by inspection — no
 * seed script exists anywhere), so there is nothing to migrate/backfill,
 * but the column stays nullable regardless, matching the explicit
 * instruction not to fabricate a default ServiceArea for any
 * hypothetical existing row.
 */
export class ServiceAreas1700002100000 implements MigrationInterface {
  name = 'ServiceAreas1700002100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "service_areas" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(150) NOT NULL,
        "name_ar" varchar(150),
        "center_latitude" double precision NOT NULL,
        "center_longitude" double precision NOT NULL,
        "radius_meters" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_service_areas_active" ON "service_areas" ("is_active");

      ALTER TABLE "vendor_branches"
        ADD CONSTRAINT "fk_vendor_branches_service_area"
        FOREIGN KEY ("service_area_id") REFERENCES "service_areas"("id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" DROP CONSTRAINT IF EXISTS "fk_vendor_branches_service_area";
      DROP TABLE IF EXISTS "service_areas";
    `);
  }
}
