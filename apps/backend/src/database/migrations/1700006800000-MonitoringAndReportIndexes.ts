import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * System monitoring tables + the date-range indexes reports and dashboards need. ADDITIVE and reversible. Index creation here is a plain
 * (briefly table-locking) CREATE INDEX IF NOT EXISTS — acceptable at the current data volume; a much larger table would use
 * CREATE INDEX CONCURRENTLY outside a transaction instead.
 *  - system_metric_buckets: one row per (minute, instance, metric, dimension set): request counts, errors and latency histograms.
 *  - integration_checks: the result of each integration probe (never a fabricated "healthy").
 */
export class MonitoringAndReportIndexes1700006800000 implements MigrationInterface {
  name = 'MonitoringAndReportIndexes1700006800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "system_metric_buckets" (
        "bucket_start" timestamptz NOT NULL,
        "instance_id" varchar(40) NOT NULL,
        "metric_key" varchar(60) NOT NULL,
        "dims" varchar(160) NOT NULL DEFAULT '',
        "count" bigint NOT NULL DEFAULT 0,
        "sum" double precision NOT NULL DEFAULT 0,
        "max" double precision NOT NULL DEFAULT 0,
        "histogram" jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_system_metric_buckets" PRIMARY KEY ("bucket_start", "instance_id", "metric_key", "dims")
      );
      CREATE INDEX "IDX_system_metrics_key_time" ON "system_metric_buckets" ("metric_key", "bucket_start");

      CREATE TABLE "integration_checks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "integration_key" varchar(40) NOT NULL,
        "status" varchar(10) NOT NULL CHECK ("status" IN ('OK','DEGRADED','DOWN','DISABLED')),
        "latency_ms" integer,
        "detail" varchar(200),
        "checked_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integration_checks" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_integration_checks_key" ON "integration_checks" ("integration_key", "checked_at" DESC);

      CREATE INDEX IF NOT EXISTS "IDX_orders_created_at" ON "orders" ("created_at");
      CREATE INDEX IF NOT EXISTS "IDX_orders_status_created_at" ON "orders" ("status", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_order_segments_branch_created" ON "order_vendor_segments" ("vendor_branch_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_financial_events_created_at" ON "financial_events" ("created_at");
      CREATE INDEX IF NOT EXISTS "IDX_financial_events_type_created" ON "financial_events" ("type", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_financial_events_branch_created" ON "financial_events" ("vendor_branch_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_financial_events_driver_created" ON "financial_events" ("driver_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_payments_created_at" ON "payments" ("created_at");
      CREATE INDEX IF NOT EXISTS "IDX_payments_status_created" ON "payments" ("status", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_deliveries_driver_created" ON "deliveries" ("driver_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_deliveries_delivered_at" ON "deliveries" ("delivered_at");
      CREATE INDEX IF NOT EXISTS "IDX_offer_consumptions_offer_created" ON "offer_consumptions" ("offer_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_wallet_tx_customer_created" ON "wallet_transactions" ("customer_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_wallet_tx_type_created" ON "wallet_transactions" ("type", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_audit_created_at" ON "admin_audit_logs" ("created_at");
      CREATE INDEX IF NOT EXISTS "IDX_audit_actor_created" ON "admin_audit_logs" ("actor_user_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_audit_target" ON "admin_audit_logs" ("target_type", "target_id", "created_at");
      CREATE INDEX IF NOT EXISTS "IDX_users_created_at" ON "users" ("created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_users_created_at";
      DROP INDEX IF EXISTS "IDX_audit_target";
      DROP INDEX IF EXISTS "IDX_audit_actor_created";
      DROP INDEX IF EXISTS "IDX_audit_created_at";
      DROP INDEX IF EXISTS "IDX_wallet_tx_type_created";
      DROP INDEX IF EXISTS "IDX_wallet_tx_customer_created";
      DROP INDEX IF EXISTS "IDX_offer_consumptions_offer_created";
      DROP INDEX IF EXISTS "IDX_deliveries_delivered_at";
      DROP INDEX IF EXISTS "IDX_deliveries_driver_created";
      DROP INDEX IF EXISTS "IDX_payments_status_created";
      DROP INDEX IF EXISTS "IDX_payments_created_at";
      DROP INDEX IF EXISTS "IDX_financial_events_driver_created";
      DROP INDEX IF EXISTS "IDX_financial_events_branch_created";
      DROP INDEX IF EXISTS "IDX_financial_events_type_created";
      DROP INDEX IF EXISTS "IDX_financial_events_created_at";
      DROP INDEX IF EXISTS "IDX_order_segments_branch_created";
      DROP INDEX IF EXISTS "IDX_orders_status_created_at";
      DROP INDEX IF EXISTS "IDX_orders_created_at";
      DROP TABLE "integration_checks";
      DROP TABLE "system_metric_buckets";
    `);
  }
}
