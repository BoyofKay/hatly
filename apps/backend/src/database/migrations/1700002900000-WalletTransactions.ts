import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer Wallet Ledger Foundation (Chunk B). New, dedicated table —
 * no existing table touched, Loyalty's migration untouched.
 * `amount_delta_minor` is `bigint` (money — see WalletTransaction's
 * own comment for why this differs from Loyalty's `integer`).
 * `idempotency_key` carries a UNIQUE index — the actual, final
 * double-write guard. `order_id` has no FK constraint, matching
 * `offer_consumptions.order_id`'s own precedent. Indexes on
 * `customer_id` (balance query) and `order_id` (order-scoped lookups)
 * — no other index added without a concrete access pattern.
 */
export class WalletTransactions1700002900000 implements MigrationInterface {
  name = 'WalletTransactions1700002900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallet_transactions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "amount_delta_minor" bigint NOT NULL,
        "type" varchar(30) NOT NULL,
        "order_id" uuid,
        "reason" varchar,
        "created_by_user_id" uuid,
        "idempotency_key" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );

      CREATE INDEX "idx_wallet_transactions_customer" ON "wallet_transactions" ("customer_id");
      CREATE INDEX "idx_wallet_transactions_order" ON "wallet_transactions" ("order_id");
      CREATE UNIQUE INDEX "idx_wallet_transactions_idempotency_key" ON "wallet_transactions" ("idempotency_key");

      ALTER TABLE "wallet_transactions" ADD CONSTRAINT "chk_wallet_amount_nonzero" CHECK ("amount_delta_minor" <> 0);
      ALTER TABLE "wallet_transactions" ADD CONSTRAINT "chk_wallet_transaction_type" CHECK (
        "type" IN ('LOYALTY_REDEMPTION', 'ADMIN_CREDIT', 'DRIVER_CASH_REMAINDER', 'ORDER_PAYMENT', 'ORDER_REFUND', 'ADJUSTMENT', 'EXPIRATION')
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "wallet_transactions";
    `);
  }
}
