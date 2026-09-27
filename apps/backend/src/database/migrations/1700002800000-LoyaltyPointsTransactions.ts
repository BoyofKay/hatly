import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Loyalty Ledger Foundation (Chunk A). New, dedicated table — no
 * existing table touched. `points_delta` is `integer` (not bigint) —
 * see LoyaltyPointsTransaction's own comment for why. `order_id` has
 * no FK constraint, matching `offer_consumptions.order_id`'s own
 * precedent in this schema. Indexes on `customer_id` (the balance
 * query's primary access pattern) and `order_id` (order-scoped
 * reversal lookups, mirroring the same access pattern already indexed
 * on OfferConsumption) — no other index added without a concrete
 * access pattern to justify it.
 */
export class LoyaltyPointsTransactions1700002800000 implements MigrationInterface {
  name = 'LoyaltyPointsTransactions1700002800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "loyalty_points_transactions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "points_delta" integer NOT NULL,
        "type" varchar(30) NOT NULL,
        "order_id" uuid,
        "reason" varchar,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );

      CREATE INDEX "idx_loyalty_points_transactions_customer" ON "loyalty_points_transactions" ("customer_id");
      CREATE INDEX "idx_loyalty_points_transactions_order" ON "loyalty_points_transactions" ("order_id");

      ALTER TABLE "loyalty_points_transactions" ADD CONSTRAINT "chk_loyalty_points_delta_nonzero" CHECK ("points_delta" <> 0);
      ALTER TABLE "loyalty_points_transactions" ADD CONSTRAINT "chk_loyalty_points_type" CHECK (
        "type" IN ('EARNING', 'EARNING_REVERSED', 'REDEMPTION', 'ADMIN_ADJUSTMENT', 'EXPIRATION')
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "loyalty_points_transactions";
    `);
  }
}
