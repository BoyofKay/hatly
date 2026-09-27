import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 of the approved multi-phase implementation plan: the
 * permission system. Adds exactly one table — permissions themselves
 * are a fixed enum in application code (Permission), not a DB-driven
 * catalog (see permission.enum.ts's own doc comment for why), so only
 * the *grants* need a table.
 */
export class AdminPermissions1700000200000 implements MigrationInterface {
  name = 'AdminPermissions1700000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_permissions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "permission" varchar(64) NOT NULL,
        "granted_by_user_id" uuid REFERENCES "users"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_admin_permissions_user" ON "admin_permissions" ("user_id");
      -- One grant per (user, permission) — the actual enforcement of
      -- PermissionsService.grant()'s idempotency guarantee, same
      -- pattern as the Phase 1 carts.customer_id partial unique index.
      CREATE UNIQUE INDEX "idx_admin_permissions_unique" ON "admin_permissions" ("user_id", "permission");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_permissions"`);
  }
}
