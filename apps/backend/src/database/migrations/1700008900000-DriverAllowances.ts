import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Daily driver allowance (owner decision 2026-11-23, "العهدة اليومية"): cash Hatly hands a driver so he can pay stores for orders. It is the
 * driver's liability until returned: he cannot end his shift while any is out; the courier closing returns it together with the orders'
 * money (a separate ledger — the closing's order figures are unchanged). OUT → RETURNED (at the office, or by the closing) or CANCELLED
 * (recorded by mistake). Additive.
 */
export class DriverAllowances1700008900000 implements MigrationInterface {
  name = 'DriverAllowances1700008900000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "driver_allowances" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
        "amount_minor" bigint NOT NULL CHECK ("amount_minor" > 0),
        "status" varchar(12) NOT NULL DEFAULT 'OUT' CHECK ("status" IN ('OUT','RETURNED','CANCELLED')),
        "note" varchar(200) NULL,
        "handed_at" timestamptz NOT NULL DEFAULT now(),
        "handed_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
        "shift_id" uuid NULL REFERENCES "driver_shifts"("id"),
        "returned_at" timestamptz NULL,
        "returned_by_user_id" uuid NULL REFERENCES "users"("id"),
        "closing_period_id" uuid NULL REFERENCES "driver_settlement_periods"("id"),
        "cancelled_at" timestamptz NULL,
        "cancelled_by_user_id" uuid NULL REFERENCES "users"("id"),
        "cancel_reason" varchar(200) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "idx_driver_allowances_out" ON "driver_allowances" ("driver_id") WHERE "status" = 'OUT'`);
    await q.query(`CREATE INDEX "idx_driver_allowances_driver_handed" ON "driver_allowances" ("driver_id", "handed_at" DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "driver_allowances"`);
  }
}
