import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff hierarchy (2026-11-21). Every Hatly staff account below SUPER_ADMIN keeps the ADMIN role (so every existing guard and
 * permission check is unchanged) and gets a `staff_level` that orders who may manage whom:
 *   SUPER_ADMIN (role) > ADMIN > OPS_SUPERVISOR > OPS_TEAM.
 * Existing ADMIN accounts become level ADMIN, which is exactly what they are today. NULL for every non-ADMIN role.
 * Additive and backward compatible; `down` drops the column.
 */
export class StaffLevels1700008200000 implements MigrationInterface {
  name = 'StaffLevels1700008200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "staff_level" varchar(20)`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "chk_users_staff_level" CHECK ("staff_level" IS NULL OR "staff_level" IN ('ADMIN','OPS_SUPERVISOR','OPS_TEAM'))`,
    );
    await queryRunner.query(`UPDATE "users" SET "staff_level" = 'ADMIN' WHERE "role" = 'ADMIN' AND "staff_level" IS NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "chk_users_staff_level"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "staff_level"`);
  }
}
