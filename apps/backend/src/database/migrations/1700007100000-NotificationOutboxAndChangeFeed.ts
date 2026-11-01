import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Slice 2 — notification outbox, staff alerts, change detection (D-72), isolation visibility. ADDITIVE and reversible; no existing row,
 * column meaning or applied migration is changed.
 *
 *  - customer_notifications.event_key: a notification may now belong to an EVENT (e.g. one unavailable-items case) instead of only to
 *    (order, type). The old unique index is narrowed to the rows WITHOUT an event key (so every existing writer behaves exactly as before)
 *    and a second unique index covers (order, type, event key): a second case on the same order notifies the customer once more, while a
 *    retried or raced write of the SAME event can still never produce two rows.
 *  - notification_outbox: external deliveries (push now; WhatsApp/SMS/e-mail reserved) written in the business transaction and sent by a
 *    worker. One row per (event, recipient, channel). There is deliberately NO "delivered"/"opened" state: SENT means "accepted by the
 *    provider", which is all the push channel can evidence. In-app delivery is the inbox row itself (customer_notifications /
 *    staff_notifications), committed with the business change, so it never depends on a provider.
 *  - staff_notifications / notification_preferences: the in-app inbox of Operations and vendor staff, and their opt-outs.
 *  - change_events (+ triggers): an append-only, ordered feed of "something changed" (ids and kinds, never customer data) written by the
 *    database in the same transaction as the change, so no code path can forget it. Events are read in (txid, seq) order and only once
 *    their transaction is older than every transaction still running, so a row that commits late can never appear BEHIND a cursor a client
 *    already holds (a bare sequence number cannot give that guarantee). change_feed_state remembers how far the feed was pruned so a
 *    client with an older cursor is told to reload instead of silently missing events.
 *  - order_exceptions.isolation_*: why a financially isolated case could not be executed, kept on the case so the queue can show it.
 */
export class NotificationOutboxAndChangeFeed1700007100000 implements MigrationInterface {
  name = 'NotificationOutboxAndChangeFeed1700007100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_notifications" ADD COLUMN "event_key" varchar(120);
      DROP INDEX "UQ_customer_notifications_order_type";
      CREATE UNIQUE INDEX "UQ_customer_notifications_order_type" ON "customer_notifications" ("order_id", "type") WHERE "event_key" IS NULL;
      CREATE UNIQUE INDEX "UQ_customer_notifications_order_type_event" ON "customer_notifications" ("order_id", "type", "event_key") WHERE "event_key" IS NOT NULL;

      ALTER TABLE "order_exceptions"
        ADD COLUMN "isolation_code" varchar(48),
        ADD COLUMN "isolation_message" varchar(500),
        ADD COLUMN "isolated_at" timestamptz;
      CREATE INDEX "IDX_order_exceptions_isolated" ON "order_exceptions" ("isolated_at") WHERE "isolation_code" IS NOT NULL;

      CREATE TABLE "notification_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_key" varchar(160) NOT NULL,
        "recipient_user_id" uuid NOT NULL,
        "recipient_kind" varchar(12) NOT NULL,
        "channel" varchar(12) NOT NULL,
        "category" varchar(40) NOT NULL,
        "severity" varchar(10) NOT NULL DEFAULT 'INFO',
        "title" varchar(160) NOT NULL,
        "body" varchar(400) NOT NULL,
        "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(10) NOT NULL DEFAULT 'QUEUED',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "lock_token" varchar(36),
        "locked_until" timestamptz,
        "last_error" varchar(300),
        "skip_reason" varchar(40),
        "sent_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_outbox_recipient" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_notification_outbox_event_recipient_channel" UNIQUE ("event_key", "recipient_user_id", "channel"),
        CONSTRAINT "CHK_notification_outbox_kind" CHECK ("recipient_kind" IN ('CUSTOMER','STAFF')),
        CONSTRAINT "CHK_notification_outbox_channel" CHECK ("channel" IN ('PUSH','WHATSAPP','SMS','EMAIL')),
        CONSTRAINT "CHK_notification_outbox_severity" CHECK ("severity" IN ('INFO','CRITICAL')),
        CONSTRAINT "CHK_notification_outbox_status" CHECK ("status" IN ('QUEUED','SENDING','SENT','FAILED','DEAD','SKIPPED')),
        CONSTRAINT "CHK_notification_outbox_sent_at" CHECK (("status" = 'SENT') = ("sent_at" IS NOT NULL)),
        CONSTRAINT "CHK_notification_outbox_skip_reason" CHECK ("status" <> 'SKIPPED' OR "skip_reason" IS NOT NULL)
      );
      CREATE INDEX "IDX_notification_outbox_due" ON "notification_outbox" ("next_attempt_at") WHERE "status" IN ('QUEUED','FAILED');
      CREATE INDEX "IDX_notification_outbox_leases" ON "notification_outbox" ("locked_until") WHERE "status" = 'SENDING';
      CREATE INDEX "IDX_notification_outbox_status_created" ON "notification_outbox" ("status", "created_at");

      CREATE TABLE "staff_notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "event_key" varchar(160) NOT NULL,
        "category" varchar(40) NOT NULL,
        "severity" varchar(10) NOT NULL DEFAULT 'INFO',
        "required_action" varchar(40),
        "order_id" uuid,
        "order_number" varchar(20),
        "exception_id" uuid,
        "vendor_branch_id" uuid,
        "note" varchar(500),
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_staff_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_notifications_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_notifications_exception" FOREIGN KEY ("exception_id") REFERENCES "order_exceptions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_staff_notifications_branch" FOREIGN KEY ("vendor_branch_id") REFERENCES "vendor_branches"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_staff_notifications_user_event" UNIQUE ("user_id", "event_key"),
        CONSTRAINT "CHK_staff_notifications_severity" CHECK ("severity" IN ('INFO','CRITICAL')),
        CONSTRAINT "CHK_staff_notifications_read" CHECK (("is_read" = false AND "read_at" IS NULL) OR ("is_read" = true AND "read_at" IS NOT NULL))
      );
      CREATE INDEX "IDX_staff_notifications_user_created" ON "staff_notifications" ("user_id", "created_at" DESC);
      CREATE INDEX "IDX_staff_notifications_unread" ON "staff_notifications" ("user_id") WHERE "is_read" = false;

      CREATE TABLE "notification_preferences" (
        "user_id" uuid NOT NULL,
        "category" varchar(40) NOT NULL,
        "channel" varchar(12) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("user_id", "category", "channel"),
        CONSTRAINT "FK_notification_preferences_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_notification_preferences_channel" CHECK ("channel" IN ('IN_APP','PUSH'))
      );

      CREATE TABLE "change_events" (
        "seq" bigserial NOT NULL,
        "txid" bigint NOT NULL DEFAULT txid_current(),
        "entity" varchar(12) NOT NULL,
        "entity_id" uuid NOT NULL,
        "kind" varchar(16) NOT NULL,
        "order_id" uuid NOT NULL,
        "vendor_branch_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_change_events" PRIMARY KEY ("seq"),
        CONSTRAINT "FK_change_events_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_change_events_branch" FOREIGN KEY ("vendor_branch_id") REFERENCES "vendor_branches"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_change_events_entity" CHECK ("entity" IN ('ORDER','SEGMENT','EXCEPTION'))
      );
      CREATE INDEX "IDX_change_events_order" ON "change_events" ("txid", "seq");
      CREATE INDEX "IDX_change_events_branch_order" ON "change_events" ("vendor_branch_id", "txid", "seq") WHERE "vendor_branch_id" IS NOT NULL;
      CREATE INDEX "IDX_change_events_created" ON "change_events" ("created_at");

      CREATE TABLE "change_feed_state" (
        "id" smallint NOT NULL,
        "pruned_through_txid" bigint NOT NULL DEFAULT 0,
        CONSTRAINT "PK_change_feed_state" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_change_feed_state_singleton" CHECK ("id" = 1)
      );
      INSERT INTO "change_feed_state" ("id", "pruned_through_txid") VALUES (1, 0);

      CREATE FUNCTION hatly_emit_change() RETURNS trigger AS $fn$
      DECLARE
        v_kind text;
        v_order uuid;
        v_branch uuid;
      BEGIN
        IF TG_TABLE_NAME = 'order_vendor_segments' THEN
          v_kind := CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'STATUS' ELSE 'UPDATED' END;
          INSERT INTO change_events (entity, entity_id, kind, order_id, vendor_branch_id) VALUES ('SEGMENT', NEW.id, v_kind, NEW.order_id, NEW.vendor_branch_id);
        ELSIF TG_TABLE_NAME = 'orders' THEN
          v_kind := CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'STATUS' ELSE 'UPDATED' END;
          INSERT INTO change_events (entity, entity_id, kind, order_id, vendor_branch_id) VALUES ('ORDER', NEW.id, v_kind, NEW.id, NULL);
          -- A vendor never sees the order row itself, only its own part: an order-level change (cancellation, totals) reaches them as a change of that part.
          IF TG_OP = 'UPDATE' THEN
            INSERT INTO change_events (entity, entity_id, kind, order_id, vendor_branch_id)
              SELECT 'SEGMENT', s.id, 'ORDER_' || v_kind, NEW.id, s.vendor_branch_id FROM order_vendor_segments s WHERE s.order_id = NEW.id AND s.vendor_branch_id IS NOT NULL;
          END IF;
        ELSIF TG_TABLE_NAME = 'order_items' THEN
          SELECT g.order_id, g.vendor_branch_id INTO v_order, v_branch FROM order_vendor_segments g WHERE g.id = NEW.order_vendor_segment_id;
          IF v_order IS NOT NULL THEN
            INSERT INTO change_events (entity, entity_id, kind, order_id, vendor_branch_id) VALUES ('SEGMENT', NEW.order_vendor_segment_id, 'ITEMS', v_order, v_branch);
          END IF;
        ELSIF TG_TABLE_NAME = 'order_exception_events' THEN
          SELECT e.order_id, g.vendor_branch_id INTO v_order, v_branch
            FROM order_exceptions e LEFT JOIN order_vendor_segments g ON g.id = e.order_vendor_segment_id WHERE e.id = NEW.exception_id;
          INSERT INTO change_events (entity, entity_id, kind, order_id, vendor_branch_id) VALUES ('EXCEPTION', NEW.exception_id, 'EVENT', v_order, v_branch);
        END IF;
        RETURN NULL;
      END
      $fn$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_change_segments_ins AFTER INSERT ON "order_vendor_segments" FOR EACH ROW EXECUTE FUNCTION hatly_emit_change();
      CREATE TRIGGER trg_change_segments_upd AFTER UPDATE ON "order_vendor_segments" FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION hatly_emit_change();
      CREATE TRIGGER trg_change_orders_ins AFTER INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION hatly_emit_change();
      CREATE TRIGGER trg_change_orders_upd AFTER UPDATE ON "orders" FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*) EXECUTE FUNCTION hatly_emit_change();
      CREATE TRIGGER trg_change_items_removed AFTER UPDATE OF "removed_at" ON "order_items" FOR EACH ROW WHEN (OLD.removed_at IS DISTINCT FROM NEW.removed_at) EXECUTE FUNCTION hatly_emit_change();
      CREATE TRIGGER trg_change_exception_events AFTER INSERT ON "order_exception_events" FOR EACH ROW EXECUTE FUNCTION hatly_emit_change();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rolling back drops notification rows that only exist because of this slice (keyed duplicates of an (order, type)); they are an in-app
    // convenience view with no audit or financial value (see customer-notification.entity.ts).
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_change_exception_events ON "order_exception_events";
      DROP TRIGGER IF EXISTS trg_change_items_removed ON "order_items";
      DROP TRIGGER IF EXISTS trg_change_orders_upd ON "orders";
      DROP TRIGGER IF EXISTS trg_change_orders_ins ON "orders";
      DROP TRIGGER IF EXISTS trg_change_segments_upd ON "order_vendor_segments";
      DROP TRIGGER IF EXISTS trg_change_segments_ins ON "order_vendor_segments";
      DROP FUNCTION IF EXISTS hatly_emit_change();
      DROP TABLE IF EXISTS "change_feed_state";
      DROP TABLE IF EXISTS "change_events";
      DROP TABLE IF EXISTS "notification_preferences";
      DROP TABLE IF EXISTS "staff_notifications";
      DROP TABLE IF EXISTS "notification_outbox";
      DROP INDEX IF EXISTS "IDX_order_exceptions_isolated";
      ALTER TABLE "order_exceptions" DROP COLUMN IF EXISTS "isolated_at", DROP COLUMN IF EXISTS "isolation_message", DROP COLUMN IF EXISTS "isolation_code";
      DELETE FROM "customer_notifications" c USING "customer_notifications" k
        WHERE c."event_key" IS NOT NULL AND k."order_id" = c."order_id" AND k."type" = c."type" AND (k."created_at", k."id") < (c."created_at", c."id");
      DROP INDEX IF EXISTS "UQ_customer_notifications_order_type_event";
      DROP INDEX IF EXISTS "UQ_customer_notifications_order_type";
      ALTER TABLE "customer_notifications" DROP COLUMN IF EXISTS "event_key";
      CREATE UNIQUE INDEX "UQ_customer_notifications_order_type" ON "customer_notifications" ("order_id", "type");
    `);
  }
}
