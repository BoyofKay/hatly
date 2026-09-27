import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer-facing order number (production-readiness slice). ADDITIVE and reversible: a new sequence, a new nullable-then-NOT-NULL
 * column, one unique index. The internal UUID (`orders.id`) stays the primary key and every existing reference to it — this is
 * purely a second, human-friendly, immutable reference for support/communication.
 *
 * Format: `HT-NNNNNN` (at least 6 digits, zero-padded; grows past 6 digits rather than wrapping). The sequence starts at 100001
 * (an offset, not 1) so the number itself never reveals how many orders Hatly has actually processed.
 *
 * Backfill: existing orders get a number generated from the SAME sequence, assigned in `created_at, id` order (a stable,
 * deterministic tie-breaker) so numbers still read as "order age" for old rows, then the column is made NOT NULL and unique.
 * New orders (`OrderCreationService`) draw the next value from the same sequence going forward — no gap, no second generator.
 */
export class OrderNumber1700004300000 implements MigrationInterface {
  name = 'OrderNumber1700004300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE IF NOT EXISTS "order_number_seq" START WITH 100001 INCREMENT BY 1;

      ALTER TABLE "orders" ADD COLUMN "order_number" varchar(20);

      UPDATE "orders" o
      SET "order_number" = 'HT-' || LPAD(nextval('order_number_seq')::text, 6, '0')
      FROM (
        SELECT "id" FROM "orders" ORDER BY "created_at" ASC, "id" ASC
      ) AS ordered
      WHERE o."id" = ordered."id" AND o."order_number" IS NULL;

      ALTER TABLE "orders" ALTER COLUMN "order_number" SET NOT NULL;
      CREATE UNIQUE INDEX "UQ_orders_order_number" ON "orders" ("order_number");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_orders_order_number";
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "order_number";
      DROP SEQUENCE IF EXISTS "order_number_seq";
    `);
  }
}
