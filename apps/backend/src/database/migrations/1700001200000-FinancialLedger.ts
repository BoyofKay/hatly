import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase F (Financial Ledger / Settlement / Employee Loans). Adds:
 *   - `vendor_branches.commission_rate_basis_points`,
 *     `drivers.commission_rate_basis_points` — per-entity configurable
 *     commission rates, nullable, deliberately unseeded.
 *   - `financial_events` — the immutable, append-only ledger.
 *   - `employee_loans` / `employee_loan_repayments` — the generic
 *     employee loan/advance model (explicitly NOT a driver float).
 *   - `vendor_settlement_periods` / `driver_settlement_periods` —
 *     closed, frozen settlement snapshots.
 *
 * Deliberately does NOT seed HATLY_SERVICE_DISTANCE_MULTIPLIER,
 * VENDOR_SETTLEMENT_FREQUENCY, or DRIVER_SETTLEMENT_FREQUENCY — "do
 * not invent a numeric default" / "do not invent a settlement day."
 */
export class FinancialLedger1700001200000 implements MigrationInterface {
  name = 'FinancialLedger1700001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_branches" ADD COLUMN "commission_rate_basis_points" integer;
      ALTER TABLE "drivers" ADD COLUMN "commission_rate_basis_points" integer;
    `);

    await queryRunner.query(`
      CREATE TABLE "financial_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "type" varchar(60) NOT NULL,
        "direction" varchar(20) NOT NULL,
        "amount_minor" bigint,
        "order_id" uuid,
        "order_vendor_segment_id" uuid,
        "delivery_id" uuid,
        "payment_id" uuid,
        "vendor_branch_id" uuid,
        "driver_id" uuid,
        "rate_snapshot" jsonb,
        "related_event_id" uuid,
        "actor_user_id" uuid,
        "reason" varchar,
        "idempotency_key" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_financial_events_order" ON "financial_events" ("order_id");
      CREATE INDEX "idx_financial_events_type" ON "financial_events" ("type");
      CREATE INDEX "idx_financial_events_vendor_branch" ON "financial_events" ("vendor_branch_id");
      CREATE INDEX "idx_financial_events_driver" ON "financial_events" ("driver_id");
      CREATE UNIQUE INDEX "idx_financial_events_idempotency_key" ON "financial_events" ("idempotency_key");
    `);

    await queryRunner.query(`
      CREATE TABLE "employee_loans" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "employee_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "borrowed_amount_minor" bigint NOT NULL,
        "issued_at" timestamptz NOT NULL,
        "reason" varchar,
        "issued_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_employee_loans_employee" ON "employee_loans" ("employee_user_id");

      CREATE TABLE "employee_loan_repayments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "employee_loan_id" uuid NOT NULL REFERENCES "employee_loans"("id"),
        "amount_minor" bigint NOT NULL,
        "repaid_at" timestamptz NOT NULL,
        "reason" varchar,
        "recorded_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_employee_loan_repayments_loan" ON "employee_loan_repayments" ("employee_loan_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "vendor_settlement_periods" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendor_branch_id" uuid NOT NULL,
        "frequency" varchar(20) NOT NULL,
        "period_start" timestamptz NOT NULL,
        "period_end" timestamptz NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'OPEN',
        "gross_sales_minor" bigint NOT NULL DEFAULT 0,
        "total_commission_owed_minor" bigint NOT NULL DEFAULT 0,
        "closed_at" timestamptz,
        "closed_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_vendor_settlement_periods_branch" ON "vendor_settlement_periods" ("vendor_branch_id");

      CREATE TABLE "driver_settlement_periods" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "driver_id" uuid NOT NULL,
        "frequency" varchar(20) NOT NULL,
        "period_start" timestamptz NOT NULL,
        "period_end" timestamptz NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'OPEN',
        "total_earnings_minor" bigint NOT NULL DEFAULT 0,
        "total_commission_owed_minor" bigint NOT NULL DEFAULT 0,
        "total_reimbursements_owed_minor" bigint NOT NULL DEFAULT 0,
        "net_payable_minor" bigint NOT NULL DEFAULT 0,
        "closed_at" timestamptz,
        "closed_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      );
      CREATE INDEX "idx_driver_settlement_periods_driver" ON "driver_settlement_periods" ("driver_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "driver_settlement_periods"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_settlement_periods"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employee_loan_repayments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "employee_loans"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "financial_events"`);
    await queryRunner.query(`
      ALTER TABLE "drivers" DROP COLUMN IF EXISTS "commission_rate_basis_points";
      ALTER TABLE "vendor_branches" DROP COLUMN IF EXISTS "commission_rate_basis_points";
    `);
  }
}
