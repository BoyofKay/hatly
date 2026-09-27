import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Failed Delivery Resolution (Chunk 2b). New, dedicated table only —
 * no existing table touched, `Order.status` never altered. Unique
 * `order_id` guarantees exactly one resolution per Order at the DB
 * level — the actual, final concurrency protection alongside the
 * row-lock used during the resolve transaction. The CHECK constraint
 * enforces the outcome/refund-amount invariant at the DB level too,
 * never only in application code.
 */
export class FailedDeliveryResolutions1700003500000 implements MigrationInterface {
  name = 'FailedDeliveryResolutions1700003500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "failed_delivery_resolutions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "outcome" varchar(30) NOT NULL,
        "refund_amount_minor" bigint,
        "driver_review_needed" boolean NOT NULL DEFAULT false,
        "driver_review_notes" varchar,
        "notes" varchar,
        "resolved_by_user_id" uuid NOT NULL,
        "resolved_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );

      CREATE UNIQUE INDEX "idx_failed_delivery_resolutions_order_unique" ON "failed_delivery_resolutions" ("order_id");

      ALTER TABLE "failed_delivery_resolutions" ADD CONSTRAINT "chk_failed_delivery_resolution_outcome" CHECK (
        "outcome" IN ('RESOLVED_NO_REFUND', 'REFUND_CUSTOMER')
      );

      ALTER TABLE "failed_delivery_resolutions" ADD CONSTRAINT "chk_failed_delivery_resolution_refund_amount" CHECK (
        ("outcome" = 'REFUND_CUSTOMER' AND "refund_amount_minor" > 0)
        OR
        ("outcome" = 'RESOLVED_NO_REFUND' AND "refund_amount_minor" IS NULL)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "failed_delivery_resolutions";
    `);
  }
}
