import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Order exceptions (PD-016): one operational record per problem that needs a person — first use is "a product is unavailable after the
 * order was placed". ADDITIVE and reversible:
 *  - order_exceptions: the case (type, status, priority, who opened/owns it, the customer's decision and how it was obtained).
 *  - order_exception_items: which order items the case is about, and the amount that left the order when they were removed.
 *  - order_exception_events: the append-only history of the case (who did what, when, why).
 *  - order_items: three nullable columns mark an item as removed from the order. The row, its snapshots and its amounts are kept
 *    (history never changes); readers stop counting a removed item.
 * At most ONE open ITEM_UNAVAILABLE case per order (partial unique index), so concurrent vendor/ops requests join the same case.
 */
export class OrderExceptions1700007000000 implements MigrationInterface {
  name = 'OrderExceptions1700007000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_exceptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id" uuid NOT NULL,
        "order_vendor_segment_id" uuid,
        "type" varchar(32) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'OPEN',
        "priority" varchar(12) NOT NULL DEFAULT 'NORMAL',
        "summary" varchar(300),
        "opened_by_user_id" uuid,
        "opened_by_role" varchar(24),
        "assigned_to_user_id" uuid,
        "customer_decision" varchar(24),
        "decision_channel" varchar(16),
        "decision_note" varchar(500),
        "decided_at" timestamptz,
        "decision_recorded_by_user_id" uuid,
        "resolved_at" timestamptz,
        "resolved_by_user_id" uuid,
        "resolution" varchar(40),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_exceptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_exceptions_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id"),
        CONSTRAINT "FK_order_exceptions_segment" FOREIGN KEY ("order_vendor_segment_id") REFERENCES "order_vendor_segments"("id"),
        CONSTRAINT "FK_order_exceptions_opened_by" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_order_exceptions_assigned_to" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_order_exceptions_decided_by" FOREIGN KEY ("decision_recorded_by_user_id") REFERENCES "users"("id"),
        CONSTRAINT "FK_order_exceptions_resolved_by" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id"),
        CONSTRAINT "CHK_order_exceptions_type" CHECK ("type" IN ('ITEM_UNAVAILABLE','VENDOR_NO_RESPONSE','DELAYED_PREPARATION','CUSTOMER_CONTACT','VENDOR_CONTACT','PAYMENT_ISSUE','SUPERVISOR_REVIEW','OTHER')),
        CONSTRAINT "CHK_order_exceptions_status" CHECK ("status" IN ('OPEN','AWAITING_CUSTOMER','AWAITING_OPERATIONS','ESCALATED','RESOLVED','WITHDRAWN')),
        CONSTRAINT "CHK_order_exceptions_priority" CHECK ("priority" IN ('NORMAL','HIGH')),
        CONSTRAINT "CHK_order_exceptions_decision" CHECK ("customer_decision" IS NULL OR "customer_decision" IN ('CONTINUE_WITHOUT','CANCEL_ORDER')),
        CONSTRAINT "CHK_order_exceptions_channel" CHECK ("decision_channel" IS NULL OR "decision_channel" IN ('APP','PHONE','WHATSAPP'))
      );
      CREATE INDEX "IDX_order_exceptions_status_created" ON "order_exceptions" ("status", "created_at");
      CREATE INDEX "IDX_order_exceptions_order" ON "order_exceptions" ("order_id");
      CREATE UNIQUE INDEX "UQ_order_exceptions_open_item_unavailable" ON "order_exceptions" ("order_id")
        WHERE "type" = 'ITEM_UNAVAILABLE' AND "status" NOT IN ('RESOLVED','WITHDRAWN');

      CREATE TABLE "order_exception_items" (
        "exception_id" uuid NOT NULL,
        "order_item_id" uuid NOT NULL,
        "removed_amount_minor" bigint,
        CONSTRAINT "PK_order_exception_items" PRIMARY KEY ("exception_id", "order_item_id"),
        CONSTRAINT "FK_order_exception_items_exception" FOREIGN KEY ("exception_id") REFERENCES "order_exceptions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_exception_items_item" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id")
      );
      CREATE INDEX "IDX_order_exception_items_item" ON "order_exception_items" ("order_item_id");

      CREATE TABLE "order_exception_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "exception_id" uuid NOT NULL,
        "action" varchar(40) NOT NULL,
        "actor_user_id" uuid,
        "actor_role" varchar(24),
        "note" varchar(500),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_exception_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_exception_events_exception" FOREIGN KEY ("exception_id") REFERENCES "order_exceptions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_order_exception_events_actor" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
      );
      CREATE INDEX "IDX_order_exception_events_exception" ON "order_exception_events" ("exception_id", "created_at");

      ALTER TABLE "order_items"
        ADD COLUMN "removed_at" timestamptz,
        ADD COLUMN "removed_amount_minor" bigint,
        ADD COLUMN "removal_exception_id" uuid,
        ADD CONSTRAINT "FK_order_items_removal_exception" FOREIGN KEY ("removal_exception_id") REFERENCES "order_exceptions"("id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "order_items" DROP CONSTRAINT IF EXISTS "FK_order_items_removal_exception";
      ALTER TABLE "order_items" DROP COLUMN IF EXISTS "removal_exception_id", DROP COLUMN IF EXISTS "removed_amount_minor", DROP COLUMN IF EXISTS "removed_at";
      DROP TABLE IF EXISTS "order_exception_events";
      DROP TABLE IF EXISTS "order_exception_items";
      DROP TABLE IF EXISTS "order_exceptions";
    `);
  }
}
