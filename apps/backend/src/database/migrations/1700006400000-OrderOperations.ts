import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Order operations: who did what to a vendor segment, what the dispatcher tried, and whether a Manual Transfer refund was actually sent.
 * ADDITIVE and reversible — three new tables, three new columns, one partial unique index; no existing row is rewritten or deleted
 * (open duplicate dispatch alerts, if any, are RESOLVED, never deleted, so the one-open-alert-per-reason rule can be enforced).
 *
 *  - order_vendor_segment_events: one row per segment transition (accept / reject / preparing / ready), written in the SAME transaction as the
 *    transition, with the actor and whether Hatly operations acted on the vendor's behalf, plus a rejection reason.
 *  - dispatch_attempts: one row per automatic dispatch attempt and its outcome (assigned / no driver / disabled / error / timeout).
 *  - refund_payouts: an operations marker that a recorded Manual Transfer refund was really sent (the refund ledger event itself is an
 *    obligation, never a statement that money moved).
 *  - deliveries.consecutive_unanswered: unanswered assignment offers in a row (reset when a driver acts or an admin assigns).
 *  - dispatch_alerts.detail / resolved_by_user_id, and at most ONE open alert per (order, reason).
 */
export class OrderOperations1700006400000 implements MigrationInterface {
  name = 'OrderOperations1700006400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_vendor_segment_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "segment_id" uuid NOT NULL REFERENCES "order_vendor_segments"("id"),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "from_status" varchar(30),
        "to_status" varchar(30) NOT NULL,
        "actor_user_id" uuid REFERENCES "users"("id"),
        "actor_role" varchar(30),
        "on_behalf_of_vendor" boolean NOT NULL DEFAULT false,
        "reason" varchar(500),
        "correlation_id" varchar(100),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_vendor_segment_events" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_segment_events_segment" ON "order_vendor_segment_events" ("segment_id", "created_at");
      CREATE INDEX "IDX_segment_events_order" ON "order_vendor_segment_events" ("order_id", "created_at");

      CREATE TABLE "dispatch_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "outcome" varchar(40) NOT NULL,
        "driver_id" uuid REFERENCES "drivers"("id") ON DELETE SET NULL,
        "detail" varchar(500),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dispatch_attempts" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_dispatch_attempts_order" ON "dispatch_attempts" ("order_id", "created_at");

      CREATE TABLE "refund_payouts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "financial_event_id" uuid NOT NULL REFERENCES "financial_events"("id"),
        "sent_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "note" varchar(500),
        "sent_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refund_payouts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_refund_payouts_event" UNIQUE ("financial_event_id")
      );

      ALTER TABLE "deliveries" ADD COLUMN "consecutive_unanswered" int NOT NULL DEFAULT 0;

      ALTER TABLE "dispatch_alerts" ADD COLUMN "detail" varchar(500), ADD COLUMN "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;
      -- keep the NEWEST open alert of each (order, reason); resolve (never delete) the older duplicates
      UPDATE "dispatch_alerts" a SET "resolved_at" = now()
        WHERE a."resolved_at" IS NULL AND a."deleted_at" IS NULL
          AND EXISTS (SELECT 1 FROM "dispatch_alerts" b WHERE b."order_id" = a."order_id" AND b."reason" = a."reason"
                      AND b."resolved_at" IS NULL AND b."deleted_at" IS NULL AND (b."created_at", b."id") > (a."created_at", a."id"));
      CREATE UNIQUE INDEX "UQ_dispatch_alerts_open" ON "dispatch_alerts" ("order_id", "reason") WHERE "resolved_at" IS NULL AND "deleted_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_dispatch_alerts_open";
      ALTER TABLE "dispatch_alerts" DROP COLUMN IF EXISTS "resolved_by_user_id", DROP COLUMN IF EXISTS "detail";
      ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "consecutive_unanswered";
      DROP TABLE IF EXISTS "refund_payouts";
      DROP TABLE IF EXISTS "dispatch_attempts";
      DROP TABLE IF EXISTS "order_vendor_segment_events";
    `);
  }
}
