import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * P0 Admin real-time alerts (audit 2026-11-08 §5). Three NEW tables, nothing existing is altered:
 *  - `ops_alerts`: one row per operational condition that needs Operations' attention (a new order, a store not accepting, a late preparation,
 *    a driver not acknowledging, an open dispatch alert, an unresolved failed delivery). `alert_key` makes raising idempotent. Acknowledged
 *    (a person saw it — stops repeats) and resolved (the condition is gone) are separate columns.
 *  - `admin_push_subscriptions`: one Web Push subscription per browser/device of an Admin user (endpoint is unique: re-registering a device
 *    under another account moves it, so a shared device never keeps notifying the previous user).
 *  - `admin_push_deliveries`: one row per push attempt to one device, with honest stages: QUEUED → SENDING → ACCEPTED (the push service took
 *    it) and, reported by the device's service worker, displayed_at / clicked_at. FAILED (retrying), EXPIRED (subscription gone), DEAD
 *    (attempts exhausted or refused), SKIPPED (not sent: alert already acknowledged/resolved). The device receipt token is stored only hashed.
 * Alerts and push deliveries are derived data: they are removed with the order / store part / dispatch alert they describe (ON DELETE CASCADE),
 * so deleting test orders (as in the 2026-11-07 reset) is never blocked by them.
 * Additive; the previous release ignores these tables.
 */
export class OpsAlertsWebPush1700007800000 implements MigrationInterface {
  name = 'OpsAlertsWebPush1700007800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ops_alerts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "alert_key" varchar(200) NOT NULL,
        "category" varchar(40) NOT NULL,
        "priority" varchar(10) NOT NULL CONSTRAINT "CHK_ops_alerts_priority" CHECK ("priority" IN ('CRITICAL','HIGH')),
        "order_id" uuid REFERENCES "orders"("id") ON DELETE CASCADE,
        "order_number" varchar(40),
        "segment_id" uuid REFERENCES "order_vendor_segments"("id") ON DELETE CASCADE,
        "dispatch_alert_id" uuid REFERENCES "dispatch_alerts"("id") ON DELETE CASCADE,
        "detail" varchar(300),
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "acknowledged_at" timestamptz,
        "acknowledged_by_user_id" uuid REFERENCES "users"("id"),
        "resolved_at" timestamptz,
        "resolution" varchar(40),
        "push_rounds" int NOT NULL DEFAULT 0,
        "last_pushed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ops_alerts_key" UNIQUE ("alert_key")
      );
      CREATE INDEX "IDX_ops_alerts_open" ON "ops_alerts" ("opened_at") WHERE "resolved_at" IS NULL;
      CREATE INDEX "IDX_ops_alerts_order" ON "ops_alerts" ("order_id");

      CREATE TABLE "admin_push_subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL REFERENCES "users"("id"),
        "endpoint" text NOT NULL,
        "p256dh" varchar(200) NOT NULL,
        "auth" varchar(100) NOT NULL,
        "device_label" varchar(80),
        "user_agent" varchar(300),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "last_success_at" timestamptz,
        "last_failure_at" timestamptz,
        "last_failure_reason" varchar(300),
        "consecutive_failures" int NOT NULL DEFAULT 0,
        "revoked_at" timestamptz,
        "revoked_reason" varchar(40),
        CONSTRAINT "UQ_admin_push_subscriptions_endpoint" UNIQUE ("endpoint")
      );
      CREATE INDEX "IDX_admin_push_subscriptions_user" ON "admin_push_subscriptions" ("user_id") WHERE "revoked_at" IS NULL;

      CREATE TABLE "admin_push_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "subscription_id" uuid NOT NULL REFERENCES "admin_push_subscriptions"("id") ON DELETE CASCADE,
        "alert_id" uuid REFERENCES "ops_alerts"("id") ON DELETE CASCADE,
        "kind" varchar(10) NOT NULL CONSTRAINT "CHK_admin_push_deliveries_kind" CHECK ("kind" IN ('ALERT','TEST')),
        "round" int NOT NULL DEFAULT 0,
        "status" varchar(12) NOT NULL DEFAULT 'QUEUED'
          CONSTRAINT "CHK_admin_push_deliveries_status" CHECK ("status" IN ('QUEUED','SENDING','ACCEPTED','FAILED','EXPIRED','DEAD','SKIPPED')),
        "attempts" int NOT NULL DEFAULT 0,
        "max_attempts" int NOT NULL DEFAULT 5,
        "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
        "lock_token" varchar(36),
        "locked_until" timestamptz,
        "receipt_token_hash" varchar(64),
        "accepted_at" timestamptz,
        "displayed_at" timestamptz,
        "clicked_at" timestamptz,
        "last_error" varchar(300),
        "skip_reason" varchar(40),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX "UQ_admin_push_deliveries_alert_round" ON "admin_push_deliveries" ("alert_id", "subscription_id", "round") WHERE "alert_id" IS NOT NULL;
      CREATE INDEX "IDX_admin_push_deliveries_due" ON "admin_push_deliveries" ("next_attempt_at") WHERE "status" IN ('QUEUED','FAILED','SENDING');
      CREATE INDEX "IDX_admin_push_deliveries_subscription" ON "admin_push_deliveries" ("subscription_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_push_deliveries"; DROP TABLE IF EXISTS "admin_push_subscriptions"; DROP TABLE IF EXISTS "ops_alerts";`);
  }
}
