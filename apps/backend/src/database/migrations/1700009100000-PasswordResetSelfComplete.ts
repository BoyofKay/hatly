import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-11-23: "Forgot password?" is request-based for EVERY user type (customer, driver, store staff, Hatly staff). A
 * person above the requester (by staff level / permission) issues a TEMPORARY password on the request; the requester types it, with a new
 * password, on the same screen. The temporary password is stored only as a hash ON THE REQUEST (the account password is untouched until
 * the change succeeds, so the old one keeps working); it expires (60 min) and allows 5 wrong tries. Additive.
 */
export class PasswordResetSelfComplete1700009100000 implements MigrationInterface {
  name = 'PasswordResetSelfComplete1700009100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "password_reset_requests" DROP CONSTRAINT IF EXISTS "password_reset_requests_resolution_check"`);
    await q.query(`ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_resolution_check"
      CHECK ("resolution" IS NULL OR "resolution" IN ('RESET','DISMISSED','COMPLETED','EXPIRED','LOCKED'))`);
    await q.query(`ALTER TABLE "password_reset_requests"
      ADD COLUMN "temp_password_hash" varchar NULL,
      ADD COLUMN "temp_issued_at" timestamptz NULL,
      ADD COLUMN "temp_expires_at" timestamptz NULL,
      ADD COLUMN "temp_issued_by_user_id" uuid NULL REFERENCES "users"("id"),
      ADD COLUMN "failed_attempts" int NOT NULL DEFAULT 0`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "password_reset_requests"
      DROP COLUMN IF EXISTS "temp_password_hash", DROP COLUMN IF EXISTS "temp_issued_at", DROP COLUMN IF EXISTS "temp_expires_at",
      DROP COLUMN IF EXISTS "temp_issued_by_user_id", DROP COLUMN IF EXISTS "failed_attempts"`);
    await q.query(`UPDATE "password_reset_requests" SET "resolution" = 'DISMISSED' WHERE "resolution" IN ('COMPLETED','EXPIRED','LOCKED')`);
    await q.query(`ALTER TABLE "password_reset_requests" DROP CONSTRAINT IF EXISTS "password_reset_requests_resolution_check"`);
    await q.query(`ALTER TABLE "password_reset_requests" ADD CONSTRAINT "password_reset_requests_resolution_check" CHECK ("resolution" IS NULL OR "resolution" IN ('RESET','DISMISSED'))`);
  }
}
