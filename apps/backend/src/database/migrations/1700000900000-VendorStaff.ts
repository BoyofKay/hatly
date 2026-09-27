import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage A (vendor/driver identity onboarding). Adds `vendor_staff`,
 * linking a User (role VENDOR/VENDOR_MANAGER) to the specific
 * VendorBranch they act on behalf of — this link did not exist
 * anywhere before this migration (confirmed by inspection: Driver
 * already had a proper userId FK, VendorBranch had nothing equivalent
 * for staff). No change to `users` or `drivers` — their existing shape
 * is already sufficient (Driver rows just had no writer until now,
 * added at the application layer in drivers.service.ts, not schema).
 */
export class VendorStaff1700000900000 implements MigrationInterface {
  name = 'VendorStaff1700000900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "vendor_staff" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "vendor_branch_id" uuid NOT NULL REFERENCES "vendor_branches"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_vendor_staff_user" ON "vendor_staff" ("user_id");
      CREATE INDEX "idx_vendor_staff_branch" ON "vendor_staff" ("vendor_branch_id");
      -- One row per (user, branch) — a staff member managing multiple
      -- branches gets multiple rows, but never a duplicate for the
      -- same branch.
      CREATE UNIQUE INDEX "idx_vendor_staff_unique" ON "vendor_staff" ("user_id", "vendor_branch_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_staff"`);
  }
}
