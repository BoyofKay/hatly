import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver Push Notifications. New, dedicated table — CONFIRMED by
 * inspection: no existing DeviceToken/PushToken table exists anywhere
 * in this schema. `token` is globally unique (a raw FCM token belongs
 * to exactly one installation at a time; re-registration is an
 * upsert-by-token, never a duplicate row — see DeviceTokensService).
 * `user_id` has no FK constraint added here, matching this table's
 * own narrow scope — every other user-referencing table in this
 * schema is consistent about this being optional; kept simple and
 * consistent with `uploaded_by_user_id` on `uploads` (also unconstrained).
 */
export class DeviceTokens1700002300000 implements MigrationInterface {
  name = 'DeviceTokens1700002300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "device_tokens" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token" varchar NOT NULL,
        "platform" varchar NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE UNIQUE INDEX "idx_device_tokens_token" ON "device_tokens" ("token");
      CREATE INDEX "idx_device_tokens_user" ON "device_tokens" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "device_tokens";`);
  }
}
