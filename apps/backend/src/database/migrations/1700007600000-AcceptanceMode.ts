import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * R12 (decision register 2026-11-06): acceptance mode per vendor branch — AUTO (accepted on the vendor's behalf when the order is placed),
 * VENDOR (the vendor accepts or rejects; the default) or HATLY (Hatly Operations accept or reject for the vendor; the vendor still
 * prepares and marks ready). Backfilled from the old boolean: auto_accept_enabled = true → AUTO, otherwise VENDOR, so nothing changes.
 * `auto_accept_enabled` is kept in step (true exactly when AUTO) so the previous release still reads a correct value on rollback.
 */
export class AcceptanceMode1700007600000 implements MigrationInterface {
  name = 'AcceptanceMode1700007600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" ADD COLUMN "acceptance_mode" varchar(6) NOT NULL DEFAULT 'VENDOR'
        CONSTRAINT "CHK_vendor_branches_acceptance_mode" CHECK ("acceptance_mode" IN ('AUTO','VENDOR','HATLY'));
      UPDATE "vendor_branches" SET "acceptance_mode" = 'AUTO' WHERE "auto_accept_enabled" = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "acceptance_mode"`);
  }
}
