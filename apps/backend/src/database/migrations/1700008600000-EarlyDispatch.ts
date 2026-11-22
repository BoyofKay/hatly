import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Early dispatch (owner decision 2026-11-22, option b): a driver may be attached to an order while the store is still preparing it. The
 * order keeps its own status (Confirmed / Preparing); the delivery row carries `early_assigned_at` until the order is Ready, when the
 * pre-assignment becomes the normal assignment. Additive and nullable.
 */
export class EarlyDispatch1700008600000 implements MigrationInterface {
  name = 'EarlyDispatch1700008600000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "deliveries" ADD COLUMN "early_assigned_at" timestamptz NULL`);
    await q.query(`CREATE INDEX "idx_deliveries_early_assigned" ON "deliveries" ("early_assigned_at") WHERE "early_assigned_at" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "idx_deliveries_early_assigned"`);
    await q.query(`ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "early_assigned_at"`);
  }
}
