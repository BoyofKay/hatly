import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-23: a password set by Hatly staff (reset for a customer, driver, store staff member or staff account) is
 * TEMPORARY — after signing in with it the person must choose a new one before anything else. Cleared by any own password change.
 */
export class MustChangePassword1700008800000 implements MigrationInterface {
  name = 'MustChangePassword1700008800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password"`);
  }
}
