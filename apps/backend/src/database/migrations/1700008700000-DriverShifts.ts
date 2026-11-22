import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver shifts (owner decision 2026-11-22): "Start shift / End shift" (on duty / off duty) with a record per shift; the courier closing
 * ends an open shift and links the shifts it covers. `drivers.accepting_new_orders` = the driver's "stop new orders" switch (finish what
 * they carry, receive nothing new). At most one open shift per driver. Additive.
 */
export class DriverShifts1700008700000 implements MigrationInterface {
  name = 'DriverShifts1700008700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "driver_shifts" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "ended_at" timestamptz NULL,
        "ended_by" varchar(20) NULL CHECK ("ended_by" IS NULL OR "ended_by" IN ('DRIVER','CLOSING','SUPERVISOR')),
        "ended_by_user_id" uuid NULL REFERENCES "users"("id"),
        "closing_period_id" uuid NULL REFERENCES "driver_settlement_periods"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE UNIQUE INDEX "uq_driver_shifts_one_open" ON "driver_shifts" ("driver_id") WHERE "ended_at" IS NULL`);
    await q.query(`CREATE INDEX "idx_driver_shifts_driver_started" ON "driver_shifts" ("driver_id", "started_at" DESC)`);
    await q.query(`ALTER TABLE "drivers" ADD COLUMN "accepting_new_orders" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "drivers" DROP COLUMN IF EXISTS "accepting_new_orders"`);
    await q.query(`DROP TABLE IF EXISTS "driver_shifts"`);
  }
}
