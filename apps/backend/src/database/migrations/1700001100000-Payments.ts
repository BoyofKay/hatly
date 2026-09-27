import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manual Transfer payment. Adds `payments` — a durable, auditable
 * record of one order's payment (see Payment entity's own doc
 * comment for exactly why it's not a one-off "manual transfer" table).
 * No BusinessConfig seed values here — MANUAL_TRANSFER_DESTINATION and
 * CUSTOMER_SERVICE_WHATSAPP_NUMBER are deliberately left unset per the
 * confirmed "must not be invented" rule; MANUAL_TRANSFER simply isn't
 * usable until an Admin configures both.
 */
export class Payments1700001100000 implements MigrationInterface {
  name = 'Payments1700001100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "method" varchar(20) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'PENDING',
        "amount_minor" bigint,
        "claimed_at" timestamptz,
        "verified_by_user_id" uuid REFERENCES "users"("id"),
        "verified_at" timestamptz,
        "rejection_reason" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_payments_order" ON "payments" ("order_id");
      CREATE INDEX "idx_payments_status" ON "payments" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
  }
}
