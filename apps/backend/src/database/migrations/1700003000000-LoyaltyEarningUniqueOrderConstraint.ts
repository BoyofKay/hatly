import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Loyalty Earning (Chunk C). Additive to `loyalty_points_transactions`
 * — no existing column touched. A PARTIAL unique index
 * (`WHERE type = 'EARNING'`) guarantees an Order can never earn twice
 * at the database level, while deliberately NOT making `order_id`
 * globally unique — CONFIRMED per the approved design: future
 * transaction types (e.g. `EARNING_REVERSED`, which by design
 * references the SAME orderId as the original EARNING row it
 * compensates) must remain free to coexist for the same order. This
 * is the actual, final protection against a retried/concurrent
 * DELIVERED transition — never only the application-level check
 * inside `LoyaltyService.awardOrderEarning`.
 */
export class LoyaltyEarningUniqueOrderConstraint1700003000000 implements MigrationInterface {
  name = 'LoyaltyEarningUniqueOrderConstraint1700003000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_loyalty_points_transactions_earning_order"
      ON "loyalty_points_transactions" ("order_id")
      WHERE "type" = 'EARNING';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_loyalty_points_transactions_earning_order";
    `);
  }
}
