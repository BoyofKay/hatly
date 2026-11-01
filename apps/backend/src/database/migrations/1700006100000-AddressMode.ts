import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Explicit delivery-address method. ADDITIVE and reversible: one NULLABLE column, so every existing address keeps `mode = NULL`
 * (a legacy address, which behaves exactly as before — nothing is rewritten, repriced or deleted) and old app builds that never
 * send a mode keep working. The database also enforces what the service enforces: a GPS address always has both coordinates and no
 * zone; a MANUAL address has a zone and no coordinates.
 */
export class AddressMode1700006100000 implements MigrationInterface {
  name = 'AddressMode1700006100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "addresses"
        ADD COLUMN "mode" varchar(10),
        ADD CONSTRAINT "chk_addresses_mode" CHECK ("mode" IS NULL OR "mode" IN ('GPS', 'MANUAL')),
        ADD CONSTRAINT "chk_addresses_gps_shape" CHECK (
          "mode" IS DISTINCT FROM 'GPS' OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "delivery_zone_id" IS NULL)
        ),
        ADD CONSTRAINT "chk_addresses_manual_shape" CHECK (
          "mode" IS DISTINCT FROM 'MANUAL' OR ("latitude" IS NULL AND "longitude" IS NULL AND "delivery_zone_id" IS NOT NULL)
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "addresses"
        DROP CONSTRAINT IF EXISTS "chk_addresses_manual_shape",
        DROP CONSTRAINT IF EXISTS "chk_addresses_gps_shape",
        DROP CONSTRAINT IF EXISTS "chk_addresses_mode",
        DROP COLUMN IF EXISTS "mode";
    `);
  }
}
