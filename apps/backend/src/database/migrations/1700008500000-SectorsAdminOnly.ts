import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-22: managing marketplace sectors (Home categories, their photos, the custom-request switch) is for ADMIN-level
 * staff and the super admin only. Removes that permission from any operations supervisor / team account that was given it by hand.
 * Not reversible by design (down() does not re-grant).
 */
export class SectorsAdminOnly1700008500000 implements MigrationInterface {
  name = 'SectorsAdminOnly1700008500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "admin_permissions" ap USING "users" u
        WHERE ap."user_id" = u."id" AND ap."permission" = 'MANAGE_MARKETPLACE_SECTORS' AND u."staff_level" IN ('OPS_SUPERVISOR', 'OPS_TEAM')`,
    );
  }

  public async down(): Promise<void> {
    /* intentionally nothing */
  }
}
