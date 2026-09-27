import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Points -> Wallet Conversion (Chunk D). Additive to
 * `loyalty_points_transactions` — no existing column touched. Mirrors
 * `wallet_transactions.idempotency_key` exactly, EXCEPT nullable here
 * (EARNING/ADMIN_ADJUSTMENT rows never set it — only REDEMPTION rows
 * from Chunk D's conversion operation do), with a PARTIAL unique
 * index (`WHERE idempotency_key IS NOT NULL`) so the many existing
 * null-valued rows from Chunks A/C are completely unaffected. This is
 * the smallest schema change that lets the SAME idempotency key be
 * enforced as unique independently on BOTH ledgers (see
 * WalletTransaction's own existing unique index) for one logical
 * cross-ledger conversion operation.
 */
export class LoyaltyIdempotencyKey1700003100000 implements MigrationInterface {
  name = 'LoyaltyIdempotencyKey1700003100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loyalty_points_transactions" ADD COLUMN "idempotency_key" varchar(255);
      CREATE UNIQUE INDEX "idx_loyalty_points_transactions_idempotency_key"
      ON "loyalty_points_transactions" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_loyalty_points_transactions_idempotency_key";
      ALTER TABLE "loyalty_points_transactions" DROP COLUMN IF EXISTS "idempotency_key";
    `);
  }
}
