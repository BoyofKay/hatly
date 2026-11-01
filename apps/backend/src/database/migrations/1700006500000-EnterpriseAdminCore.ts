import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enterprise Admin Panel — core tables. ADDITIVE and reversible (new tables and nullable/defaulted columns only; no existing row is
 * rewritten or deleted):
 *  - permission_templates: presets of permissions that are COPIED onto an admin (never a live link).
 *  - saved_views: per-admin saved list filters.
 *  - alert_acknowledgements: who acknowledged which Control Tower alert.
 *  - order_notes / customer_notes: append-only staff notes.
 *  - wallet_adjustments: audited, two-person-controlled customer wallet adjustments (the ledger row is created through the wallet ledger).
 *  - settlement_payments: payments recorded AGAINST a closed settlement period (B5). A closed period itself is never edited. Vendor periods
 *    are receivables (commission owed to Hatly → COLLECTION); driver periods follow the sign of net_payable (PAYOUT / COLLECTION).
 *  - report_exports: the export job table AND its result metadata (the file itself lives in storage, never in the database).
 *  - hidden_* columns on the three rating tables (moderation: hide, never delete) and products.low_stock_threshold.
 */
export class EnterpriseAdminCore1700006500000 implements MigrationInterface {
  name = 'EnterpriseAdminCore1700006500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "permission_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" varchar(40) NOT NULL,
        "name_en" varchar(80) NOT NULL,
        "name_ar" varchar(80) NOT NULL,
        "description_en" varchar(300),
        "description_ar" varchar(300),
        "is_system" boolean NOT NULL DEFAULT false,
        "permissions" text[] NOT NULL DEFAULT '{}',
        "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_permission_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permission_templates_key" UNIQUE ("key")
      );

      CREATE TABLE "saved_views" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "scope" varchar(10) NOT NULL DEFAULT 'PRIVATE' CHECK ("scope" IN ('PRIVATE','SHARED')),
        "table_id" varchar(60) NOT NULL,
        "name" varchar(80) NOT NULL,
        "filters" jsonb NOT NULL DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_saved_views" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_saved_views_owner_table_name" UNIQUE ("owner_user_id", "table_id", "name")
      );
      CREATE INDEX "IDX_saved_views_table" ON "saved_views" ("table_id", "scope");

      CREATE TABLE "alert_acknowledgements" (
        "alert_key" varchar(120) NOT NULL,
        "acknowledged_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "note" varchar(300),
        "acknowledged_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_alert_acknowledgements" PRIMARY KEY ("alert_key", "acknowledged_by_user_id")
      );

      CREATE TABLE "order_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL REFERENCES "orders"("id"),
        "author_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "body" varchar(1000) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_notes" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_order_notes_order" ON "order_notes" ("order_id", "created_at");

      CREATE TABLE "customer_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "author_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "body" varchar(1000) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_notes" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_customer_notes_customer" ON "customer_notes" ("customer_user_id", "created_at");

      CREATE TABLE "wallet_adjustments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "amount_minor" bigint NOT NULL CHECK ("amount_minor" <> 0),
        "reason_code" varchar(30) NOT NULL,
        "note" varchar(300),
        "status" varchar(12) NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','APPLIED','REJECTED')),
        "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "decided_by_user_id" uuid REFERENCES "users"("id"),
        "decided_at" timestamptz,
        "decision_note" varchar(300),
        "wallet_transaction_id" uuid REFERENCES "wallet_transactions"("id"),
        "idempotency_key" varchar(128) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_adjustments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_wallet_adjustments_idem" UNIQUE ("idempotency_key")
      );
      CREATE INDEX "IDX_wallet_adjustments_status" ON "wallet_adjustments" ("status", "created_at");
      CREATE INDEX "IDX_wallet_adjustments_customer" ON "wallet_adjustments" ("customer_user_id", "created_at");

      CREATE TABLE "settlement_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "party_type" varchar(10) NOT NULL CHECK ("party_type" IN ('VENDOR','DRIVER')),
        "vendor_period_id" uuid REFERENCES "vendor_settlement_periods"("id"),
        "driver_period_id" uuid REFERENCES "driver_settlement_periods"("id"),
        "direction" varchar(12) NOT NULL CHECK ("direction" IN ('PAYOUT','COLLECTION')),
        "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
        "method" varchar(30) NOT NULL,
        "reference" varchar(120),
        "paid_on" date NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'RECORDED' CHECK ("status" IN ('RECORDED','VOIDED')),
        "overpayment_authorised" boolean NOT NULL DEFAULT false,
        "overpayment_reason" varchar(300),
        "recorded_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "voided_by_user_id" uuid REFERENCES "users"("id"),
        "voided_at" timestamptz,
        "void_reason" varchar(300),
        "idempotency_key" varchar(128) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settlement_payments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_settlement_payments_idem" UNIQUE ("idempotency_key"),
        CONSTRAINT "CHK_settlement_payments_one_period" CHECK (("vendor_period_id" IS NOT NULL)::int + ("driver_period_id" IS NOT NULL)::int = 1)
      );
      CREATE INDEX "IDX_settlement_payments_vendor" ON "settlement_payments" ("vendor_period_id", "status");
      CREATE INDEX "IDX_settlement_payments_driver" ON "settlement_payments" ("driver_period_id", "status");
      CREATE INDEX "IDX_settlement_payments_paid_on" ON "settlement_payments" ("paid_on");

      CREATE TABLE "report_exports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "report_id" varchar(40) NOT NULL,
        "params" jsonb NOT NULL DEFAULT '{}',
        "format" varchar(6) NOT NULL CHECK ("format" IN ('CSV','XLSX','PDF')),
        "locale" varchar(2) NOT NULL DEFAULT 'en' CHECK ("locale" IN ('en','ar')),
        "status" varchar(12) NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','EXPIRED')),
        "progress" smallint NOT NULL DEFAULT 0,
        "cancel_requested" boolean NOT NULL DEFAULT false,
        "requested_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "row_count" integer,
        "file_bytes" bigint,
        "storage_key" varchar(300),
        "checksum_sha256" char(64),
        "error_code" varchar(40),
        "error_message" varchar(300),
        "locked_by" varchar(64),
        "heartbeat_at" timestamptz,
        "attempts" smallint NOT NULL DEFAULT 0,
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "expires_at" timestamptz,
        "last_downloaded_at" timestamptz,
        "download_count" integer NOT NULL DEFAULT 0,
        "idempotency_key" varchar(128),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_report_exports" PRIMARY KEY ("id")
      );
      CREATE INDEX "IDX_report_exports_user" ON "report_exports" ("requested_by_user_id", "created_at" DESC);
      CREATE INDEX "IDX_report_exports_claim" ON "report_exports" ("status", "created_at") WHERE "status" = 'QUEUED';
      CREATE UNIQUE INDEX "UQ_report_exports_idem" ON "report_exports" ("requested_by_user_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

      ALTER TABLE "vendor_ratings" ADD COLUMN "hidden_at" timestamptz, ADD COLUMN "hidden_by_user_id" uuid REFERENCES "users"("id"), ADD COLUMN "hidden_reason" varchar(300);
      ALTER TABLE "driver_ratings" ADD COLUMN "hidden_at" timestamptz, ADD COLUMN "hidden_by_user_id" uuid REFERENCES "users"("id"), ADD COLUMN "hidden_reason" varchar(300);
      ALTER TABLE "product_ratings" ADD COLUMN "hidden_at" timestamptz, ADD COLUMN "hidden_by_user_id" uuid REFERENCES "users"("id"), ADD COLUMN "hidden_reason" varchar(300);
      ALTER TABLE "products" ADD COLUMN "low_stock_threshold" integer CHECK ("low_stock_threshold" IS NULL OR "low_stock_threshold" >= 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products" DROP COLUMN "low_stock_threshold";
      ALTER TABLE "product_ratings" DROP COLUMN "hidden_reason", DROP COLUMN "hidden_by_user_id", DROP COLUMN "hidden_at";
      ALTER TABLE "driver_ratings" DROP COLUMN "hidden_reason", DROP COLUMN "hidden_by_user_id", DROP COLUMN "hidden_at";
      ALTER TABLE "vendor_ratings" DROP COLUMN "hidden_reason", DROP COLUMN "hidden_by_user_id", DROP COLUMN "hidden_at";
      DROP TABLE "report_exports";
      DROP TABLE "settlement_payments";
      DROP TABLE "wallet_adjustments";
      DROP TABLE "customer_notes";
      DROP TABLE "order_notes";
      DROP TABLE "alert_acknowledgements";
      DROP TABLE "saved_views";
      DROP TABLE "permission_templates";
    `);
  }
}
