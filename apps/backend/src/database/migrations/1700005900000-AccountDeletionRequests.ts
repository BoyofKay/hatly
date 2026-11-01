import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Account-deletion compliance: requests made from the public web page WITHOUT signing in (Google Play requires a way to ask for deletion
 * without the app). ADDITIVE and reversible: one new table, nothing existing is altered. At most ONE pending request per phone number
 * (partial unique index), so the public form cannot be used to flood the review queue for a number.
 */
export class AccountDeletionRequests1700005900000 implements MigrationInterface {
  name = 'AccountDeletionRequests1700005900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account_deletion_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "phone" varchar(20) NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'PENDING',
        "resolved_at" timestamptz,
        "resolved_by_user_id" uuid,
        "verification_method" varchar(40),
        "rejection_reason" varchar(40),
        CONSTRAINT "PK_account_deletion_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_account_deletion_requests_resolver" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id"),
        CONSTRAINT "chk_account_deletion_requests_status" CHECK ("status" IN ('PENDING', 'COMPLETED', 'REJECTED')),
        CONSTRAINT "chk_account_deletion_requests_resolution" CHECK (
          ("status" = 'PENDING' AND "resolved_at" IS NULL AND "verification_method" IS NULL AND "rejection_reason" IS NULL)
          OR ("status" = 'COMPLETED' AND "resolved_at" IS NOT NULL AND "verification_method" IS NOT NULL AND "rejection_reason" IS NULL)
          OR ("status" = 'REJECTED' AND "resolved_at" IS NOT NULL AND "rejection_reason" IS NOT NULL AND "verification_method" IS NULL)
        )
      );
      CREATE INDEX "IDX_account_deletion_requests_status_created" ON "account_deletion_requests" ("status", "created_at");
      CREATE UNIQUE INDEX "UQ_account_deletion_requests_pending_phone" ON "account_deletion_requests" ("phone") WHERE "status" = 'PENDING';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "account_deletion_requests"`);
  }
}
