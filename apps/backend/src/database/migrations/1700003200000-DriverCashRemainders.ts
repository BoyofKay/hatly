import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin-mediated Driver Cash Remainder (Chunk E). New, dedicated
 * table — no existing table touched, no Loyalty/Wallet
 * migration/semantics modified. `remainder_amount_minor` is `bigint`
 * (money, same convention as `wallet_transactions.amount_delta_minor`).
 * No FK constraints on `order_id`/`delivery_id`/`driver_id` — matches
 * this schema's existing convention for financial-adjacent join
 * columns (`offer_consumptions.order_id`, `wallet_transactions.
 * order_id`). Indexes on `order_id` and `driver_id` — the two access
 * patterns actually needed (looking up a remainder by order; a
 * driver's own submission history). No unique index on this table
 * itself — the actual double-credit protection lives on
 * `wallet_transactions.idempotency_key` (already unique, Chunk B),
 * which the approval flow derives deterministically from this row's
 * own id.
 */
export class DriverCashRemainders1700003200000 implements MigrationInterface {
  name = 'DriverCashRemainders1700003200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "driver_cash_remainders" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "delivery_id" uuid NOT NULL,
        "driver_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "remainder_amount_minor" bigint NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'PENDING_REVIEW',
        "submitted_at" timestamptz NOT NULL,
        "reviewed_at" timestamptz,
        "reviewed_by_user_id" uuid,
        "rejection_reason" varchar,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );

      CREATE INDEX "idx_driver_cash_remainders_driver" ON "driver_cash_remainders" ("driver_id");
      -- At most one remainder claim per Order — CONFIRMED, the real
      -- DB-level protection against a Driver double-submitting (a
      -- retried/duplicate request), not only an application-level
      -- "already exists" check. Also serves as the order_id lookup
      -- index, so no separate plain index is needed.
      CREATE UNIQUE INDEX "idx_driver_cash_remainders_order_unique" ON "driver_cash_remainders" ("order_id");

      ALTER TABLE "driver_cash_remainders" ADD CONSTRAINT "chk_driver_cash_remainder_amount_positive" CHECK ("remainder_amount_minor" > 0);
      ALTER TABLE "driver_cash_remainders" ADD CONSTRAINT "chk_driver_cash_remainder_status" CHECK (
        "status" IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "driver_cash_remainders";
    `);
  }
}
