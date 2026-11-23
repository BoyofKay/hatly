import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver app round 2 (owner decision 2026-11-22): "Forgot password?" in the driver app sends a request to Hatly operations (there is no
 * SMS provider yet, so the app cannot verify identity itself). Operations see the request on the Drivers page and set a temporary
 * password, which closes it (or dismiss it). One open request per account. Additive.
 */
export class PasswordResetRequests1700009000000 implements MigrationInterface {
  name = 'PasswordResetRequests1700009000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "password_reset_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "requested_at" timestamptz NOT NULL DEFAULT now(),
        "resolved_at" timestamptz NULL,
        "resolved_by_user_id" uuid NULL REFERENCES "users"("id"),
        "resolution" varchar(12) NULL CHECK ("resolution" IS NULL OR "resolution" IN ('RESET','DISMISSED')),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_password_reset_requests_open" ON "password_reset_requests" ("user_id") WHERE "resolved_at" IS NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "password_reset_requests"`);
  }
}
