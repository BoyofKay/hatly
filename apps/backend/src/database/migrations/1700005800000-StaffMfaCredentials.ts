import { MigrationInterface, QueryRunner } from 'typeorm';

/** TOTP second factor for privileged accounts. ADDITIVE and reversible: one new table; no existing row or column changes. */
export class StaffMfaCredentials1700005800000 implements MigrationInterface {
  name = 'StaffMfaCredentials1700005800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "staff_mfa_credentials" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        "user_id" uuid NOT NULL,
        "secret_encrypted" text NOT NULL,
        "enabled_at" timestamptz,
        "last_used_step" bigint NOT NULL DEFAULT 0,
        "recovery_code_hashes" jsonb NOT NULL DEFAULT '[]',
        CONSTRAINT "PK_staff_mfa_credentials_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_staff_mfa_credentials_user" UNIQUE ("user_id"),
        CONSTRAINT "FK_staff_mfa_credentials_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "staff_mfa_credentials"`);
  }
}
