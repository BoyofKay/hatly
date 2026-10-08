import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PD-009 — Hatly Service delivery fee = normal delivery fee × HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER. Seeds the APPROVED default
 * (1.5) as configuration data — it is never a constant in pricing code, and an admin changes it through Business Config.
 * Never overwrites a value someone already set. `down()` removes only the seeded row if it still holds the seeded value.
 */
export class HatlyServiceDeliveryFeeMultiplier1700005100000 implements MigrationInterface {
  name = 'HatlyServiceDeliveryFeeMultiplier1700005100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "business_config" ("key", "value", "description")
      VALUES ('HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER', '1.5'::jsonb,
              'Hatly Service delivery fee = normal delivery fee × this multiplier (approved default 1.5).')
      ON CONFLICT ("key") DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "business_config" WHERE "key" = 'HATLY_SERVICE_DELIVERY_FEE_MULTIPLIER' AND "value" = '1.5'::jsonb;
    `);
  }
}
