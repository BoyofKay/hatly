import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-sector switch for customer "custom requests" ("لا تجد ما تبحث عنه؟"). ADDITIVE and reversible.
 *
 * `marketplace_sectors.custom_requests_enabled` is NOT NULL DEFAULT false: every existing sector starts OFF. The migration does
 * not guess which sectors are suitable (that is a business decision made by an admin in the dashboard); restaurants therefore
 * stay off, and any sector that should offer the feature is switched on explicitly. No existing row value changes otherwise.
 */
export class SectorCustomRequests1700005500000 implements MigrationInterface {
  name = 'SectorCustomRequests1700005500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "marketplace_sectors" ADD COLUMN "custom_requests_enabled" boolean NOT NULL DEFAULT false`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "marketplace_sectors" DROP COLUMN "custom_requests_enabled"`);
  }
}
