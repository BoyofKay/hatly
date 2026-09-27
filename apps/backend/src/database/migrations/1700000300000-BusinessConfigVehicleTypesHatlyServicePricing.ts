import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 of the approved multi-phase implementation plan:
 * BusinessConfig + VehicleType + HatlyServicePricingConfig
 * infrastructure. No dispatch thresholds, vehicle capacity numbers,
 * or pricing formulas are seeded — those remain open business
 * decisions (see the Phase 2 report). The ONE seeded value is the
 * confirmed Automatic Dispatch master switch, defaulted to enabled
 * (normal operation), since the switch itself — unlike its
 * downstream thresholds — was explicitly approved this phase.
 */
export class BusinessConfigVehicleTypesHatlyServicePricing1700000300000
  implements MigrationInterface
{
  name = 'BusinessConfigVehicleTypesHatlyServicePricing1700000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "business_config" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "key" varchar(100) NOT NULL,
        "value" jsonb NOT NULL,
        "description" varchar,
        "updated_by_user_id" uuid REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_business_config_key" ON "business_config" ("key");
    `);

    // The one confirmed seed value this phase — see this file's own
    // top comment for why nothing else is seeded.
    await queryRunner.query(`
      INSERT INTO "business_config" ("key", "value", "description")
      VALUES (
        'AUTOMATIC_DISPATCH_ENABLED',
        'true'::jsonb,
        'Global master switch. false = automatic dispatch stops auto-assigning; orders go to manual Admin assignment/reassignment instead.'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "vehicle_types" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar(100) NOT NULL,
        "name_ar" varchar(100),
        "max_active_deliveries" int NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "hatly_service_pricing_config" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "config" jsonb,
        "is_active" boolean NOT NULL DEFAULT false,
        "updated_by_user_id" uuid REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "hatly_service_pricing_config"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vehicle_types"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "business_config"`);
  }
}
