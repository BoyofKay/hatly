import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase G fix. Adds `vendor_branches.auto_accept_enabled` — the one
 * source of truth for per-branch auto-accept, replacing the old
 * global `VENDOR_SEGMENT_AUTO_ACCEPT_ENABLED` BusinessConfig key
 * (that key/row is left in place, not deleted — past migrations are
 * never rewritten — but is no longer read by any code, see
 * OrderCreationService). Defaults to false, preserving the exact
 * prior global default (manual acceptance) for every existing branch.
 */
export class VendorBranchAutoAccept1700001300000 implements MigrationInterface {
  name = 'VendorBranchAutoAccept1700001300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" ADD COLUMN "auto_accept_enabled" boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "auto_accept_enabled";
    `);
  }
}
